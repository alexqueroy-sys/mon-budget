"""Comptes utilisateurs : mots de passe hachés (scrypt), une base SQLite par utilisateur.

Fichier des utilisateurs : data/users.json (BUDGET_USERS pour changer). Il ne contient que des hachés.
Création d'un compte, sur le serveur :
    docker compose exec budget python -m app.auth add alexis
Mode sans connexion (démo locale et tests uniquement) : BUDGET_AUTH=off. Ne jamais l'activer sur le serveur."""
import getpass
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import time
from pathlib import Path

_NOM = re.compile(r"^[a-z0-9][a-z0-9_-]{1,31}$")
_N, _R, _P = 2**14, 8, 1           # coût de scrypt
MIN_MDP = 10
ECHECS_MAX = 5                     # puis blocage temporaire
BLOCAGE_S = 300

_echecs: dict[str, list[float]] = {}   # nom -> instants des échecs récents (en mémoire)


def dossier_donnees() -> Path:
    return Path(os.environ.get("BUDGET_DATA", "data"))


def fichier_utilisateurs() -> Path:
    return Path(os.environ.get("BUDGET_USERS", str(dossier_donnees() / "users.json")))


def auth_desactivee() -> bool:
    return os.environ.get("BUDGET_AUTH", "on").lower() == "off"


def nom_valide(nom: str) -> bool:
    return bool(_NOM.fullmatch(nom or ""))


def chemin_base(nom: str) -> Path:
    """data/users/<nom>.db. Le nom est validé : impossible de sortir du dossier."""
    if not nom_valide(nom):
        raise ValueError("nom d'utilisateur invalide")
    return dossier_donnees() / "users" / f"{nom}.db"


# ---------- mots de passe ----------
def hacher(mdp: str) -> str:
    sel = secrets.token_bytes(16)
    h = hashlib.scrypt(mdp.encode(), salt=sel, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${sel.hex()}${h.hex()}"


def verifier(mdp: str, enregistre: str) -> bool:
    try:
        algo, n, r, p, sel, h = enregistre.split("$")
        if algo != "scrypt":
            return False
        calcule = hashlib.scrypt(mdp.encode(), salt=bytes.fromhex(sel), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(calcule, bytes.fromhex(h))
    except (ValueError, TypeError):
        return False


# ---------- fichier des utilisateurs ----------
def charger() -> dict[str, str]:
    f = fichier_utilisateurs()
    if not f.exists():
        return {}
    return json.loads(f.read_text(encoding="utf-8"))


def _ecrire(utilisateurs: dict[str, str]) -> None:
    f = fichier_utilisateurs()
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)   # lisible par le propriétaire seulement
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(utilisateurs, fh, indent=2)
    os.replace(tmp, f)


def ajouter(nom: str, mdp: str) -> None:
    if not nom_valide(nom):
        raise ValueError("Nom invalide : 2 à 32 caractères, minuscules, chiffres, - ou _.")
    if len(mdp) < MIN_MDP:
        raise ValueError(f"Mot de passe trop court (minimum {MIN_MDP} caractères).")
    utilisateurs = charger()
    utilisateurs[nom] = hacher(mdp)   # sur un nom existant : change le mot de passe
    _ecrire(utilisateurs)


def supprimer(nom: str) -> None:
    utilisateurs = charger()
    utilisateurs.pop(nom, None)
    _ecrire(utilisateurs)   # la base de l'utilisateur n'est PAS effacée : à faire à la main


# ---------- connexion ----------
def bloque(nom: str, maintenant: float | None = None) -> bool:
    t = maintenant if maintenant is not None else time.time()
    recents = [x for x in _echecs.get(nom, []) if t - x < BLOCAGE_S]
    _echecs[nom] = recents
    return len(recents) >= ECHECS_MAX


def connecter(nom: str, mdp: str, maintenant: float | None = None) -> str | None:
    """Renvoie None si OK, sinon le message d'erreur à afficher (volontairement vague)."""
    t = maintenant if maintenant is not None else time.time()
    nom = (nom or "").strip().lower()
    if bloque(nom, t):
        return "Trop d'essais. Réessaie dans quelques minutes."
    enregistre = charger().get(nom) if nom_valide(nom) else None
    # Même travail de hachage que l'utilisateur existe ou non : pas d'indice sur les noms valides
    ok = verifier(mdp, enregistre or hacher("inexistant")) and enregistre is not None
    if ok:
        _echecs.pop(nom, None)
        return None
    _echecs.setdefault(nom, []).append(t)
    return "Identifiant ou mot de passe incorrect."


def _cli() -> None:
    if len(sys.argv) == 3 and sys.argv[1] in ("add", "remove"):
        nom = sys.argv[2].strip().lower()
        if sys.argv[1] == "remove":
            supprimer(nom)
            print(f"Utilisateur {nom} retiré (sa base n'est pas effacée).")
            return
        mdp = getpass.getpass("Mot de passe : ")
        if mdp != getpass.getpass("Confirmer : "):
            sys.exit("Les deux saisies diffèrent.")
        try:
            ajouter(nom, mdp)
        except ValueError as e:
            sys.exit(str(e))
        print(f"Utilisateur {nom} enregistré. Base : {chemin_base(nom)}")
    else:
        print("Usage : python -m app.auth add <nom> | remove <nom>")


if __name__ == "__main__":
    _cli()
