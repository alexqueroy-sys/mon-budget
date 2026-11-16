from app.importers.csv_banque import CsvBanque


class CsvCaisseEpargne(CsvBanque):
    """Export CSV Caisse d'Épargne. Colonnes attendues (d'après le format connu des banques du groupe BPCE,
    non testé sur un vrai fichier) : Date de comptabilisation, Libelle simplifie, Libelle operation, Reference,
    Informations complementaires, Type operation, Categorie, Sous categorie, Debit, Credit, Date operation,
    Date de valeur, Pointage operation. On prend la date de l'opération, un libellé simplifié, et les colonnes
    Debit / Credit. Si l'export est refusé ou si les libellés sont trop pauvres, ajuste `synonymes_extra`
    (par exemple mets "LIBELLE OPERATION" avant "LIBELLE SIMPLIFIE" pour des libellés plus détaillés)."""
    nom = "Caisse d'Épargne"
    synonymes_extra = {
        "date": ["DATE OPERATION", "DATE DE COMPTABILISATION"],
        "libelle": ["LIBELLE SIMPLIFIE", "LIBELLE OPERATION"],
        "debit": ["DEBIT"],
        "credit": ["CREDIT"],
    }
