"""Export CSV BNP Paribas.

Format réel (vérifié sur un export de 2026) : aucun en-tête de colonnes. Séparateur « ; », dates JJ/MM/AA.
- 1re ligne : résumé du compte  -> libellé ; libellé ; numéro masqué (****1234) ; date ; (vide) ; solde
- lignes suivantes, une par opération -> date ; catégorie ; type ; libellé détaillé ; montant signé

Le libellé détaillé contient beaucoup de bruit (références, identifiants de mandat, numéro de carte
partiel). On le nettoie pour que la même dépense revienne avec le même libellé d'un mois à l'autre
(indispensable à la détection des abonnements) et pour que les références ne gonflent pas la base.
Si le fichier ne ressemble pas à ce format, on retombe sur le parseur générique (export avec en-têtes)."""
import csv
import html
import io
import re

from app.importers.base import LigneBrute
from app.importers.csv_banque import CsvBanque, _decoder, _separateur
from app.money import parse_date, parse_montant

_NUM_MASQUE = re.compile(r"^\*+\d+$")

# Bruit retiré du libellé détaillé (appliqué dans cet ordre)
_BRUIT = [
    re.compile(r"\s+ID EMETTEUR/.*$"),                               # prélèvements : tout ce qui suit le nom
    re.compile(r"\s+ECH/\d+"),                                       # date d'échéance variable
    re.compile(r"\s+CARTE\s+\d{4}X+\d+"),                            # numéro de carte partiel
    re.compile(r"\bDU \d{6}\b"),                                     # date de l'achat collée au libellé
    re.compile(r"\s*\(CAPITAL DU [\d.,\s]+EUR\)"),                   # capital restant : change chaque trimestre
    re.compile(r"\s*/REF(?:DO|BEN)?\b(?:\s+(?:NOTPROVIDED|[A-Z0-9]{10,}))?"),  # références de virement
]


def _nettoyer(libelle: str) -> str:
    s = libelle
    for motif in _BRUIT:
        s = motif.sub("", s)
    s = re.sub(r"\s*/\s*$", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _lignes(contenu: bytes) -> list[list[str]]:
    texte = _decoder(contenu)
    lecteur = csv.reader(io.StringIO(texte), delimiter=_separateur(texte))
    return [[c.strip() for c in l] for l in lecteur if any(c.strip() for c in l)]


def _est_format_bnp(lignes: list[list[str]]) -> bool:
    return bool(lignes) and len(lignes[0]) >= 6 and bool(_NUM_MASQUE.match(lignes[0][2]))


class CsvBnp(CsvBanque):
    nom = "BNP Paribas"
    synonymes_extra = {
        "date": ["DATE OPERATION", "DATE DE L'OPERATION"],
        "libelle": ["LIBELLE SIMPLIFIE", "LIBELLE OPERATION", "LIBELLE"],
    }

    def resume_compte(self, contenu: bytes) -> dict | None:
        """Infos de la 1re ligne : {'libelle', 'numero_masque', 'date', 'solde'} (None si autre format)."""
        lignes = _lignes(contenu)
        if not _est_format_bnp(lignes):
            return None
        l = lignes[0]
        return {
            "libelle": html.unescape(html.unescape(l[1] or l[0])),   # « Pr&amp;ecirc;t » est doublement encodé
            "numero_masque": l[2],
            "date": parse_date(l[3]),
            "solde": parse_montant(l[5]),
        }

    def parse(self, contenu: bytes) -> list[LigneBrute]:
        lignes = _lignes(contenu)
        if not _est_format_bnp(lignes):
            return super().parse(contenu)
        sortie = []
        for n, l in enumerate(lignes[1:], start=2):
            if len(l) < 5:
                raise ValueError(f"ligne {n} : 5 colonnes attendues, {len(l)} trouvées")
            try:
                date = parse_date(l[0])
                montant = parse_montant(l[-1])
            except ValueError as e:
                raise ValueError(f"ligne {n} illisible : {e}") from e
            libelle = _nettoyer(l[3]) or l[2] or l[1]
            sortie.append(LigneBrute(date=date, libelle=libelle, montant=montant))
        return sortie   # liste vide possible : compte sans opération (ex. Livret Jeune)

    def solde_indique(self, contenu: bytes) -> int | None:
        r = self.resume_compte(contenu)
        return r["solde"] if r else None
