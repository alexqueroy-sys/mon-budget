"""Import des transactions (anti-doublons) et catégorisation par règles."""
import hashlib
import sqlite3
from collections import Counter

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
