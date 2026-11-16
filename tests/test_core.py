"""Tests de la logique, avec des données entièrement inventées."""
from datetime import date

import pytest

from app import db, loan, stats, subscriptions
from app.importers.csv_banque import CsvBanque
from app.money import ajouter_mois, format_eur, parse_date, parse_montant
from app.transactions import appliquer_regles, importer_lignes


@pytest.fixture
def conn():
    c = db.connect(":memory:")
    c.execute("INSERT INTO comptes (nom, type) VALUES ('Courant test', 'courant')")
    c.commit()
    return c


# ---------- montants et dates ----------
def test_parse_montant():
    assert parse_montant("1 234,56") == 123456
    assert parse_montant("-12,5") == -1250
    assert parse_montant("−3,00 €") == -300
    assert parse_montant("1.234,56") == 123456
    assert parse_montant("1,234.56") == 123456
    assert parse_montant("(4,20)") == -420
    with pytest.raises(ValueError):
        parse_montant("abc")


def test_format_et_dates():
    assert format_eur(123456) == "1 234,56 €"
    assert format_eur(-5) == "-0,05 €"
    assert parse_date("25/12/2025") == "2025-12-25"
    assert ajouter_mois(date(2026, 1, 31), 1) == date(2026, 2, 28)


# ---------- import CSV ----------
CSV_SIGNE = """Date operation;Libelle;Montant;Devise
15/10/2026;CARTE CARREFOUR MARKET;-23,40;EUR
16/10/2026;PRLV SEPA NETFLIX.COM;-13,49;EUR
01/10/2026;VIR SALAIRE ENTREPRISE TEST;1 250,00;EUR
"""

CSV_DEBIT_CREDIT = """Solde au 20/10/2026;;;
Date;Libellé;Débit;Crédit
15/10/2026;ACHAT PHARMACIE;12,30;
01/10/2026;VIREMENT RECU;;500,00
Total;;12,30;500,00
"""


def test_parse_csv_signe():
    lignes = CsvBanque().parse(CSV_SIGNE.encode("utf-8"))
    assert [l.montant for l in lignes] == [-2340, -1349, 125000]
    assert lignes[0].date == "2026-10-15"


def test_parse_csv_debit_credit_cp1252():
    lignes = CsvBanque().parse(CSV_DEBIT_CREDIT.encode("cp1252"))
    assert [l.montant for l in lignes] == [-1230, 50000]  # ligne « Total » et en-tête ignorées


def test_parse_csv_sans_entete():
    lignes = CsvBanque().parse(b"15/10/2026;TEST;-1,00\n")
    assert lignes[0].montant == -100


def test_parse_csv_invalide():
    with pytest.raises(ValueError):
        CsvBanque().parse(b"rien;a;voir\nici;non;oui\n")


# ---------- anti-doublons ----------
def test_import_sans_doublons(conn):
    lignes = CsvBanque().parse(CSV_SIGNE.encode())
    assert importer_lignes(conn, 1, lignes) == (3, 0)
    assert importer_lignes(conn, 1, lignes) == (0, 3)  # même fichier réimporté
    assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 3


def test_deux_achats_identiques_meme_jour(conn):
    ligne = "15/10/2026;BOULANGERIE;-1,20\n"
    lignes = CsvBanque().parse((ligne * 2).encode())
    assert importer_lignes(conn, 1, lignes) == (2, 0)  # les deux sont gardés
    un = CsvBanque().parse(ligne.encode())
    assert importer_lignes(conn, 1, un) == (0, 1)      # export qui se chevauche : pas de doublon


# ---------- catégories ----------
def test_regles(conn):
    importer_lignes(conn, 1, CsvBanque().parse(CSV_SIGNE.encode()))
    cats = {r["libelle"]: r["categorie"] for r in conn.execute(
        "SELECT t.libelle, c.nom AS categorie FROM transactions t LEFT JOIN categories c ON c.id = t.categorie_id")}
    assert cats["CARTE CARREFOUR MARKET"] == "Courses"
    assert cats["PRLV SEPA NETFLIX.COM"] == "Abonnements"
    assert cats["VIR SALAIRE ENTREPRISE TEST"] is None
    cid = db.categorie_id(conn, "Salaire")
    conn.execute("INSERT INTO regles (motif, categorie_id, priorite) VALUES ('SALAIRE', ?, 1)", (cid,))
    assert appliquer_regles(conn) == 1


