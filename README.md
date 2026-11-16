# Budget perso

Suivi de budget personnel, pour plusieurs utilisateurs aux données séparées : comptes (courant, épargne), dépenses par catégorie, abonnements, budgets, objectifs d'épargne et prêt étudiant. Python, SQLite, Streamlit, Docker.

L'architecture et les fonctionnalités s'inspirent du dépôt public `alexqueroy-sys/mon-budget` (application JavaScript dans le navigateur). Aucun code ni aucune donnée n'en est repris : tout est réécrit pour une pile Python avec base SQLite sur un serveur personnel.

## Architecture

```
Export CSV banque -> importers/ (adaptateur) -> transactions.py (anti-doublons, règles)
                  -> SQLite (data/users/<nom>.db) -> stats.py / subscriptions.py / loan.py -> pages Streamlit
```

| Fichier | Rôle |
| --- | --- |
| `app/auth.py` | Comptes (mots de passe hachés avec scrypt), blocage après 5 échecs, une base SQLite par utilisateur |
| `app/db.py` | Schéma SQLite, migrations (`PRAGMA user_version`), catégories et règles par défaut |
| `app/money.py` | Montants en centimes (entiers), dates, normalisation des libellés |
| `app/importers/` | Couche d'import isolée : remplaçable par un agrégateur bancaire sans toucher au reste |
| `app/transactions.py` | Import avec hash anti-doublons, catégorisation par règles |
| `app/subscriptions.py` | Détection d'abonnements (même marchand, montant à 5 % près, intervalle régulier), à valider à la main |
| `app/loan.py` | Prêt avec différé (intérêts capitalisés), tableau d'amortissement |
| `app/stats.py` | Patrimoine, flux mensuels, budgets (alerte à 80 %), objectifs, prévision |
| `app/Accueil.py`, `app/pages/` | Interface |

Règle de conception : l'argent disponible (comptes courants), l'épargne et la dette sont trois blocs séparés. La dette n'est jamais retranchée du total « argent disponible ».

## Essayer en local, sans données réelles

```bash
python -m venv .venv && source .venv/bin/activate        # Windows : .venv\Scripts\activate
pip install -r requirements-dev.txt
BUDGET_AUTH=off BUDGET_DB=data/demo.db python scripts/seed_demo.py       # données inventées
BUDGET_AUTH=off BUDGET_DB=data/demo.db PYTHONPATH=. streamlit run app/Accueil.py
PYTHONPATH=. pytest                                      # tests
```

Sous Windows PowerShell : `$env:BUDGET_AUTH="off"; $env:BUDGET_DB="data/demo.db"; $env:PYTHONPATH="."`. `BUDGET_AUTH=off` désactive la connexion : uniquement pour la démo locale, jamais sur le serveur.

## Déployer sur le serveur

```bash
git clone <ton-depot> budget && cd budget
cp .env.example .env
mkdir data && sudo chown 10001:10001 data     # l'app tourne sous l'utilisateur 10001, pas root
docker compose up -d --build
docker compose ps                              # doit afficher "healthy" après quelques secondes
```

Crée ensuite un compte par personne (mot de passe de 10 caractères minimum, saisi sans écho) :

```bash
docker compose exec budget python -m app.auth add lucas
docker compose exec budget python -m app.auth add alexis
```

Chaque utilisateur a sa propre base (`data/users/<nom>.db`) : il ne voit jamais les données de l'autre. Pour changer un mot de passe, relance `add` avec le même nom.

Par défaut le port n'est exposé que sur `127.0.0.1` du serveur. Pour y accéder depuis ton téléphone ou ton PC, passe par Tailscale :

```bash
sudo tailscale serve --bg 8501                 # vérifie la syntaxe avec : tailscale serve --help
```

La connexion par mot de passe protège les données entre utilisateurs, et Tailscale limite qui peut atteindre l'app. Ne mets jamais `BIND_ADDR=0.0.0.0` sans pare-feu.

**Donner l'accès à une autre personne.** Le plus propre est de partager uniquement cette machine avec le compte Tailscale de la personne (fonction « Share » de la console d'administration), plutôt que de l'inviter dans ton réseau. Point d'attention : par défaut, une machine partagée peut être jointe sur tous ses ports, donc aussi sur les autres services du serveur (SSH, Nextcloud...). Restreins l'accès avec les règles d'accès (ACL) de Tailscale à l'adresse de l'app seulement, et vérifie la procédure exacte dans la documentation Tailscale (« node sharing » et « ACLs »). Teste depuis le compte de l'autre personne qu'elle n'atteint que l'app.

**Ce que ce partage ne protège pas.** L'administrateur du serveur (toi) peut lire les fichiers de la base de l'autre personne. Dis-le-lui clairement avant qu'elle y mette ses données bancaires.

Durcissement déjà en place dans `docker-compose.yml` : utilisateur non root, système de fichiers en lecture seule, toutes les capabilities retirées, `no-new-privileges`, un seul volume (`./data`), réseau Docker dédié.

## Utilisation

1. Connecte-toi, puis page « Import et comptes » : crée un compte courant, importe l'export CSV de ta banque, puis cale le solde avec celui de ton appli bancaire.
2. Crée un compte d'épargne (Livret A) et saisis un relevé par mois.
3. Page « Prêt étudiant » : capital, taux, différé, nombre de mensualités. Compare avec le tableau d'amortissement de ton contrat.
4. Page « Règles » : ajoute des motifs (ex. `UBER EATS` vers Loisirs). Page « Abonnements » : lance l'analyse et valide ou rejette les candidats.

## Sauvegarde

Chaque utilisateur a un seul fichier. Copie propre, même app en marche :

```bash
sqlite3 data/users/lucas.db ".backup 'sauvegarde-lucas.db'"
```

Sauvegarde aussi `data/users.json` (les comptes). À copier ensuite vers un autre support (disque externe, autre machine), idéalement chiffré, en gardant chaque base séparée. Les sauvegardes automatiques sont l'étape suivante de ton plan.

## Limites connues

- Le format exact de l'export CSV BNP n'a pas pu être testé ici. Le parseur est tolérant (séparateur, encodage, colonnes signées ou débit/crédit), mais si ton export est refusé, ajuste `SYNONYMES` dans `app/importers/csv_banque.py` et envoie-moi les en-têtes (sans les montants ni libellés).
- Le calcul du prêt est un modèle simple (taux mensuel proportionnel, pas d'assurance, pas de jours exacts) : indicatif seulement.
- L'image Docker n'a pas pu être construite dans l'environnement où le code a été écrit. Le serveur Streamlit a été lancé avec la même configuration (PYTHONPATH, HOME), mais le premier `docker compose up` est à vérifier.
- Pas de récupération de mot de passe : en cas d'oubli, l'administrateur relance `app.auth add <nom>`. Le blocage après échecs est en mémoire (il repart à zéro au redémarrage du conteneur).
- Pas d'import OFX ni d'agrégateur bancaire pour l'instant : à ajouter dans `app/importers/` au besoin.
