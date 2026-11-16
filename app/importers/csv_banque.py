"""Import d'un export CSV bancaire (BNP et banques au format proche).

Le format exact des exports change selon la banque et la date : ce parseur est donc tolérant.
Il détecte le séparateur, repère la ligne d'en-têtes par ses noms de colonnes, accepte soit une
colonne « montant » signée, soit deux colonnes débit / crédit. Si ton export ne passe pas,
ajuste SYNONYMES plus bas : c'est le seul endroit à toucher."""
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


def _trouver_colonne(entetes: list[str], cle: str) -> int | None:
    norm = [normaliser(e) for e in entetes]
    for synonyme in SYNONYMES[cle]:
        if synonyme in norm:
            return norm.index(synonyme)
    return None


class CsvBanque:
    nom = "CSV banque (BNP et similaires)"

    def parse(self, contenu: bytes) -> list[LigneBrute]:
        texte = _decoder(contenu)
        lignes = list(csv.reader(io.StringIO(texte), delimiter=_separateur(texte)))
        lignes = [[c.strip() for c in l] for l in lignes if any(c.strip() for c in l)]
        if not lignes:
            raise ValueError("fichier vide")

        # 1. Ligne d'en-têtes : la première qui contient une colonne date ET (montant OU débit/crédit)
        idx_entete = None
        for i, l in enumerate(lignes[:15]):
            if (_trouver_colonne(l, "date") is not None and _trouver_colonne(l, "libelle") is not None
                    and (_trouver_colonne(l, "montant") is not None or _trouver_colonne(l, "debit") is not None)):
                idx_entete = i
                break

        if idx_entete is None:
            # Pas d'en-têtes : on suppose date ; libellé ; montant
            c_date, c_lib, c_mont, c_deb, c_cre = 0, 1, 2, None, None
            donnees = lignes
        else:
            e = lignes[idx_entete]
            c_date, c_lib = _trouver_colonne(e, "date"), _trouver_colonne(e, "libelle")
            c_mont, c_deb, c_cre = (_trouver_colonne(e, k) for k in ("montant", "debit", "credit"))
            donnees = lignes[idx_entete + 1:]

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
