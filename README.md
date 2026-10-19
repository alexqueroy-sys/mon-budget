# 💶 Mon Budget

Gestionnaire de budget personnel, simple et sans inscription.
Il fonctionne dans le navigateur, sur ordinateur comme sur téléphone.

**Les données restent sur ton appareil** : elles sont enregistrées dans le navigateur
(`localStorage`) et rien n'est envoyé sur internet. Un export en fichier JSON permet
de les sauvegarder ou de les transférer sur un autre appareil.

## Fonctionnalités

- **Accueil** : résumé du mois (solde, revenus, dépenses), budgets, épargne
- **Transactions** : ajout, modification et suppression des dépenses et revenus, filtres et recherche
- **Budgets** : une limite de dépense par mois et par catégorie, avec alerte à 80 % et en cas de dépassement
- **Épargne** : objectifs avec montant cible, date limite et calcul de l'effort mensuel
- **Abonnements** : paiements mensuels, ajoutés automatiquement aux transactions le jour du prélèvement (avec pause possible)
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
| `js/budgets.js` | Écran Budgets |
| `js/objectifs.js` | Écran Épargne |
| `js/abonnements.js` | Écran Abonnements |
| `js/app.js` | Navigation, Accueil, Transactions, Paramètres |
