from app.importers.csv_banque import CsvBanque

# Source d'import utilisée par l'interface. Pour un agrégateur : ajouter une classe ici.
IMPORTERS = {"csv": CsvBanque()}
