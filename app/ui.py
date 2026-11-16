"""Utilitaires partagés par les pages Streamlit : connexion, base de l'utilisateur, affichage."""
import streamlit as st

from app import auth, db
from app.money import format_eur


def _ecran_connexion() -> None:
    st.title("Connexion")
    if not auth.charger():
        st.error("Aucun utilisateur n'existe. Sur le serveur : docker compose exec budget python -m app.auth add <nom>")
        st.stop()
    with st.form("connexion"):
        nom = st.text_input("Identifiant")
        mdp = st.text_input("Mot de passe", type="password")
        if st.form_submit_button("Se connecter"):
            erreur = auth.connecter(nom, mdp)
            if erreur:
                st.error(erreur)
            else:
                st.session_state["user"] = nom.strip().lower()
                st.rerun()
    st.stop()


def utilisateur_courant() -> str:
    if auth.auth_desactivee():
        return "local"   # démo et tests seulement
    if "user" not in st.session_state:
        _ecran_connexion()
    return st.session_state["user"]


def page(titre: str, icone: str = ""):
    st.set_page_config(page_title=f"{titre} · Budget", page_icon=icone or None, layout="wide")
    user = utilisateur_courant()
    if not auth.auth_desactivee():
        with st.sidebar:
            st.write(f"Connecté : **{user}**")
            if st.button("Se déconnecter"):
                st.session_state.pop("user", None)
                st.rerun()
    st.title(titre)
    # Une connexion par exécution de page, sur la base de CET utilisateur uniquement.
    chemin = db.chemin_db() if auth.auth_desactivee() else auth.chemin_base(user)
    return db.connect(chemin)


def metric_eur(colonne, titre: str, centimes: int, aide: str | None = None) -> None:
    colonne.metric(titre, format_eur(centimes), help=aide)


ETATS = {"ok": "dans le budget", "attention": "attention (80 % atteints)", "depasse": "dépassé"}
