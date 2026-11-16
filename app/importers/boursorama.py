from app.importers.csv_banque import CsvBanque, _trouver_colonne
from app.money import parse_date, parse_montant


class CsvBoursorama(CsvBanque):
    """Export CSV Boursorama. Colonnes attendues (d'après le format connu, non testé sur un vrai fichier) :
    dateOp, dateVal, label, category, categoryParent, supplierFound, amount, comment, accountNum,
    accountLabel, accountbalance. On prend la date de l'opération (dateOp), pas la date de valeur.
    Le numéro de compte (accountNum) n'est jamais lu ni enregistré."""
    nom = "Boursorama"
    synonymes_extra = {
        "date": ["DATEOP"],
        "libelle": ["LABEL"],
        "montant": ["AMOUNT"],
    }

    def solde_indique(self, contenu: bytes) -> int | None:
        """Solde du compte indiqué par la banque (colonne accountbalance), sur l'opération la plus récente."""
        entete, donnees = self._lire(contenu)
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
