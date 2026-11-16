"""Détection d'abonnements : même marchand, montant quasi identique, intervalle régulier.
Les résultats sont des CANDIDATS : tu valides ou rejettes à la main (faux positifs possibles)."""
import re
import sqlite3
import statistics
from collections import defaultdict
from datetime import date, timedelta

from app.money import ajouter_mois, normaliser

PERIODES = {  # nom: (jours, tolérance en jours, occurrences minimum)
    "hebdo": (7, 2, 3),
    "mensuel": (30, 4, 3),
    "annuel": (365, 10, 2),
}
TOLERANCE_MONTANT = 0.05  # 5 %
MOTS_VIDES = {"PRLV", "SEPA", "CARTE", "CB", "PAIEMENT", "VIR", "VIREMENT", "PRELEVEMENT", "ACHAT",
              "FACTURE", "DE", "DU", "EUR", "PAR", "REF", "ECHEANCE", "COTISATION"}


def cle_marchand(libelle: str) -> str:
    """'PRLV SEPA NETFLIX.COM 12/11' -> 'NETFLIX.COM'. Retire les mots génériques et tout ce qui contient un chiffre."""
    mots = [m for m in re.split(r"[\s*/]+", normaliser(libelle)) if m and m not in MOTS_VIDES
            and not any(c.isdigit() for c in m) and len(m) >= 2]
    return " ".join(mots[:2])


def _periode(dates: list[date]) -> str | None:
    if len(dates) < 2:
        return None
    intervalles = [(b - a).days for a, b in zip(dates, dates[1:])]
    mediane = statistics.median(intervalles)
    for nom, (jours, tol, mini) in PERIODES.items():
        if abs(mediane - jours) <= tol and len(dates) >= mini:
            bons = sum(1 for i in intervalles if abs(i - jours) <= tol)
            if bons / len(intervalles) >= 0.7:
                return nom
    return None


def detecter(conn: sqlite3.Connection) -> int:
    """Analyse les dépenses et met à jour la table abonnements. Renvoie le nombre de candidats trouvés."""
    groupes: dict[str, list[tuple[date, int, str]]] = defaultdict(list)
    for tx in conn.execute(
            "SELECT t.date, t.libelle, t.montant FROM transactions t "
            "LEFT JOIN categories c ON c.id = t.categorie_id "
            "WHERE t.montant < 0 AND COALESCE(c.type, 'depense') = 'depense' ORDER BY t.date"):
        cle = cle_marchand(tx["libelle"])
        if cle:
            groupes[cle].append((date.fromisoformat(tx["date"]), -tx["montant"], tx["libelle"]))

    trouves = 0
    for cle, ops in groupes.items():
        if len(ops) < 2:
            continue
        mediane = statistics.median(m for _, m, _ in ops)
        proches = [(d, m, lib) for d, m, lib in ops if abs(m - mediane) <= mediane * TOLERANCE_MONTANT]
        periode = _periode([d for d, _, _ in proches])
        if not periode:
            continue
        trouves += 1
        derniere = proches[-1]
        existant = conn.execute("SELECT statut FROM abonnements WHERE cle = ?", (cle,)).fetchone()
        if existant:
            conn.execute("UPDATE abonnements SET montant = ?, periode = ?, derniere_date = ? WHERE cle = ?",
                         (int(statistics.median(m for _, m, _ in proches)), periode, derniere[0].isoformat(), cle))
        else:
            conn.execute(
                "INSERT INTO abonnements (cle, nom, montant, periode, derniere_date) VALUES (?, ?, ?, ?, ?)",
                (cle, cle.title(), int(statistics.median(m for _, m, _ in proches)), periode, derniere[0].isoformat()))
    conn.commit()
    return trouves


def prochaine_echeance(derniere_date: str, periode: str) -> date:
    d = date.fromisoformat(derniere_date)
    if periode == "hebdo":
        return d + timedelta(days=7)
    if periode == "mensuel":
        return ajouter_mois(d, 1)
    return ajouter_mois(d, 12)


def equivalent_mensuel(montant: int, periode: str) -> int:
    if periode == "hebdo":
        return round(montant * 52 / 12)
    if periode == "annuel":
        return round(montant / 12)
    return montant


def total_valides(conn: sqlite3.Connection) -> tuple[int, int]:
    """(total mensuel, total annuel) des abonnements validés, en centimes."""
    mensuel = sum(equivalent_mensuel(r["montant"], r["periode"])
                  for r in conn.execute("SELECT montant, periode FROM abonnements WHERE statut = 'valide'"))
    return mensuel, mensuel * 12
