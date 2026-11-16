"""Prêt étudiant : compte à part (dette), jamais mélangé à l'argent disponible ni à l'épargne.

Modèle : pendant le différé, les intérêts sont capitalisés chaque mois ; ensuite, mensualités constantes.
Les contrats réels peuvent différer (jours exacts, assurance, taux nominal ou proportionnel) :
saisis les chiffres de ton contrat et compare avec ton tableau d'amortissement officiel."""
from dataclasses import dataclass
from datetime import date

from app.money import ajouter_mois


@dataclass(frozen=True)
class EcheanceLigne:
    numero: int
    date: date
    phase: str          # 'differe' ou 'remboursement'
    mensualite: int     # centimes (0 pendant le différé)
    interets: int       # centimes
    capital_rembourse: int
    capital_restant: int


def mensualite_constante(capital: int, taux_mensuel: float, n: int) -> int:
    if n <= 0:
        raise ValueError("durée invalide")
    if taux_mensuel == 0:
        return round(capital / n)
    return round(capital * taux_mensuel / (1 - (1 + taux_mensuel) ** -n))


def tableau_amortissement(capital: int, taux_annuel: float, date_debut: date,
                          differe_mois: int, duree_mois: int) -> list[EcheanceLigne]:
    r = taux_annuel / 12
    lignes: list[EcheanceLigne] = []
    restant = capital
    numero = 0
    for i in range(differe_mois):  # intérêts capitalisés
        numero += 1
        interets = round(restant * r)
        restant += interets
        lignes.append(EcheanceLigne(numero, ajouter_mois(date_debut, i + 1), "differe", 0, interets, 0, restant))
    mensualite = mensualite_constante(restant, r, duree_mois)
    for j in range(duree_mois):
        numero += 1
        interets = round(restant * r)
        if j == duree_mois - 1:  # dernière échéance : solde exact, pas de reste d'arrondi
            capital_rembourse = restant
            paiement = restant + interets
        else:
            paiement = mensualite
            capital_rembourse = paiement - interets
        restant -= capital_rembourse
        lignes.append(EcheanceLigne(numero, ajouter_mois(date_debut, differe_mois + j + 1), "remboursement",
                                    paiement, interets, capital_rembourse, restant))
    return lignes


def capital_restant_au(lignes: list[EcheanceLigne], capital_initial: int, jour: date) -> int:
    """Dette à une date donnée : capital restant après la dernière échéance passée."""
    restant = capital_initial
    for l in lignes:
        if l.date <= jour:
            restant = l.capital_restant
        else:
            break
    return restant


def resume(lignes: list[EcheanceLigne], capital_initial: int, jour: date) -> dict:
    passees = [l for l in lignes if l.date <= jour]
    avenir = [l for l in lignes if l.date > jour and l.phase == "remboursement"]
    return {
        "capital_restant": capital_restant_au(lignes, capital_initial, jour),
        "mensualites_restantes": len(avenir),
        "prochaine_echeance": avenir[0] if avenir else None,
        "interets_totaux": sum(l.interets for l in lignes),
        "echeances_passees": len(passees),
    }
