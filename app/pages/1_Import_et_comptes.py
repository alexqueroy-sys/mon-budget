from datetime import date

import streamlit as st

from app import stats
from app.importers import BANQUES, IMPORTERS
from app.money import format_eur, parse_montant
from app.transactions import importer_lignes, marquer_virements_internes, virements_internes_probables
from app.ui import page

conn = page("Import et comptes")

st.subheader("Créer un compte")
with st.form("nouveau_compte", clear_on_submit=True):
    banque = st.selectbox("Banque", list(BANQUES), format_func=BANQUES.get,
                          help="Choisit le format du fichier CSV à l'import.")
    nom = st.text_input("Nom du compte (ex. Compte courant, Livret A)")
    type_ = st.selectbox("Type", ["courant", "epargne"],
                         help="Courant : alimenté par l'import CSV. Épargne : valeur saisie à la main.")
    if st.form_submit_button("Créer") and nom.strip():
        try:
            conn.execute("INSERT INTO comptes (nom, type, banque) VALUES (?, ?, ?)", (nom.strip(), type_, banque))
            conn.commit()
            st.rerun()
        except Exception:
            st.error("Ce nom existe déjà.")

comptes = stats.soldes_comptes(conn)
courants = [c for c in comptes if c["type"] == "courant"]
epargnes = [c for c in comptes if c["type"] == "epargne"]


def libelle_compte(c: dict) -> str:
    return f"{BANQUES.get(c['banque'], c['banque'])} · {c['nom']}"


st.subheader("Importer un export CSV")
if not courants:
    st.info("Crée d'abord un compte courant.")
else:
    cible = st.selectbox("Compte", courants, format_func=libelle_compte, key="cible_import")
    importer = IMPORTERS[cible["banque"]]
    st.caption(f"Format utilisé : {importer.nom}. Télécharge depuis l'espace client de cette banque l'export CSV "
               f"des opérations de ce compte. Un export par compte, jamais plusieurs comptes dans un même fichier.")
    fichier = st.file_uploader("Fichier CSV", type=["csv", "txt"], key=f"csv{cible['id']}")
    if fichier and st.button("Importer"):
        try:
            contenu = fichier.getvalue()
            ajoutees, ignorees = importer_lignes(conn, cible["id"], importer.parse(contenu))
            st.success(f"{ajoutees} transaction(s) ajoutée(s), {ignorees} déjà présente(s).")
            st.session_state["solde_fichier"] = (cible["id"], importer.solde_indique(contenu))
        except ValueError as e:
            st.error(f"Import impossible : {e}")

    indique = st.session_state.get("solde_fichier")
    if indique and indique[0] == cible["id"] and indique[1] is not None:
        st.info(f"Le fichier indique un solde de {format_eur(indique[1])}. Compare avec l'appli de ta banque, "
                "puis valide si c'est bon.")
        if st.button("Caler le solde sur cette valeur"):
            stats.caler_solde(conn, cible["id"], indique[1])
            st.session_state.pop("solde_fichier")
            st.rerun()

    st.subheader("Caler le solde à la main")
    st.caption("L'export ne donne pas toujours le solde. Saisis le solde réel de l'appli de ta banque : "
               "l'app en déduit le solde de départ.")
    reel = st.text_input("Solde actuel du compte (€)", key="solde_reel")
    if st.button("Caler") and reel:
        try:
            stats.caler_solde(conn, cible["id"], parse_montant(reel))
            st.success("Solde calé.")
            st.rerun()
        except ValueError as e:
            st.error(str(e))

st.subheader("Virements entre tes comptes")
paires = virements_internes_probables(conn)
if not paires:
    st.caption("Aucun virement probable à vérifier. Un virement entre tes banques (même montant, sortie d'un côté, "
               "entrée de l'autre, à quelques jours d'écart) apparaîtra ici.")
else:
    st.caption("Ces opérations ressemblent à des virements entre tes propres comptes. Coche celles qui en sont : "
               "elles ne compteront plus comme dépense ni comme revenu.")
    choisies = []
    for i, p in enumerate(paires):
        if st.checkbox(f"{format_eur(abs(p['montant']))} : {p['de']} ({p['date_sortie']}) vers {p['vers']} "
                       f"({p['date_entree']}) · {p['libelle_sortie']}", key=f"vi{i}"):
            choisies += [p["sortie_id"], p["entree_id"]]
    if choisies and st.button("Marquer comme virements internes"):
        marquer_virements_internes(conn, choisies)
        st.rerun()

st.subheader("Relevé d'un compte d'épargne")
if not epargnes:
    st.caption("Aucun compte d'épargne. Crée-en un (type « epargne ») pour y saisir une valeur par mois.")
else:
    ep = st.selectbox("Compte d'épargne", epargnes, format_func=libelle_compte, key="cible_ep")
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
for banque, g in stats.soldes_par_banque(comptes).items():
    st.write(f"**{BANQUES.get(banque, banque)}**")
    for c in g["comptes"]:
        st.write(f"{c['nom']} ({c['type']}) : {format_eur(c['solde'])}")
