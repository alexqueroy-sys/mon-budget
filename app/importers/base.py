"""Couche d'import isolée (adaptateur). Pour passer plus tard à un agrégateur bancaire (Powens, Bridge...),
il suffit d'ajouter une classe qui renvoie la même liste de LigneBrute : le reste de l'app ne change pas."""
from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class LigneBrute:
    date: str      # AAAA-MM-JJ
    libelle: str
    montant: int   # centimes, négatif = dépense


class Importer(Protocol):
    nom: str

    def parse(self, contenu: bytes) -> list[LigneBrute]: ...