# ---------- abonnements ----------
def _historique(conn, libelle, montants_dates):
    for d, m in montants_dates:
        conn.execute("INSERT INTO transactions (compte_id, date, libelle, montant, hash) VALUES (1, ?, ?, ?, ?)",
                     (d, libelle, m, f"{libelle}{d}{m}"))
    conn.commit()


def test_detection_mensuel_et_faux_positif(conn):
    _historique(conn, "PRLV SEPA NETFLIX.COM", [("2026-07-16", -1349), ("2026-08-16", -1349),
                                                ("2026-09-15", -1349), ("2026-10-16", -1399)])
    _historique(conn, "CARTE CARREFOUR 4521", [("2026-09-02", -2340), ("2026-09-19", -8120), ("2026-10-11", -1500)])
    assert subscriptions.detecter(conn) == 1
    r = conn.execute("SELECT * FROM abonnements").fetchone()
    assert r["periode"] == "mensuel" and r["statut"] == "candidat" and "Netflix" in r["nom"]
    assert subscriptions.prochaine_echeance(r["derniere_date"], r["periode"]) == date(2026, 11, 16)
    # Validation puis ré-analyse : le statut choisi est conservé
    conn.execute("UPDATE abonnements SET statut = 'valide'")
    subscriptions.detecter(conn)
    assert conn.execute("SELECT statut FROM abonnements").fetchone()[0] == "valide"
    assert subscriptions.total_valides(conn) == (1349, 1349 * 12)


def test_detection_annuel_hebdo(conn):
    _historique(conn, "COTISATION ASSURANCE HABITATION", [("2025-10-05", -9000), ("2026-10-06", -9100)])
    _historique(conn, "PAIEMENT CB COURS TENNIS", [(f"2026-10-{d:02d}", -1500) for d in (1, 8, 15, 22)])
    assert subscriptions.detecter(conn) == 2
    periodes = {r["cle"]: r["periode"] for r in conn.execute("SELECT cle, periode FROM abonnements")}
    assert set(periodes.values()) == {"annuel", "hebdo"}


# ---------- prêt ----------
def test_pret_amortissement():
    lignes = loan.tableau_amortissement(1_000_000, 0.012, date(2025, 9, 1), differe_mois=12, duree_mois=60)
    assert len(lignes) == 72
    assert lignes[-1].capital_restant == 0
    assert lignes[11].capital_restant > 1_000_000          # intérêts capitalisés pendant le différé
    assert all(l.mensualite == 0 for l in lignes[:12])
    assert sum(l.capital_rembourse for l in lignes) == lignes[11].capital_restant  # on rembourse capital + intérêts capitalisés
    r = loan.resume(lignes, 1_000_000, date(2027, 1, 15))
    assert r["mensualites_restantes"] == 56  # 4 échéances de remboursement déjà passées (oct. 2026 à janv. 2027)


def test_pret_taux_zero():
    lignes = loan.tableau_amortissement(120_000, 0.0, date(2026, 1, 1), 0, 12)
    assert lignes[0].mensualite == 10_000 and lignes[-1].capital_restant == 0


# ---------- patrimoine ----------
def test_patrimoine_separe_dette_epargne(conn):
    conn.execute("INSERT INTO comptes (nom, type, solde_initial) VALUES ('Livret test', 'epargne', 0)")
    conn.execute("INSERT INTO releves_epargne (compte_id, date, solde) VALUES (2, '2026-10-01', 80000)")
    conn.execute("INSERT INTO prets (nom, capital, taux_annuel, date_debut, differe_mois, duree_mois) "
                 "VALUES ('Prêt test', 500000, 0.0, '2026-10-01', 0, 10)")
    conn.commit()
    importer_lignes(conn, 1, CsvBanque().parse(CSV_SIGNE.encode()))
    stats.caler_solde(conn, 1, 100_000)
    p = stats.patrimoine(conn, jour=date(2026, 11, 16))
    assert p["argent_dispo"] == 100_000          # épargne et dette ne sont pas dans ce total
    assert p["epargne"] == 80_000
    assert p["dette"] == 450_000  # 500 000 empruntés à 0 %, 1 mensualité de 50 000 passée au 16/11/2026
    assert p["valeur_nette"] == p["argent_dispo"] + p["epargne"] - p["dette"]


