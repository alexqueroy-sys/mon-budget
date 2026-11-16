from datetime import date, timedelta

import streamlit as st

from app import stats, subscriptions
from app.importers import BANQUES
from app.money import format_eur
from app.ui import ETATS, metric_eur, page

conn = page("Vue d'ensemble")

p = stats.patrimoine(conn)
c1, c2, c3 = st.columns(3)
metric_eur(c1, "Argent disponible", p["argent_dispo"], "Comptes courants uniquement.")
metric_eur(c2, "Épargne", p["epargne"], "Livret A, etc. Séparée de l'argent disponible.")
metric_eur(c3, "Dette restante", p["dette"], "Capital restant du prêt étudiant, jamais déduit des deux autres.")
st.caption(f"Valeur nette indicative (disponible + épargne − dette) : {format_eur(p['valeur_nette'])}")

st.subheader("Comptes par banque")
comptes = stats.soldes_comptes(conn)
if not comptes:
    st.info("Aucun compte. Va dans « Import et comptes » pour en créer un et importer un CSV.")
for banque, g in stats.soldes_par_banque(comptes).items():
    st.markdown(f"**{BANQUES.get(banque, banque)}** : disponible {format_eur(g['courant'])}, épargne {format_eur(g['epargne'])}")
    for c in g["comptes"]:
        suite = f" (relevé du {c['releve_du']})" if c["releve_du"] else ""
        st.write(f"{c['nom']} ({c['type']}) : {format_eur(c['solde'])}{suite}")

prev = stats.prevision(conn)
if prev["base"]:
    st.subheader("Prévision mensuelle")
    st.write(f"Moyenne des {prev['base']} derniers mois : entrées {format_eur(prev['entrees'])}, "
             f"sorties {format_eur(prev['sorties'])}, solde du mois {format_eur(prev['net'], signe=True)}.")

st.subheader("Abonnements dans les 30 prochains jours")
limite = date.today() + timedelta(days=30)
a_venir = []
for a in conn.execute("SELECT * FROM abonnements WHERE statut = 'valide'"):
    e = subscriptions.prochaine_echeance(a["derniere_date"], a["periode"])
    if e <= limite:
        a_venir.append((e, a["nom"], a["montant"]))
for e, nom, m in sorted(a_venir):
    st.write(f"{e.strftime('%d/%m/%Y')} : {nom}, {format_eur(m)}")
if not a_venir:
    st.write("Rien de prévu (ou aucun abonnement validé).")

alertes = [b for b in stats.suivi_budgets(conn, date.today().strftime("%Y-%m")) if b["etat"] != "ok"]
if alertes:
    st.subheader("Budgets à surveiller ce mois-ci")
    for b in alertes:
        st.warning(f"{b['categorie']} : {format_eur(b['depense'])} sur {format_eur(b['budget'])} ({ETATS[b['etat']]})")
