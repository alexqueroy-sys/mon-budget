import pandas as pd
import plotly.express as px
import streamlit as st

from app import stats
from app.money import format_eur
from app.ui import page

conn = page("Dépenses")

flux = stats.flux_mensuels(conn)
if flux.empty:
    st.info("Aucune transaction pour l'instant.")
    st.stop()

st.subheader("Entrées et sorties par mois")
graph = flux.melt(id_vars="mois", value_vars=["entrees", "sorties"], var_name="sens", value_name="centimes")
graph["euros"] = graph["centimes"] / 100
st.plotly_chart(px.bar(graph, x="mois", y="euros", color="sens", barmode="group",
                       labels={"euros": "€", "mois": "Mois"}), use_container_width=True)

mois = st.selectbox("Mois", stats.mois_disponibles(conn))
par_cat = stats.depenses_par_categorie(conn, mois)
st.subheader(f"Dépenses par catégorie ({mois})")
if par_cat.empty:
    st.write("Aucune dépense ce mois-ci.")
else:
    par_cat["euros"] = par_cat["depense"] / 100
    st.plotly_chart(px.pie(par_cat, names="categorie", values="euros", hole=0.4), use_container_width=True)
    st.write(f"Total : {format_eur(int(par_cat['depense'].sum()))}")

st.subheader("Transactions du mois (modifie la catégorie directement)")
cats = [r["nom"] for r in conn.execute("SELECT nom FROM categories ORDER BY nom")]
df = pd.read_sql_query(
    "SELECT t.id, t.date, t.libelle, t.montant / 100.0 AS euros, c.nom AS categorie "
    "FROM transactions t LEFT JOIN categories c ON c.id = t.categorie_id "
    "WHERE substr(t.date, 1, 7) = ? ORDER BY t.date DESC, t.id DESC", conn, params=(mois,))
edite = st.data_editor(df, hide_index=True, use_container_width=True, disabled=["id", "date", "libelle", "euros"],
                       column_config={"categorie": st.column_config.SelectboxColumn("categorie", options=cats)})
if st.button("Enregistrer les catégories"):
    for ancien, nouveau in zip(df.itertuples(), edite.itertuples()):
        if ancien.categorie != nouveau.categorie:
            conn.execute("UPDATE transactions SET categorie_id = (SELECT id FROM categories WHERE nom = ?) WHERE id = ?",
                         (nouveau.categorie, nouveau.id))
    conn.commit()
    st.success("Enregistré.")
    st.rerun()
