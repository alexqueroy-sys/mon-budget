from datetime import date

import streamlit as st

from app import stats
from app.importers import IMPORTERS
from app.money import format_eur, parse_montant
from app.transactions import importer_lignes
from app.ui import page

conn = page("Import et comptes")

st.subheader("Créer un compte")
with st.form("nouveau_compte", clear_on_submit=True):
    nom = st.text_input("Nom (ex. BNP courant, Livret A)")
    type_ = st.selectbox("Type", ["courant", "epargne"],
                         help="Courant : alimenté par l'import CSV. Épargne : valeur saisie à la main.")
    if st.form_submit_button("Créer") and nom.strip():
        try:
            conn.execute("INSERT INTO comptes (nom, type) VALUES (?, ?)", (nom.strip(), type_))
            conn.commit()
            st.rerun()
        except Exception:
            st.error("Ce nom existe déjà.")

comptes = stats.soldes_comptes(conn)
courants = [c for c in comptes if c["type"] == "courant"]
epargnes = [c for c in comptes if c["type"] == "epargne"]

st.subheader("Importer un export CSV")
if not courants:
    st.info("Crée d'abord un compte courant.")
else:
    cible = st.selectbox("Compte", courants, format_func=lambda c: c["nom"], key="cible_import")
    fichier = st.file_uploader("Fichier CSV (export de l'espace bancaire)", type=["csv", "txt"])
    if fichier and st.button("Importer"):
        try:
            lignes = IMPORTERS["csv"].parse(fichier.getvalue())
            ajoutees, ignorees = importer_lignes(conn, cible["id"], lignes)
            st.success(f"{ajoutees} transaction(s) ajoutée(s), {ignorees} déjà présente(s).")
        except ValueError as e:
            st.error(f"Import impossible : {e}")

    st.subheader("Caler le solde")
    st.caption("L'export ne donne pas toujours le solde. Saisis le solde réel de ton appli bancaire : "
               "l'app en déduit le solde de départ.")
    reel = st.text_input("Solde actuel du compte (€)", key="solde_reel")
    if st.button("Caler") and reel:
        try:
            stats.caler_solde(conn, cible["id"], parse_montant(reel))
            st.success("Solde calé.")
            st.rerun()
        except ValueError as e:
            st.error(str(e))

st.subheader("Relevé d'un compte d'épargne")
if not epargnes:
    st.caption("Aucun compte d'épargne. Crée-en un (type « epargne ») pour y saisir une valeur par mois.")
else:
    ep = st.selectbox("Compte d'épargne", epargnes, format_func=lambda c: c["nom"], key="cible_ep")
    d = st.date_input("Date du relevé", value=date.today())
    val = st.text_input("Solde (€)", key="solde_ep")
    if st.button("Enregistrer le relevé") and val:
        try:
            conn.execute("INSERT OR REPLACE INTO releves_epargne (compte_id, date, solde) VALUES (?, ?, ?)",
                         (ep["id"], d.isoformat(), parse_montant(val)))
            conn.commit()
            st.rerun()
        except ValueError as e:
            st.error(str(e))

st.subheader("Soldes actuels")
for c in comptes:
    st.write(f"{c['nom']} ({c['type']}) : {format_eur(c['solde'])}")
