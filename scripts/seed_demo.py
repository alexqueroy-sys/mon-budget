"""Remplit une base de DÉMO avec des données inventées (aucune donnée réelle).
Usage : BUDGET_AUTH=off BUDGET_DB=data/demo.db python scripts/seed_demo.py"""
import random
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import db, stats  # noqa: E402
from app.importers.csv_banque import CsvBanque  # noqa: E402
from app.money import ajouter_mois  # noqa: E402
from app.transactions import importer_lignes  # noqa: E402

random.seed(42)


def csv_demo(nb_mois: int = 6) -> str:
    lignes = ["Date operation;Libelle;Montant;Devise"]
    debut = ajouter_mois(date.today().replace(day=1), -nb_mois)
    for i in range(nb_mois + 1):
        m = ajouter_mois(debut, i)
        d = lambda j: m.replace(day=j).strftime("%d/%m/%Y")  # noqa: E731
        lignes += [f"{d(1)};VIR SALAIRE ENTREPRISE DEMO;1 150,00;EUR",
                   f"{d(3)};PRLV SEPA LOYER DEMO;-420,00;EUR",
                   f"{d(8)};PRLV SEPA NETFLIX.COM;-13,49;EUR",
                   f"{d(12)};PRLV SEPA SPOTIFY AB;-10,99;EUR",
                   f"{d(15)};PRLV SEPA SALLE DE SPORT DEMO;-29,90;EUR"]
        for j in (4, 11, 18, 25):
            lignes.append(f"{d(j)};CARTE CARREFOUR MARKET {random.randint(1000, 9999)};-{random.randint(1800, 6500) / 100:.2f}".replace(".", ",") + ";EUR")
        lignes.append(f"{d(20)};CARTE STEAM GAMES;-{random.randint(500, 3000) / 100:.2f}".replace(".", ",") + ";EUR")
    return "\n".join(lignes)


if __name__ == "__main__":
    conn = db.connect()
    if conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]:
        sys.exit("La base contient déjà des transactions : démo annulée pour ne rien écraser.")
    conn.execute("INSERT INTO comptes (nom, type, banque) VALUES ('Compte courant démo', 'courant', 'bnp')")
    conn.execute("INSERT INTO comptes (nom, type, banque) VALUES ('Livret démo', 'epargne', 'boursorama')")
    conn.commit()
    importer_lignes(conn, 1, CsvBanque().parse(csv_demo().encode()))
    stats.caler_solde(conn, 1, 85_000)
    conn.execute("INSERT INTO releves_epargne (compte_id, date, solde) VALUES (2, date('now'), 120000)")
    conn.execute("INSERT INTO prets (nom, capital, taux_annuel, date_debut, differe_mois, duree_mois) "
                 "VALUES ('Prêt démo', 800000, 0.01, date('now', '-1 year'), 24, 60)")
    conn.execute("INSERT INTO budgets (categorie_id, montant) VALUES (?, 20000)", (db.categorie_id(conn, "Courses"),))
    conn.commit()
    print("Base de démo prête :", db.chemin_db())
