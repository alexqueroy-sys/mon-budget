"""Montants et dates : tout est stocké en centimes (entiers) pour éviter les erreurs d'arrondi."""
import re
import unicodedata
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation


def parse_montant(texte: str) -> int:
    """'1 234,56', '-12.5', '−3,00 €', '(4,20)' -> centimes. Lève ValueError si illisible."""
    s = str(texte).strip()
    if not s:
        raise ValueError("montant vide")
    negatif = s.startswith("(") and s.endswith(")")
    s = s.replace("−", "-").replace("–", "-")  # signes moins typographiques
    s = re.sub(r"[^\d,.\-+]", "", s)  # retire espaces, espaces insécables, symbole €
    if negatif and not s.startswith("-"):
        s = "-" + s
    # Format français (1.234,56) ou anglais (1,234.56) : le dernier séparateur est la décimale
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    else:
        s = s.replace(",", ".")
    try:
        valeur = Decimal(s)
    except InvalidOperation as e:
        raise ValueError(f"montant illisible : {texte!r}") from e
    return int((valeur * 100).to_integral_value())


def format_eur(centimes: int, signe: bool = False) -> str:
    valeur = abs(int(centimes))
    entier, dec = divmod(valeur, 100)
    texte = f"{entier:,}".replace(",", " ") + f",{dec:02d} €"
    if centimes < 0:
        return "-" + texte
    return ("+" + texte) if signe and centimes > 0 else texte


def parse_date(texte: str) -> str:
    """'25/12/2025', '25-12-2025', '2025-12-25' -> '2025-12-25'."""
    s = str(texte).strip()
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%y", "%d.%m.%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"date illisible : {texte!r}")


def normaliser(texte: str) -> str:
    """Majuscules, sans accents, espaces simples : sert au hash, aux règles et à la détection."""
    s = unicodedata.normalize("NFKD", str(texte))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s.upper()).strip()


def ajouter_mois(d: date, n: int) -> date:
    mois = d.month - 1 + n
    annee = d.year + mois // 12
    mois = mois % 12 + 1
    dernier = (date(annee + (mois == 12), mois % 12 + 1, 1) - timedelta(days=1)).day
    return date(annee, mois, min(d.day, dernier))


def mois_cle(d: str) -> str:
    return d[:7]
