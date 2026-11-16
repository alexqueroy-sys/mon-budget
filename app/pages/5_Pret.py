from datetime import date

import pandas as pd
import streamlit as st

from app import loan
from app.importers import IMPORTERS
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

with st.expander("Lire le fichier de la banque (capital restant dû réel)"):
    st.caption("Export BNP du prêt : la première ligne donne le capital restant dû à la date de l'export. "
               "Ce chiffre remplace le calcul théorique tant que tu n'importes pas un fichier plus récent.")
    fichier = st.file_uploader("Fichier CSV du prêt", type=["csv", "txt"], key="csv_pret")
    if fichier:
        try:
            resume = IMPORTERS["bnp"].resume_compte(fichier.getvalue())
            if resume is None:
                st.error("Ce fichier n'a pas le format d'un export BNP (première ligne de résumé du compte).")
            elif resume["solde"] >= 0:
                st.error("Le solde de ce fichier n'est pas négatif : ce n'est pas le fichier d'un prêt.")
            elif not conn.execute("SELECT 1 FROM prets").fetchone():
                st.warning("Enregistre d'abord le prêt ci-dessus (capital, taux, durée), puis relis ce fichier.")
            else:
                reel = -resume["solde"]
                st.info(f"{resume['libelle']} {resume['numero_masque']} : capital restant dû "
                        f"{format_eur(reel)} au {date.fromisoformat(resume['date']).strftime('%d/%m/%Y')}.")
                if st.button("Utiliser ce capital restant dû"):
                    conn.execute("UPDATE prets SET capital_restant_reel = ?, date_reel = ?", (reel, resume["date"]))
                    conn.commit()
                    st.rerun()
        except ValueError as e:
            st.error(f"Lecture impossible : {e}")

for p in conn.execute("SELECT * FROM prets").fetchall():
    lignes = loan.tableau_amortissement(p["capital"], p["taux_annuel"], date.fromisoformat(p["date_debut"]),
                                        p["differe_mois"], p["duree_mois"])
    r = loan.resume(lignes, p["capital"], date.today())
    st.subheader(p["nom"])
    c1, c2, c3 = st.columns(3)
    if p["capital_restant_reel"] is not None:
        c1.metric("Capital restant dû", format_eur(p["capital_restant_reel"]))
        c1.caption(f"Chiffre de la banque au {date.fromisoformat(p['date_reel']).strftime('%d/%m/%Y')}. "
                   f"Calcul théorique : {format_eur(r['capital_restant'])}.")
    else:
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
