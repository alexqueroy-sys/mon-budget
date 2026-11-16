"""Calculs d'affichage : soldes, patrimoine, flux mensuels, budgets, objectifs, prévision.
Les virements internes (catégorie de type 'interne') ne comptent ni comme dépense ni comme revenu."""
import math
import sqlite3
from datetime import date

import pandas as pd

from app import loan

SEUIL_ATTENTION = 0.8  # à partir de 80 % d'un budget : alerte


def soldes_comptes(conn: sqlite3.Connection) -> list[dict]:
    """Courant : solde initial + transactions. Épargne : dernier relevé saisi à la main (sinon solde initial)."""
    resultat = []
    for c in conn.execute("SELECT * FROM comptes WHERE archive = 0 ORDER BY type, nom"):
        if c["type"] == "epargne":
            r = conn.execute("SELECT solde, date FROM releves_epargne WHERE compte_id = ? ORDER BY date DESC LIMIT 1",
                             (c["id"],)).fetchone()
            solde = r["solde"] if r else c["solde_initial"]
            info = r["date"] if r else None
        else:
            somme = conn.execute("SELECT COALESCE(SUM(montant), 0) FROM transactions WHERE compte_id = ?",
                                 (c["id"],)).fetchone()[0]
            solde = c["solde_initial"] + somme
            info = None
        resultat.append({"id": c["id"], "nom": c["nom"], "type": c["type"], "banque": c["banque"],
                         "solde": solde, "releve_du": info})
    return resultat


def caler_solde(conn: sqlite3.Connection, compte_id: int, solde_reel: int) -> None:
    """Règle le solde initial pour que le solde calculé corresponde au solde réel vu dans l'appli de la banque."""
    somme = conn.execute("SELECT COALESCE(SUM(montant), 0) FROM transactions WHERE compte_id = ?",
                         (compte_id,)).fetchone()[0]
    conn.execute("UPDATE comptes SET solde_initial = ? WHERE id = ?", (solde_reel - somme, compte_id))
    conn.commit()


def dette_totale(conn: sqlite3.Connection, jour: date | None = None) -> int:
    jour = jour or date.today()
    total = 0
    for p in conn.execute("SELECT * FROM prets"):
        lignes = loan.tableau_amortissement(p["capital"], p["taux_annuel"], date.fromisoformat(p["date_debut"]),
                                            p["differe_mois"], p["duree_mois"])
        total += loan.capital_restant_au(lignes, p["capital"], jour)
    return total


def patrimoine(conn: sqlite3.Connection, jour: date | None = None) -> dict:
    """Trois blocs séparés. 'argent_dispo' = comptes courants seulement. La valeur nette est donnée à titre
    indicatif et n'entre jamais dans le total « argent que j'ai »."""
    comptes = soldes_comptes(conn)
    dispo = sum(c["solde"] for c in comptes if c["type"] == "courant")
    epargne = sum(c["solde"] for c in comptes if c["type"] == "epargne")
    dette = dette_totale(conn, jour)
    return {"argent_dispo": dispo, "epargne": epargne, "dette": dette, "valeur_nette": dispo + epargne - dette}


def _filtre_comptes(compte_ids: list[int] | None) -> tuple[str, list[int]]:
    """Clause SQL « AND t.compte_id IN (...) » (paramètres liés, jamais de texte collé dans la requête)."""
    if compte_ids is None:
        return "", []
    if not compte_ids:
        return " AND 0", []
    return f" AND t.compte_id IN ({','.join('?' * len(compte_ids))})", list(compte_ids)


def flux_mensuels(conn: sqlite3.Connection, compte_ids: list[int] | None = None) -> pd.DataFrame:
    """Entrées et sorties par mois (hors virements internes). Colonnes : mois, entrees, sorties (positives).
    compte_ids : limiter à certains comptes (None = tous)."""
    clause, params = _filtre_comptes(compte_ids)
    df = pd.read_sql_query(
        "SELECT substr(t.date, 1, 7) AS mois, t.montant FROM transactions t "
        "LEFT JOIN categories c ON c.id = t.categorie_id WHERE COALESCE(c.type, '') != 'interne'" + clause,
        conn, params=params)
    if df.empty:
        return pd.DataFrame(columns=["mois", "entrees", "sorties"])
    df["entrees"] = df["montant"].clip(lower=0)
    df["sorties"] = (-df["montant"]).clip(lower=0)
    return df.groupby("mois")[["entrees", "sorties"]].sum().reset_index().sort_values("mois")


