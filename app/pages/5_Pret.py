from datetime import date

import pandas as pd
import streamlit as st

from app import loan
from app.money import format_eur, parse_montant
from app.ui import page

conn = page("Prêt étudiant")
st.caption("Compte à part : la dette n'est jamais mélangée à l'argent disponible ni à l'épargne. "
           "Les calculs sont indicatifs : compare avec le tableau d'amortissement de ton contrat.")

with st.expander("Ajouter ou remplacer un prêt", expanded=not conn.execute("SELECT 1 FROM prets").fetchone()):
    with st.form("pret"):
        nom = st.text_input("Nom", value="Prêt étudiant")
        capital = st.text_input("Capital emprunté (€)")
        taux = st.number_input("Taux annuel (%)", min_value=0.0, max_value=30.0, value=1.0, step=0.01)
        debut = st.date_input("Début du prêt (début du différé)", value=date.today())
        differe = st.number_input("Mois de différé (intérêts capitalisés)", min_value=0, max_value=120, value=0)
        duree = st.number_input("Nombre de mensualités après le différé", min_value=1, max_value=480, value=60)
        if st.form_submit_button("Enregistrer"):
            try:
                conn.execute("DELETE FROM prets")
                conn.execute("INSERT INTO prets (nom, capital, taux_annuel, date_debut, differe_mois, duree_mois) "
                             "VALUES (?, ?, ?, ?, ?, ?)",
                             (nom, parse_montant(capital), taux / 100, debut.isoformat(), differe, duree))
                conn.commit()
                st.rerun()
            except Exception as e:
                st.error(f"Prêt invalide : {e}")

for p in conn.execute("SELECT * FROM prets").fetchall():
    lignes = loan.tableau_amortissement(p["capital"], p["taux_annuel"], date.fromisoformat(p["date_debut"]),
                                        p["differe_mois"], p["duree_mois"])
    r = loan.resume(lignes, p["capital"], date.today())
    st.subheader(p["nom"])
    c1, c2, c3 = st.columns(3)
    c1.metric("Capital restant dû", format_eur(r["capital_restant"]))
    c2.metric("Mensualités restantes", r["mensualites_restantes"])
    c3.metric("Intérêts totaux", format_eur(r["interets_totaux"]))
    if r["prochaine_echeance"]:
        e = r["prochaine_echeance"]
        st.write(f"Prochaine échéance : {e.date.strftime('%d/%m/%Y')}, {format_eur(e.mensualite)}")
    tableau = pd.DataFrame([{"n°": l.numero, "date": l.date, "phase": l.phase, "mensualité": l.mensualite / 100,
                             "intérêts": l.interets / 100, "capital remboursé": l.capital_rembourse / 100,
                             "capital restant": l.capital_restant / 100} for l in lignes])
    st.dataframe(tableau, hide_index=True, use_container_width=True)
