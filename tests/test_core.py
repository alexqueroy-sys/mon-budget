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


# ---------- plusieurs banques ----------
import sqlite3  # noqa: E402

from app.importers import BANQUES, IMPORTERS  # noqa: E402
from app.transactions import marquer_virements_internes, virements_internes_probables  # noqa: E402

CSV_BOURSO = """dateOp;dateVal;label;category;categoryParent;supplierFound;amount;comment;accountNum;accountLabel;accountbalance
2026-10-16;2026-10-16;"CARTE 16/10/26 CARREFOUR CB*1234";Alimentation;Vie quotidienne;carrefour;-23,40;;00040123456;COMPTE DEMO;1 250,10
2026-10-14;2026-10-15;"VIR SEPA RECU DE LUCAS BNP";Virements;Virements;;300,00;;00040123456;COMPTE DEMO;1 250,10
2026-10-02;2026-10-02;"PRLV SEPA SPOTIFY AB";Loisirs;Loisirs;spotify;-10,99;;00040123456;COMPTE DEMO;1 273,50
"""

CSV_BNP_VIREMENT = """Date operation;Libelle;Montant;Devise
13/10/2026;VIR SEPA VERS BOURSORAMA;-300,00;EUR
"""


def test_cles_banques_coherentes():
    assert set(IMPORTERS) == set(BANQUES) == {"bnp", "boursorama", "caisse_epargne", "autre"}


def test_import_boursorama():
    imp = IMPORTERS["boursorama"]
    lignes = imp.parse(CSV_BOURSO.encode("utf-8"))
    assert [(l.date, l.montant) for l in lignes] == [("2026-10-16", -2340), ("2026-10-14", 30000), ("2026-10-02", -1099)]
    assert "00040123456" not in repr(lignes)                  # le numéro de compte n'est jamais repris
    assert imp.solde_indique(CSV_BOURSO.encode()) == 125010    # solde de l'opération la plus récente
    assert IMPORTERS["bnp"].solde_indique(CSV_SIGNE.encode()) is None


def test_import_bnp_et_banque_du_compte(conn):
    assert IMPORTERS["bnp"].parse(CSV_SIGNE.encode())[0].montant == -2340
    assert conn.execute("SELECT banque FROM comptes").fetchone()[0] == "autre"   # défaut


def test_migration_v1_vers_v2(tmp_path):
    chemin = tmp_path / "ancienne.db"
    ancienne = sqlite3.connect(chemin)
    ancienne.executescript(db.SCHEMA)       # schéma de la version 1 : pas de colonne banque
    ancienne.execute("PRAGMA user_version = 1")
    ancienne.execute("INSERT INTO comptes (nom, type) VALUES ('Vieux compte', 'courant')")
    ancienne.commit()
    ancienne.close()
    c = db.connect(chemin)
    r = c.execute("SELECT nom, banque FROM comptes").fetchone()
    assert (r["nom"], r["banque"]) == ("Vieux compte", "autre")
    assert c.execute("PRAGMA user_version").fetchone()[0] == db.SCHEMA_VERSION


def test_virements_entre_banques(conn):
    conn.execute("UPDATE comptes SET nom = 'BNP courant', banque = 'bnp' WHERE id = 1")
    conn.execute("INSERT INTO comptes (nom, type, banque) VALUES ('Bourso courant', 'courant', 'boursorama')")
    conn.commit()
    importer_lignes(conn, 1, IMPORTERS["bnp"].parse(CSV_BNP_VIREMENT.encode()))
    importer_lignes(conn, 2, IMPORTERS["boursorama"].parse(CSV_BOURSO.encode()))
    paires = virements_internes_probables(conn)
    assert len(paires) == 1 and paires[0]["montant"] == 30000
    assert (paires[0]["de"], paires[0]["vers"]) == ("BNP courant", "Bourso courant")
    # Avant : le virement compte comme 300 € de dépense et 300 € de revenu
    assert stats.flux_mensuels(conn).set_index("mois").loc["2026-10", "entrees"] == 30000
    marquer_virements_internes(conn, [paires[0]["sortie_id"], paires[0]["entree_id"]])
    assert virements_internes_probables(conn) == []
    flux = stats.flux_mensuels(conn).set_index("mois").loc["2026-10"]
    assert flux["entrees"] == 0 and flux["sorties"] == 2340 + 1099   # plus que les vraies dépenses