def depenses_par_categorie(conn: sqlite3.Connection, mois: str, compte_ids: list[int] | None = None) -> pd.DataFrame:
    clause, params = _filtre_comptes(compte_ids)
    return pd.read_sql_query(
        "SELECT COALESCE(c.nom, 'Sans catégorie') AS categorie, -SUM(t.montant) AS depense "
        "FROM transactions t LEFT JOIN categories c ON c.id = t.categorie_id "
        "WHERE t.montant < 0 AND substr(t.date, 1, 7) = ? AND COALESCE(c.type, 'depense') = 'depense'" + clause +
        " GROUP BY categorie ORDER BY depense DESC", conn, params=[mois, *params])


def soldes_par_banque(comptes: list[dict]) -> dict[str, dict]:
    """Regroupe les comptes par banque, avec le total courant et le total épargne de chaque banque."""
    groupes: dict[str, dict] = {}
    for c in comptes:
        g = groupes.setdefault(c["banque"], {"comptes": [], "courant": 0, "epargne": 0})
        g["comptes"].append(c)
        g[c["type"]] += c["solde"]
    return groupes


def etat_budget(depense: int, budget: int) -> str:
    if depense > budget:
        return "depasse"
    if depense >= budget * SEUIL_ATTENTION:
        return "attention"
    return "ok"


def suivi_budgets(conn: sqlite3.Connection, mois: str) -> list[dict]:
    depenses = {r["categorie"]: r["depense"] for r in depenses_par_categorie(conn, mois).to_dict("records")}
    lignes = []
    for b in conn.execute("SELECT c.nom, b.montant FROM budgets b JOIN categories c ON c.id = b.categorie_id"):
        d = depenses.get(b["nom"], 0)
        lignes.append({"categorie": b["nom"], "budget": b["montant"], "depense": d,
                       "etat": etat_budget(d, b["montant"]), "part": d / b["montant"]})
    return sorted(lignes, key=lambda l: l["part"], reverse=True)


def objectif_conseil(cible: int, total: int, date_limite: str | None, aujourdhui: date | None = None) -> dict:
    """Reste à épargner et effort mensuel pour tenir la date limite."""
    aujourdhui = aujourdhui or date.today()
    reste = max(cible - total, 0)
    res = {"reste": reste, "atteint": reste == 0, "par_mois": None, "mois_restants": None}
    if reste and date_limite:
        fin = date.fromisoformat(date_limite)
        if fin >= aujourdhui:
            mois = max((fin.year - aujourdhui.year) * 12 + fin.month - aujourdhui.month, 1)
            res.update(mois_restants=mois, par_mois=math.ceil(reste / mois))
        else:
            res["mois_restants"] = 0
    return res


def prevision(conn: sqlite3.Connection, aujourdhui: date | None = None, nb_mois: int = 3) -> dict:
    """Prévision du solde courant à partir de la moyenne mensuelle des 3 derniers mois terminés ayant des données."""
    aujourdhui = aujourdhui or date.today()
    flux = flux_mensuels(conn).set_index("mois")
    mois_courant = aujourdhui.strftime("%Y-%m")
    passes = [m for m in flux.index if m < mois_courant][-nb_mois:]
    if not passes:
        return {"base": 0, "entrees": 0, "sorties": 0, "net": 0}
    ent = round(flux.loc[passes, "entrees"].mean())
    sor = round(flux.loc[passes, "sorties"].mean())
    return {"base": len(passes), "entrees": ent, "sorties": sor, "net": ent - sor}


def mois_disponibles(conn: sqlite3.Connection) -> list[str]:
    mois = [r[0] for r in conn.execute("SELECT DISTINCT substr(date, 1, 7) FROM transactions ORDER BY 1 DESC")]
    return mois or [date.today().strftime("%Y-%m")]
