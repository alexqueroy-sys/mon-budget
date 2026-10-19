# 💶 Mon Budget

Gestionnaire de budget personnel, simple et sans inscription.
Il fonctionne dans le navigateur, sur ordinateur comme sur téléphone.

**Les données restent sur ton appareil** : elles sont enregistrées dans le navigateur
(`localStorage`) et rien n'est envoyé sur internet. Un export en fichier JSON permet
de les sauvegarder ou de les transférer sur un autre appareil.

## Fonctionnalités

- **Accueil** : solde réel de chaque compte bancaire (courant, livret…), résumé du mois, budgets, épargne
- **Comptes** : plusieurs comptes avec leur solde, et virements entre eux (qui ne comptent ni comme dépense ni comme revenu)
- **Transactions** : ajout, modification et suppression des dépenses et revenus, filtres et recherche
- **Budgets** : une limite de dépense par mois et par catégorie, avec alerte à 80 % et en cas de dépassement
- **Épargne** : objectifs avec montant cible, date limite et calcul de l'effort mensuel
- **Abonnements** : paiements mensuels, ajoutés automatiquement aux transactions le jour du prélèvement (avec pause possible)
- **Statistiques** : revenus et dépenses mois par mois (3, 6 ou 12 mois), moyennes, mois le plus dépensier, dépenses par catégorie, avec une version tableau de chaque graphique
- **Paramètres** : export et import des données

## Lancer l'application

Aucune installation : ouvre `index.html` dans un navigateur.

## Technique

- HTML, CSS et JavaScript, sans framework ni étape de compilation
- Montants stockés en centimes (entiers) pour éviter les erreurs d'arrondi
- Données versionnées, avec migration automatique quand l'application évolue
- Validation de tout fichier importé avant de l'utiliser

| Fichier | Rôle |
| --- | --- |
| `index.html` | Structure de la page et formulaires |
| `css/style.css` | Apparence (mobile d'abord, mode sombre automatique) |
| `js/format.js` | Mise en forme des montants et des dates |
| `js/store.js` | Stockage, validation et migration des données |
| `js/comptes.js` | Comptes bancaires (bloc de l'Accueil) |
| `js/budgets.js` | Écran Budgets |
| `js/objectifs.js` | Écran Épargne |
| `js/abonnements.js` | Écran Abonnements |
| `js/statistiques.js` | Écran Statistiques et graphiques (SVG fait main, sans bibliothèque) |
| `js/app.js` | Navigation, Accueil, Transactions, Paramètres |