def test_virement_meme_compte_ou_montant_different_ignore(conn):
    conn.execute("INSERT INTO comptes (nom, type, banque) VALUES ('Autre', 'courant', 'boursorama')")
    conn.commit()
    _historique(conn, "A", [("2026-10-10", -5000), ("2026-10-10", 5000)])      # même compte : pas un virement
    _historique(conn, "B", [("2026-10-10", -5000)])
    conn.execute("INSERT INTO transactions (compte_id, date, libelle, montant, hash) VALUES (2, '2026-10-20', 'Z', 5000, 'z')")
    conn.commit()                                                                # 10 jours d'écart : trop loin
    assert virements_internes_probables(conn) == []


def test_filtre_par_compte_et_groupes(conn):
    conn.execute("UPDATE comptes SET banque = 'bnp' WHERE id = 1")
    conn.execute("INSERT INTO comptes (nom, type, banque, solde_initial) VALUES ('Livret', 'epargne', 'boursorama', 50000)")
    conn.commit()
    _historique(conn, "COURSES", [("2026-10-05", -1000)])
    conn.execute("INSERT INTO transactions (compte_id, date, libelle, montant, hash) VALUES (2, '2026-10-06', 'X', -400, 'x')")
    conn.commit()
    assert stats.flux_mensuels(conn, [1]).iloc[0]["sorties"] == 1000
    assert stats.flux_mensuels(conn, [2]).empty   # un compte d'épargne n'est jamais de la consommation
    assert stats.flux_mensuels(conn, []).empty
    assert stats.depenses_par_categorie(conn, "2026-10", [1])["depense"].sum() == 1000
    g = stats.soldes_par_banque(stats.soldes_comptes(conn))
    assert set(g) == {"bnp", "boursorama"} and g["bnp"]["courant"] == -1000 and g["boursorama"]["epargne"] == 49600


CSV_CE = """Compte : DEMO;;;;;;;;;;;;
Date de comptabilisation;Libelle simplifie;Libelle operation;Reference;Informations complementaires;Type operation;Categorie;Sous categorie;Debit;Credit;Date operation;Date de valeur;Pointage operation
16/10/26;CB CARREFOUR MARKET;CB CARREFOUR MARKET 1234 FACT 151026;REF1;;Carte bancaire;Alimentation;Supermarche;-23,40;;15/10/26;16/10/26;0
01/10/26;VIR SALAIRE;VIR SEPA SALAIRE ENTREPRISE DEMO;REF2;;Virement;Revenus;Salaire;;1 150,00;01/10/26;01/10/26;0
05/10/26;PRLV SPOTIFY;PRLV SEPA SPOTIFY AB;REF3;;Prelevement;Loisirs;Musique;-10,99;;05/10/26;05/10/26;0
"""


def test_import_caisse_epargne():
    imp = IMPORTERS["caisse_epargne"]
    lignes = imp.parse(CSV_CE.encode("cp1252"))
    assert [(l.date, l.libelle, l.montant) for l in lignes] == [
        ("2026-10-15", "CB CARREFOUR MARKET", -2340),
        ("2026-10-01", "VIR SALAIRE", 115000),
        ("2026-10-05", "PRLV SPOTIFY", -1099)]
    assert imp.solde_indique(CSV_CE.encode()) is None
    assert BANQUES["caisse_epargne"] == "Caisse d'Épargne"


def test_caisse_epargne_pipeline_complet(conn):
    conn.execute("UPDATE comptes SET banque = 'caisse_epargne' WHERE id = 1")
    conn.commit()
    importer_lignes(conn, 1, IMPORTERS["caisse_epargne"].parse(CSV_CE.encode()))
    assert importer_lignes(conn, 1, IMPORTERS["caisse_epargne"].parse(CSV_CE.encode())) == (0, 3)  # pas de doublon
    cats = {r["libelle"]: r["categorie"] for r in conn.execute(
        "SELECT t.libelle, c.nom AS categorie FROM transactions t LEFT JOIN categories c ON c.id = t.categorie_id")}
    assert cats["CB CARREFOUR MARKET"] == "Courses" and cats["PRLV SPOTIFY"] == "Abonnements"


