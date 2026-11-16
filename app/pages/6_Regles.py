import streamlit as st

from app.transactions import appliquer_regles
from app.ui import page

conn = page("Règles de catégorisation")
st.caption("Si le libellé contient le motif (sans tenir compte des accents ni des majuscules), "
           "la transaction reçoit la catégorie. Les règles du haut passent en premier.")

for r in conn.execute("SELECT r.id, r.motif, c.nom FROM regles r JOIN categories c ON c.id = r.categorie_id "
                      "ORDER BY r.priorite, r.id").fetchall():
    a, b, c = st.columns([3, 3, 1])
    a.write(r["motif"])
    b.write(r["nom"])
    if c.button("Supprimer", key=f"del{r['id']}"):
        conn.execute("DELETE FROM regles WHERE id = ?", (r["id"],))
        conn.commit()
        st.rerun()

with st.form("regle", clear_on_submit=True):
    motif = st.text_input("Motif (ex. UBER EATS)")
    cats = [r["nom"] for r in conn.execute("SELECT nom FROM categories ORDER BY nom")]
    cat = st.selectbox("Catégorie", cats)
    if st.form_submit_button("Ajouter") and motif.strip():
        conn.execute("INSERT INTO regles (motif, categorie_id, priorite) "
                     "SELECT ?, id, (SELECT COALESCE(MAX(priorite), 0) + 1 FROM regles) FROM categories WHERE nom = ?",
                     (motif.strip(), cat))
        conn.commit()
        n = appliquer_regles(conn)
        st.success(f"Règle ajoutée, {n} transaction(s) catégorisée(s).")
        st.rerun()

if st.button("Recalculer toutes les catégories avec les règles"):
    st.success(f"{appliquer_regles(conn, tout_recalculer=True)} transaction(s) modifiée(s). "
               "Attention : cela écrase les catégories choisies à la main pour les lignes qui matchent une règle.")
