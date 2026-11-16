from app.importers.bnp import CsvBnp
from app.importers.boursorama import CsvBoursorama
from app.importers.caisse_epargne import CsvCaisseEpargne
from app.importers.csv_banque import CsvBanque

# Une entrée par banque. Chaque compte stocke la clé de sa banque : c'est elle qui choisit le format d'import.
# Pour un agrégateur bancaire : ajouter ici une classe qui renvoie la même liste de LigneBrute.
IMPORTERS = {"bnp": CsvBnp(), "boursorama": CsvBoursorama(), "caisse_epargne": CsvCaisseEpargne(),
             "autre": CsvBanque()}
BANQUES = {"bnp": "BNP Paribas", "boursorama": "Boursorama", "caisse_epargne": "Caisse d'Épargne",
           "autre": "Autre banque"}