# ---------- budgets, objectifs, prévision ----------
def test_budgets_et_objectifs(conn):
    importer_lignes(conn, 1, CsvBanque().parse(CSV_SIGNE.encode()))
    conn.execute("INSERT INTO budgets (categorie_id, montant) VALUES (?, 2500)", (db.categorie_id(conn, "Courses"),))
    conn.commit()
    ligne = stats.suivi_budgets(conn, "2026-10")[0]
    assert ligne["depense"] == 2340 and ligne["etat"] == "attention"   # 93,6 % de 25 €
    assert stats.etat_budget(100, 100) == "attention" and stats.etat_budget(101, 100) == "depasse"
    c = stats.objectif_conseil(100_000, 40_000, "2027-03-15", aujourdhui=date(2026, 10, 15))
    assert c["mois_restants"] == 5 and c["par_mois"] == 12_000
    assert stats.objectif_conseil(100, 100, None)["atteint"]


def test_prevision_moyenne(conn):
    _historique(conn, "SALAIRE", [("2026-07-01", 100_000), ("2026-08-01", 100_000), ("2026-09-01", 100_000)])
    _historique(conn, "LOYER", [("2026-07-05", -60_000), ("2026-08-05", -60_000), ("2026-09-05", -70_000)])
    p = stats.prevision(conn, aujourdhui=date(2026, 10, 10))
    assert p == {"base": 3, "entrees": 100_000, "sorties": 63_333, "net": 36_667}


# ---------- comptes et isolation ----------
from app import auth  # noqa: E402


@pytest.fixture
def donnees(tmp_path, monkeypatch):
    monkeypatch.setenv("BUDGET_DATA", str(tmp_path))
    monkeypatch.delenv("BUDGET_USERS", raising=False)
    monkeypatch.delenv("BUDGET_AUTH", raising=False)
    auth._echecs.clear()
    return tmp_path


def test_hachage():
    h = auth.hacher("mon mot de passe")
    assert "mon mot de passe" not in h and auth.verifier("mon mot de passe", h)
    assert not auth.verifier("autre", h) and not auth.verifier("x", "n'importe quoi")
    assert auth.hacher("a" * 12) != auth.hacher("a" * 12)  # sel aléatoire


def test_creation_et_connexion(donnees):
    auth.ajouter("lucas", "motdepasse-long")
    assert auth.connecter("lucas", "motdepasse-long") is None
    assert auth.connecter("Lucas ", "motdepasse-long") is None  # casse et espaces ignorés
    assert auth.connecter("lucas", "faux") is not None
    assert auth.connecter("inconnu", "motdepasse-long") == auth.connecter("lucas", "faux")  # même message
    assert oct((donnees / "users.json").stat().st_mode & 0o777) == "0o600"
    assert "motdepasse-long" not in (donnees / "users.json").read_text()


def test_noms_et_mots_de_passe_refuses(donnees):
    for mauvais in ["", "a", "../x", "Lucas", "a b", "x" * 40, "a/b", "..", "-lucas"]:
        with pytest.raises(ValueError):
            auth.ajouter(mauvais, "motdepasse-long")
        with pytest.raises(ValueError):
            auth.chemin_base(mauvais)
    with pytest.raises(ValueError):
        auth.ajouter("lucas", "court")


def test_blocage_apres_echecs(donnees):
    auth.ajouter("lucas", "motdepasse-long")
    for i in range(auth.ECHECS_MAX):
        assert auth.connecter("lucas", "faux", maintenant=1000 + i) is not None
    assert "Trop d'essais" in auth.connecter("lucas", "motdepasse-long", maintenant=1010)  # même le bon mot de passe
    assert auth.connecter("lucas", "motdepasse-long", maintenant=1000 + auth.BLOCAGE_S + 10) is None


def test_bases_separees(donnees):
    auth.ajouter("lucas", "motdepasse-long")
    auth.ajouter("alexis", "autre-mdp-long")
    a, b = db.connect(auth.chemin_base("lucas")), db.connect(auth.chemin_base("alexis"))
    a.execute("INSERT INTO comptes (nom, type) VALUES ('Secret de Lucas', 'courant')")
    a.commit()
    assert [r["nom"] for r in b.execute("SELECT nom FROM comptes")] == []
    assert auth.chemin_base("lucas") != auth.chemin_base("alexis")
    assert auth.chemin_base("lucas").parent == donnees / "users"