# Format réel BNP : pas d'en-tête, 1re ligne = résumé du compte, ensuite date;catégorie;type;libellé;montant
CSV_BNP_REEL = """"Compte de ch&egrave;ques";"Compte de ch&amp;egrave;ques";****1234;13/11/26;;33,97
05/11/25;PRELEVEMENT;PRLV SEPA;PRLV SEPA STREAMING SA ECH/051125 ID EMETTEUR/FR00ZZZ000000 MDT/ABC REF/XYZ LIB/ABC;-7,85
05/12/25;PRELEVEMENT;PRLV SEPA;PRLV SEPA STREAMING SA ECH/051225 ID EMETTEUR/FR00ZZZ000000 MDT/ABC REF/XYZ LIB/ABC;-7,85
27/07/26;PAIEMENT CB;FACTURE CARTE;FACTURE CARTE DU 260726 CINEMA TEST VILLE         CARTE   4974XXXXXXXX0000;-8,50
16/02/26;VIREMENT;VIR CPTE A CPTE RECU;VIR CPTE A CPTE RECU /DE M TEST /MOTIF VIREMENT VERS COMPTE DE CHEQUES /REF;1 200,00
"""


def test_bnp_format_reel_sans_entete():
    imp = IMPORTERS["bnp"]
    r = imp.resume_compte(CSV_BNP_REEL.encode())
    assert r["libelle"] == "Compte de chèques" and r["numero_masque"] == "****1234"
    assert r["solde"] == 3397 and r["date"] == "2026-11-13"
    assert imp.solde_indique(CSV_BNP_REEL.encode()) == 3397
    lignes = imp.parse(CSV_BNP_REEL.encode())
    assert [l.montant for l in lignes] == [-785, -785, -850, 120000]
    # le bruit (échéance, mandat, carte, date collée) disparaît : même libellé d'un mois à l'autre
    assert lignes[0].libelle == lignes[1].libelle == "PRLV SEPA STREAMING SA"
    assert lignes[2].libelle == "FACTURE CARTE CINEMA TEST VILLE"
    assert "REF" not in lignes[3].libelle.replace("REFDO", "").split("/MOTIF")[0]


def test_bnp_compte_sans_operation():
    brut = '"Livret Jeune";"Livret Jeune";****9999;13/11/26;;0,00\n'.encode()
    assert IMPORTERS["bnp"].parse(brut) == []
    assert IMPORTERS["bnp"].solde_indique(brut) == 0


def test_import_epargne_hors_depenses_et_virements_internes(conn):
    conn.execute("UPDATE comptes SET banque = 'bnp', nom = 'Chèques' WHERE id = 1")
    conn.execute("INSERT INTO comptes (nom, type, banque) VALUES ('Livret A', 'epargne', 'bnp')")
    conn.commit()
    livret = ('"Livret A";"Livret A";****5915;13/11/26;;1 500,00\n'
              '16/10/26;VIREMENT INTERNE;VIR CPTE A CPTE EMIS;VIR CPTE A CPTE EMIS /MOTIF VIREMENT VERS COMPTE DE CHEQUES;-200,00\n'
              '16/10/26;VIREMENT;VIREMENT SEPA EMIS;VIREMENT SEPA EMIS /MOTIF ECOLE /BEN TEST;-940,00\n')
    cheques = ('"Compte de ch&egrave;ques";"x";****6369;13/11/26;;33,97\n'
               '16/10/26;VIREMENT;VIR CPTE A CPTE RECU;VIR CPTE A CPTE RECU /DE M TEST /MOTIF VIREMENT VERS COMPTE DE CHEQUES /REF;200,00\n')
    imp = IMPORTERS["bnp"]
    assert importer_lignes(conn, 2, imp.parse(livret.encode())) == (2, 0)
    importer_lignes(conn, 1, imp.parse(cheques.encode()))
    paires = virements_internes_probables(conn)
    assert len(paires) == 1 and (paires[0]["de"], paires[0]["vers"]) == ("Livret A", "Chèques")
    # aucune dépense fantôme venant du livret
    assert stats.depenses_par_categorie(conn, "2026-10")["depense"].sum() == 0
    # le calage met le livret au solde de la banque, même avec un ancien relevé
    conn.execute("INSERT INTO releves_epargne (compte_id, date, solde) VALUES (2, '2020-01-01', 1)")
    stats.caler_solde(conn, 2, imp.solde_indique(livret.encode()))
    assert {c["nom"]: c["solde"] for c in stats.soldes_comptes(conn)}["Livret A"] == 150000


