"""Import des transactions (anti-doublons) et catégorisation par règles."""
import hashlib
import sqlite3
from collections import Counter
from datetime import date

from app.importers.base import LigneBrute
from app.money import normaliser


def _hash(compte_id: int, ligne: LigneBrute, occurrence: int) -> str:
    """date + montant + libellé (+ compte, + n° d'occurrence).
    Le n° d'occurrence évite de perdre deux achats identiques le même jour, tout en gardant le même hash
    quand deux exports se chevauchent."""
    brut = f"{compte_id}|{ligne.date}|{ligne.montant}|{normaliser(ligne.libelle)}|{occurrence}"
    return hashlib.sha256(brut.encode()).hexdigest()


def importer_lignes(conn: sqlite3.Connection, compte_id: int, lignes: list[LigneBrute]) -> tuple[int, int]:
    """Insère les lignes nouvelles. Renvoie (ajoutées, ignorées car déjà présentes)."""
    vus: Counter = Counter()
    ajoutees = 0
    for l in lignes:
        cle = (l.date, l.montant, normaliser(l.libelle))
        vus[cle] += 1
        cur = conn.execute(
            "INSERT OR IGNORE INTO transactions (compte_id, date, libelle, montant, hash) VALUES (?, ?, ?, ?, ?)",
            (compte_id, l.date, l.libelle, l.montant, _hash(compte_id, l, vus[cle])))
        ajoutees += cur.rowcount
    conn.commit()
    appliquer_regles(conn)
    return ajoutees, len(lignes) - ajoutees


def appliquer_regles(conn: sqlite3.Connection, tout_recalculer: bool = False) -> int:
    """Catégorise par motif contenu dans le libellé. Par défaut, ne touche que les lignes sans catégorie."""
    regles = [(normaliser(r["motif"]), r["categorie_id"])
              for r in conn.execute("SELECT motif, categorie_id FROM regles ORDER BY priorite, id")]
    filtre = "" if tout_recalculer else "WHERE categorie_id IS NULL"
    modifiees = 0
    for tx in conn.execute(f"SELECT id, libelle, categorie_id FROM transactions {filtre}").fetchall():
        lib = normaliser(tx["libelle"])
        for motif, cat in regles:
            if motif and motif in lib:
                if tx["categorie_id"] != cat:
                    conn.execute("UPDATE transactions SET categorie_id = ? WHERE id = ?", (cat, tx["id"]))
                    modifiees += 1
                break
    conn.commit()
    return modifiees


def virements_internes_probables(conn: sqlite3.Connection, jours: int = 3) -> list[dict]:
    """Paires (sortie sur un compte, entrée du même montant sur un AUTRE compte, à moins de `jours` jours)
    pas encore marquées comme virement interne. Ce sont des candidats : un remboursement d'ami de même
    montant peut y figurer, d'où la validation à la main. Chaque opération n'apparaît que dans une paire."""
    lignes = conn.execute(
        "SELECT t.id, t.compte_id, t.date, t.libelle, t.montant, ca.nom AS compte "
        "FROM transactions t JOIN comptes ca ON ca.id = t.compte_id "
        "LEFT JOIN categories c ON c.id = t.categorie_id "
        "WHERE COALESCE(c.type, '') != 'interne' ORDER BY t.date, t.id").fetchall()
    sorties = [l for l in lignes if l["montant"] < 0]
    entrees = [l for l in lignes if l["montant"] > 0]
    pris: set[int] = set()
    paires = []
    for s in sorties:
        ds = date.fromisoformat(s["date"])
        meilleur = None
        for e in entrees:
            if e["id"] in pris or e["compte_id"] == s["compte_id"] or e["montant"] != -s["montant"]:
                continue
            ecart = abs((date.fromisoformat(e["date"]) - ds).days)
            if ecart <= jours and (meilleur is None or ecart < meilleur[0]):
                meilleur = (ecart, e)
        if meilleur:
            e = meilleur[1]
            pris.add(e["id"])
            paires.append({"sortie_id": s["id"], "entree_id": e["id"], "montant": e["montant"],
                           "de": s["compte"], "vers": e["compte"], "date_sortie": s["date"], "date_entree": e["date"],
                           "libelle_sortie": s["libelle"], "libelle_entree": e["libelle"]})
    return paires


def marquer_virements_internes(conn: sqlite3.Connection, ids: list[int]) -> None:
    cat = conn.execute("SELECT id FROM categories WHERE nom = 'Virement interne'").fetchone()["id"]
    conn.executemany("UPDATE transactions SET categorie_id = ? WHERE id = ?", [(cat, i) for i in ids])
    conn.commit()
