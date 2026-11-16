from datetime import date

import streamlit as st

from app import stats
from app.money import format_eur, parse_montant
from app.ui import ETATS, page

conn = page("Budgets et objectifs")

st.header("Budgets mensuels")
mois = st.selectbox("Mois", stats.mois_disponibles(conn))
for b in stats.suivi_budgets(conn, mois):
    st.write(f"**{b['categorie']}** : {format_eur(b['depense'])} sur {format_eur(b['budget'])} ({ETATS[b['etat']]})")
    st.progress(min(b["part"], 1.0))

with st.form("budget", clear_on_submit=True):
    cats = [r["nom"] for r in conn.execute("SELECT nom FROM categories WHERE type = 'depense' ORDER BY nom")]
    cat = st.selectbox("Catégorie", cats)
    montant = st.text_input("Limite par mois (€)")
    if st.form_submit_button("Définir le budget") and montant:
        try:
            conn.execute("INSERT OR REPLACE INTO budgets (categorie_id, montant) "
                         "SELECT id, ? FROM categories WHERE nom = ?", (parse_montant(montant), cat))
            conn.commit()
            st.rerun()
        except (ValueError, Exception) as e:
            st.error(f"Montant invalide : {e}")

st.header("Objectifs d'épargne")
for o in conn.execute("SELECT * FROM objectifs ORDER BY id").fetchall():
    total = conn.execute("SELECT COALESCE(SUM(montant), 0) FROM versements WHERE objectif_id = ?", (o["id"],)).fetchone()[0]
    conseil = stats.objectif_conseil(o["cible"], total, o["date_limite"])
    st.write(f"**{o['nom']}** : {format_eur(total)} sur {format_eur(o['cible'])}")
    st.progress(min(total / o["cible"], 1.0))
    if conseil["atteint"]:
        st.success("Objectif atteint.")
    elif conseil["par_mois"]:
        st.caption(f"Reste {format_eur(conseil['reste'])}, soit environ {format_eur(conseil['par_mois'])} par mois "
                   f"pendant {conseil['mois_restants']} mois.")
    elif conseil["mois_restants"] == 0:
        st.caption(f"Reste {format_eur(conseil['reste'])}, la date limite est passée.")
    else:
        st.caption(f"Reste {format_eur(conseil['reste'])}.")
    c1, c2 = st.columns([2, 1])
    v = c1.text_input("Versement (négatif = retrait)", key=f"v{o['id']}")
    if c2.button("Ajouter", key=f"b{o['id']}") and v:
        try:
            conn.execute("INSERT INTO versements (objectif_id, date, montant) VALUES (?, ?, ?)",
                         (o["id"], date.today().isoformat(), parse_montant(v)))
            conn.commit()
            st.rerun()
        except Exception as e:
            st.error(f"Versement invalide : {e}")

with st.form("objectif", clear_on_submit=True):
    nom = st.text_input("Nouvel objectif")
    cible = st.text_input("Montant cible (€)")
    limite = st.date_input("Date limite (facultative)", value=None)
    if st.form_submit_button("Créer") and nom and cible:
        try:
            conn.execute("INSERT INTO objectifs (nom, cible, date_limite) VALUES (?, ?, ?)",
                         (nom, parse_montant(cible), limite.isoformat() if limite else None))
            conn.commit()
            st.rerun()
        except Exception as e:
            st.error(f"Objectif invalide : {e}")
