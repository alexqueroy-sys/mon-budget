"""Import d'un export CSV bancaire.

Les formats changent selon la banque et la date : le parseur est tolérant. Il détecte le séparateur,
repère la ligne d'en-têtes par ses noms de colonnes, accepte soit une colonne « montant » signée,
soit deux colonnes débit / crédit. Chaque banque ajoute ses propres noms de colonnes
(voir bnp.py et boursorama.py) ; si un export est refusé, c'est là qu'il faut ajuster."""
import csv
import io

from app.importers.base import LigneBrute
from app.money import normaliser, parse_date, parse_montant

SYNONYMES = {
    "date": ["DATE", "DATE OPERATION", "DATE DE L'OPERATION", "DATE COMPTABLE", "DATE VALEUR"],
    "libelle": ["LIBELLE", "LIBELLE SIMPLIFIE", "DESCRIPTION", "DETAIL", "LIBELLE OPERATION", "INTITULE"],
    "montant": ["MONTANT", "AMOUNT", "MONTANT EUR"],
    "debit": ["DEBIT"],
    "credit": ["CREDIT"],
}


def _decoder(contenu: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return contenu.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ValueError("encodage du fichier non reconnu")


def _separateur(texte: str) -> str:
    echantillon = "\n".join(texte.splitlines()[:20])
    return max(";,\t", key=echantillon.count)


def _trouver_colonne(entetes: list[str], synonymes: list[str]) -> int | None:
    norm = [normaliser(e) for e in entetes]
    for synonyme in synonymes:
        if synonyme in norm:
            return norm.index(synonyme)
    return None


class CsvBanque:
    """Format générique. Les banques en héritent et complètent `synonymes_extra` (testés en premier)."""
    nom = "CSV générique"
    synonymes_extra: dict[str, list[str]] = {}

    def _syn(self, cle: str) -> list[str]:
        return self.synonymes_extra.get(cle, []) + SYNONYMES[cle]

    def _col(self, entetes: list[str], cle: str) -> int | None:
        return _trouver_colonne(entetes, self._syn(cle))

    def _lire(self, contenu: bytes):
        texte = _decoder(contenu)
        lignes = list(csv.reader(io.StringIO(texte), delimiter=_separateur(texte)))
        lignes = [[c.strip() for c in l] for l in lignes if any(c.strip() for c in l)]
        if not lignes:
            raise ValueError("fichier vide")
        for i, l in enumerate(lignes[:15]):   # ligne d'en-têtes : date + libellé + (montant ou débit)
            if (self._col(l, "date") is not None and self._col(l, "libelle") is not None
                    and (self._col(l, "montant") is not None or self._col(l, "debit") is not None)):
                return l, lignes[i + 1:]
        return None, lignes

    def parse(self, contenu: bytes) -> list[LigneBrute]:
        entete, donnees = self._lire(contenu)
        if entete is None:   # pas d'en-têtes : on suppose date ; libellé ; montant
            c_date, c_lib, c_mont, c_deb, c_cre = 0, 1, 2, None, None
        else:
            c_date, c_lib = self._col(entete, "date"), self._col(entete, "libelle")
            c_mont, c_deb, c_cre = (self._col(entete, k) for k in ("montant", "debit", "credit"))

        resultat = []
        for n, l in enumerate(donnees, start=1):
            try:
                d = parse_date(l[c_date])
            except (ValueError, IndexError):
                continue  # ligne de résumé, solde, pied de page...
            try:
                if c_mont is not None:
                    montant = parse_montant(l[c_mont])
                else:
                    deb = parse_montant(l[c_deb]) if c_deb is not None and l[c_deb] else 0
                    cre = parse_montant(l[c_cre]) if c_cre is not None and c_cre < len(l) and l[c_cre] else 0
                    montant = cre - abs(deb)
                libelle = " ".join(l[c_lib].split())
            except (ValueError, IndexError) as err:
                raise ValueError(f"ligne {n} après l'en-tête illisible : {err}") from err
            if libelle:
                resultat.append(LigneBrute(d, libelle, montant))
        if not resultat:
            raise ValueError("aucune transaction reconnue : vérifie le séparateur et les noms de colonnes")
        return resultat

    def solde_indique(self, contenu: bytes) -> int | None:
        """Solde mentionné dans le fichier, si le format en contient un. Par défaut : aucun."""
        return None
