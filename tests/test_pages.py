"""Chaque page se charge sans exception sur une base de démo (données inventées)."""
import glob
import os
import sys

import pytest
from streamlit.testing.v1 import AppTest

RACINE = os.path.dirname(os.path.dirname(__file__))
PAGES = ["app/Accueil.py"] + sorted(glob.glob("app/pages/*.py", root_dir=RACINE))


@pytest.fixture(scope="module")
def base_demo(tmp_path_factory):
    chemin = tmp_path_factory.mktemp("demo") / "demo.db"
    mp = pytest.MonkeyPatch()
    mp.setenv("BUDGET_DB", str(chemin))
    mp.setenv("BUDGET_AUTH", "off")   # ces tests ne portent pas sur la connexion
    sys.path.insert(0, RACINE)
    from app import db, stats, subscriptions
    from app.importers.csv_banque import CsvBanque
    from app.transactions import importer_lignes
    from scripts.seed_demo import csv_demo
    conn = db.connect()
    conn.execute("INSERT INTO comptes (nom, type, banque) VALUES ('Courant', 'courant', 'bnp')")
    conn.execute("INSERT INTO comptes (nom, type, banque) VALUES ('Livret', 'epargne', 'boursorama')")
    conn.execute("INSERT INTO comptes (nom, type, banque) VALUES ('Courant Bourso', 'courant', 'boursorama')")
    conn.commit()
    importer_lignes(conn, 1, CsvBanque().parse(csv_demo().encode()))
    stats.caler_solde(conn, 1, 50_000)
    subscriptions.detecter(conn)
    conn.execute("INSERT INTO prets (nom, capital, taux_annuel, date_debut, differe_mois, duree_mois) "
                 "VALUES ('Prêt', 500000, 0.01, '2025-09-01', 12, 60)")
    conn.execute("INSERT INTO objectifs (nom, cible, date_limite) VALUES ('Voyage', 100000, '2027-06-01')")
    conn.execute("INSERT INTO budgets (categorie_id, montant) VALUES (?, 10000)", (db.categorie_id(conn, "Courses"),))
    conn.commit()
    yield chemin
    conn.close()
    mp.undo()


@pytest.mark.parametrize("page", PAGES)
def test_page_charge(page, base_demo):
    at = AppTest.from_file(os.path.join(RACINE, page), default_timeout=30).run()
    assert not at.exception, [e.value for e in at.exception]


@pytest.mark.parametrize("page", PAGES)
def test_page_base_vide(page, tmp_path, monkeypatch):
    monkeypatch.setenv("BUDGET_DB", str(tmp_path / "vide.db"))
    monkeypatch.setenv("BUDGET_AUTH", "off")
    at = AppTest.from_file(os.path.join(RACINE, page), default_timeout=30).run()
    assert not at.exception, [e.value for e in at.exception]


# ---------- connexion et isolation ----------
@pytest.fixture
def deux_utilisateurs(tmp_path, monkeypatch):
    monkeypatch.setenv("BUDGET_DATA", str(tmp_path))
    monkeypatch.delenv("BUDGET_USERS", raising=False)
    monkeypatch.delenv("BUDGET_AUTH", raising=False)
    sys.path.insert(0, RACINE)
    from app import auth, db
    auth.ajouter("lucas", "motdepasse-long")
    auth.ajouter("alexis", "autre-mdp-long")
    c = db.connect(auth.chemin_base("lucas"))
    c.execute("INSERT INTO comptes (nom, type) VALUES ('Compte secret de Lucas', 'courant')")
    c.commit()
    c.close()
    return tmp_path


@pytest.mark.parametrize("page", PAGES)
def test_sans_connexion_rien_ne_s_affiche(page, deux_utilisateurs):
    at = AppTest.from_file(os.path.join(RACINE, page), default_timeout=30).run()
    assert not at.exception
    assert [t.value for t in at.title] == ["Connexion"]
    assert not any("secret" in m.value.lower() for m in at.markdown)


def test_connexion_ok_et_mauvais_mdp(deux_utilisateurs):
    at = AppTest.from_file(os.path.join(RACINE, "app/Accueil.py"), default_timeout=30).run()
    at.text_input[0].set_value("lucas")
    at.text_input[1].set_value("faux")
    at.button[0].click().run()
    assert at.error and "incorrect" in at.error[0].value
    at.text_input[1].set_value("motdepasse-long")
    at.button[0].click().run()
    assert not at.exception and at.session_state["user"] == "lucas"
    assert any("Compte secret de Lucas" in m.value for m in at.markdown)


def test_un_utilisateur_ne_voit_pas_les_donnees_de_l_autre(deux_utilisateurs):
    at = AppTest.from_file(os.path.join(RACINE, "app/Accueil.py"), default_timeout=30)
    at.session_state["user"] = "alexis"
    at.run()
    assert not at.exception
    assert not any("secret" in m.value.lower() for m in at.markdown)
    at2 = AppTest.from_file(os.path.join(RACINE, "app/Accueil.py"), default_timeout=30)
    at2.session_state["user"] = "../lucas"   # nom forgé : doit être refusé, pas lu
    at2.run()
    assert at2.exception


def test_page_import_affiche_les_virements_probables(tmp_path, monkeypatch):
    monkeypatch.setenv("BUDGET_DB", str(tmp_path / "vi.db"))
    monkeypatch.setenv("BUDGET_AUTH", "off")
    sys.path.insert(0, RACINE)
    from app import db
    c = db.connect()
    c.execute("INSERT INTO comptes (nom, type, banque) VALUES ('BNP courant', 'courant', 'bnp')")
    c.execute("INSERT INTO comptes (nom, type, banque) VALUES ('Bourso courant', 'courant', 'boursorama')")
    c.execute("INSERT INTO transactions (compte_id, date, libelle, montant, hash) VALUES (1, '2026-10-13', 'VIR', -30000, 'a')")
    c.execute("INSERT INTO transactions (compte_id, date, libelle, montant, hash) VALUES (2, '2026-10-14', 'VIR RECU', 30000, 'b')")
    c.commit()
    c.close()
    at = AppTest.from_file(os.path.join(RACINE, "app/pages/1_Import_et_comptes.py"), default_timeout=30).run()
    assert not at.exception
    assert len(at.checkbox) == 1
    at.checkbox[0].check().run()
    next(b for b in at.button if "virements internes" in b.label).click().run()
    assert not at.exception and len(at.checkbox) == 0   # la paire est marquée, la liste est vide
