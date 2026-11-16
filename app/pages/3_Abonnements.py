import streamlit as st

from app import subscriptions
from app.money import format_eur
from app.ui import page

conn = page("Abonnements")

if st.button("Analyser les transactions"):
    n = subscriptions.detecter(conn)
    st.success(f"{n} abonnement(s) détecté(s) ou mis à jour.")

mensuel, annuel = subscriptions.total_valides(conn)
c1, c2 = st.columns(2)
c1.metric("Total mensuel (validés)", format_eur(mensuel))
c2.metric("Total annuel (validés)", format_eur(annuel))


def bloc(statut: str, titre: str, actions: list[tuple[str, str]]) -> None:
    st.subheader(titre)
    lignes = conn.execute("SELECT * FROM abonnements WHERE statut = ? ORDER BY montant DESC", (statut,)).fetchall()
    if not lignes:
        st.caption("Rien ici.")
    for a in lignes:
        col = st.columns([3, 2, 2, 2] + [1] * len(actions))
        col[0].write(f"**{a['nom']}**")
        col[1].write(f"{format_eur(a['montant'])} / {a['periode']}")
        col[2].write(f"dernier : {a['derniere_date']}")
        col[3].write(f"prochain : {subscriptions.prochaine_echeance(a['derniere_date'], a['periode']).strftime('%d/%m/%Y')}"
                     if statut == "valide" else "")
        for i, (label, nouveau) in enumerate(actions):
            if col[4 + i].button(label, key=f"{statut}-{a['id']}-{nouveau}"):
                conn.execute("UPDATE abonnements SET statut = ? WHERE id = ?", (nouveau, a["id"]))
                conn.commit()
                st.rerun()


bloc("candidat", "À valider (faux positifs possibles)", [("Valider", "valide"), ("Rejeter", "rejete")])
bloc("valide", "Abonnements validés", [("Retirer", "rejete")])
bloc("rejete", "Rejetés", [("Rétablir", "candidat")])
