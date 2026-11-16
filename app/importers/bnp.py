from app.importers.csv_banque import CsvBanque


class CsvBnp(CsvBanque):
    """Export CSV BNP Paribas. Le format exact n'a pas pu être testé sur un vrai fichier :
    si l'import échoue, ajoute ici les noms de colonnes de ton export."""
    nom = "BNP Paribas"
    synonymes_extra = {
        "date": ["DATE OPERATION", "DATE DE L'OPERATION"],
        "libelle": ["LIBELLE SIMPLIFIE", "LIBELLE OPERATION", "LIBELLE"],
    }