def test_pret_capital_reel_de_la_banque(conn):
    from datetime import date
    conn.execute("INSERT INTO prets (nom, capital, taux_annuel, date_debut, differe_mois, duree_mois) "
                 "VALUES ('Prêt', 3000000, 0.02, '2025-01-01', 12, 60)")
    conn.commit()
    theorique = stats.dette_totale(conn, date(2026, 11, 13))
    r = IMPORTERS["bnp"].resume_compte('"Pr&ecirc;t";"Pr&amp;ecirc;t";****7264;13/11/26;;-31 219,20\n'.encode())
    assert r["solde"] == -3121920 and r["libelle"] == "Prêt"
    conn.execute("UPDATE prets SET capital_restant_reel = ?, date_reel = ?", (-r["solde"], r["date"]))
    conn.commit()
    assert stats.dette_totale(conn, date(2026, 11, 13)) == 3121920 != theorique


# Format réel Boursorama : la colonne « Solde » est présente deux fois (montant, puis solde du compte). Données inventées.
CSV_BOURSO_REEL = (
    '"Date Opération";"Date Valeur";Libellé;"Libellé Suggéré";Catégorie;"Catégorie Parente";Solde;Commentaire;'
    '"Numéro Compte";"Libellé Compte";Solde;Pointage\n'
    '2026-11-16;2026-11-15;"VIR INST TEST";"Vir Inst Test";"Virements reçus";"Virements reçus";170,00;;000123;Banque;274.07;Non\n'
    '2026-11-13;2026-11-13;"CARTE 12/11/26 CAFE TEST 4 CB*2345";"Café Test";Restaurants;Loisirs;-12,40;;000123;Banque;274.07;Non\n'
    '2026-11-13;2026-11-13;"CARTE 12/11/26 ZZ MACHIN 2 CB*2345";"Carte 12/11/26 Zz Machin 2 Cb*2345";x;x;-10,00;;000123;Banque;274.07;Non\n'
    '2026-11-12;2026-11-12;"PRLV SEPA FITNESS TEST";Autre;Logement;Logement;-30,00;;000123;Banque;296.47;Non\n'
    '2026-11-10;2026-11-10;"VIR SEPA SALAIRE TEST";"Vir Sepa Salaire Test";Salaire;Revenus;"1 382,37";;000123;Banque;326.47;Non\n'
)


def test_boursorama_format_reel_deux_colonnes_solde():
    imp = IMPORTERS["boursorama"]
    lignes = imp.parse(CSV_BOURSO_REEL.encode())
    assert [l.montant for l in lignes] == [17000, -1240, -1000, -3000, 138237]
    assert lignes[0].date == "2026-11-16"
    assert lignes[1].libelle == "Café Test"                       # libellé suggéré exploitable
    assert lignes[2].libelle == "CARTE ZZ MACHIN 2"               # sinon libellé brut nettoyé (sans date ni CB*)
    assert lignes[3].libelle == "PRLV SEPA FITNESS TEST"          # prélèvement : libellé brut, plus stable
    # solde = fin de journée de la plus ancienne date + opérations suivantes ; la 1re ligne (jour de l'export)
    # affiche un solde en retard (274.07) et ne doit pas servir de référence
    assert imp.solde_indique(CSV_BOURSO_REEL.encode()) == 32647 - 3000 - 1240 - 1000 + 17000
