"""Export CSV Boursorama / BoursoBank.

Format réel (vérifié sur un export de nov. 2026), séparateur « ; », dates AAAA-MM-JJ, UTF-8 avec BOM :
Date Opération ; Date Valeur ; Libellé ; Libellé Suggéré ; Catégorie ; Catégorie Parente ; Solde ; Commentaire ;
Numéro Compte ; Libellé Compte ; Solde ; Pointage
ATTENTION : la colonne « Solde » apparaît deux fois. La 1re est le MONTANT de l'opération (signé, virgule
décimale, « 1 382,37 »), la 2e est le solde du compte en fin de journée (point décimal, « 274.07 »).
La date retenue est celle de l'opération. Le numéro de compte n'est jamais lu ni enregistré.

Un ancien format (colonnes dateOp / label / amount / accountbalance) reste lu par le parseur générique."""
import csv
import io
import re

from app.importers.base import LigneBrute
from app.importers.csv_banque import CsvBanque, _decoder, _separateur, _trouver_colonne
from app.money import normaliser, parse_date, parse_montant

# Débuts de libellé bruts pour lesquels le « Libellé Suggéré » de la banque est parfois un simple recopiage
_RECOPIE = ("CARTE ", "AVOIR ", "RETRAIT DAB", "VIR ", "PRLV ", "*FRAIS")


def _lignes(contenu: bytes) -> list[list[str]]:
    texte = _decoder(contenu)
    lecteur = csv.reader(io.StringIO(texte), delimiter=_separateur(texte))
    return [[c.strip() for c in l] for l in lecteur if any(c.strip() for c in l)]


def _est_format_actuel(lignes: list[list[str]]) -> bool:
    if not lignes:
        return False
    norm = [normaliser(c) for c in lignes[0]]
    return "DATE OPERATION" in norm and "LIBELLE SUGGERE" in norm and norm.count("SOLDE") >= 2


def _nettoyer_brut(brut: str) -> str:
    s = re.sub(r"^(CARTE|AVOIR)\s+\d{2}/\d{2}/\d{2}\s+", r"\1 ", brut, flags=re.I)
    s = re.sub(r"^(RETRAIT DAB)\s+\d{2}/\d{2}/\d{2}\s+", r"\1 ", s, flags=re.I)
    s = re.sub(r"\s+CB\*\d+\s*$", "", s)           # fin de numéro de carte
    return re.sub(r"\s+", " ", s).strip()


def _libelle(brut: str, suggere: str) -> str:
    """Pour un paiement carte, le libellé suggéré (« Spotify » au lieu de « Spotify P4843113C ») reste identique
    d'un mois à l'autre : indispensable pour repérer les abonnements. Pour les virements et prélèvements,
    le libellé brut est plus fiable (le suggéré varie parfois pour un même prélèvement)."""
    propre = _nettoyer_brut(brut)
    s = normaliser(brut)
    if s.startswith("CARTE ") and suggere and not normaliser(suggere).startswith(_RECOPIE) and "CB*" not in suggere:
        return suggere
    return propre or suggere


class CsvBoursorama(CsvBanque):
    nom = "Boursorama"
    synonymes_extra = {
        "date": ["DATEOP"],
        "libelle": ["LABEL"],
        "montant": ["AMOUNT"],
    }

    def _extraire(self, lignes: list[list[str]]) -> list[tuple[str, int, int | None, str, str]]:
        """(date, montant, solde_fin_de_journee, libelle_brut, libelle_suggere) pour chaque opération."""
        norm = [normaliser(c) for c in lignes[0]]
        c_date, c_lib, c_sug = norm.index("DATE OPERATION"), norm.index("LIBELLE"), norm.index("LIBELLE SUGGERE")
        c_montant = norm.index("SOLDE")
        c_solde = len(norm) - 1 - norm[::-1].index("SOLDE")
        sortie = []
        for n, l in enumerate(lignes[1:], start=2):
            if len(l) <= c_solde:
                raise ValueError(f"ligne {n} : {c_solde + 1} colonnes attendues, {len(l)} trouvées")
            try:
                date, montant = parse_date(l[c_date]), parse_montant(l[c_montant])
            except ValueError as e:
                raise ValueError(f"ligne {n} illisible : {e}") from e
            try:
                solde = parse_montant(l[c_solde])
            except ValueError:
                solde = None
            sortie.append((date, montant, solde, l[c_lib], l[c_sug]))
        return sortie

    def parse(self, contenu: bytes) -> list[LigneBrute]:
        lignes = _lignes(contenu)
        if not _est_format_actuel(lignes):
            return super().parse(contenu)
        return [LigneBrute(date=d, libelle=_libelle(brut, sug), montant=m)
                for d, m, _, brut, sug in self._extraire(lignes)]

    def solde_indique(self, contenu: bytes) -> int | None:
        """Solde actuel du compte. Format actuel : solde de fin de journée de la plus ancienne date du fichier,
        plus les opérations des jours suivants (le solde affiché sur les lignes du jour même de l'export peut
        être en retard, donc on ne s'y fie pas). Vérifié : retombe exactement sur le solde de l'appli."""
        lignes = _lignes(contenu)
        if _est_format_actuel(lignes):
            ops = self._extraire(lignes)
            if not ops:
                return None
            d0 = min(o[0] for o in ops)
            base = next((o[2] for o in ops if o[0] == d0 and o[2] is not None), None)
            if base is None:
                return None
            return base + sum(o[1] for o in ops if o[0] > d0)
        entete, donnees = self._lire(contenu)   # ancien format : colonne accountbalance
        if entete is None:
            return None
        c_date = self._col(entete, "date")
        c_solde = _trouver_colonne(entete, ["ACCOUNTBALANCE", "SOLDE"])
        if c_solde is None:
            return None
        meilleur = None
        for l in donnees:
            try:
                d = parse_date(l[c_date])
                solde = parse_montant(l[c_solde])
            except (ValueError, IndexError):
                continue
            if meilleur is None or d >= meilleur[0]:
                meilleur = (d, solde)
        return meilleur[1] if meilleur else None
