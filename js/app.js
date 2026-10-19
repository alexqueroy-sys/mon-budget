'use strict';

/* =========================================================
   Mon Budget — l'interface.
   Chaque écran (« vue ») a sa fonction rendreXxx() qui reconstruit
   son HTML à partir des données du Store.
   ========================================================= */

const aujourdhui = new Date();

const etat = {
  vue: 'accueil',
  annee: aujourdhui.getFullYear(),
  mois: aujourdhui.getMonth() + 1, // de 1 à 12
  filtres: { type: 'tous', categorieId: 'toutes', recherche: '' },
  transactionEnEdition: null,
  budgetEnEdition: null,   // id de la catégorie
  objectifEnEdition: null,
  versement: null,         // { objectifId, sens: 1 | -1 }
  abonnementEnEdition: null,
};

// « intro » : la phrase affichée sous le titre pour expliquer à quoi sert l'écran.
const VUES = {
  accueil: {
    titre: 'Accueil', avecMois: true, rendre: rendreAccueil,
    intro: "Le résumé de ton mois : ce qui est entré, ce qui est sorti, et où en sont tes budgets et ton épargne.",
  },
  transactions: {
    titre: 'Transactions', avecMois: true, rendre: rendreTransactions,
    intro: 'Note ici chaque dépense et chaque revenu avec les boutons ci-dessous. Clique sur une ligne pour la modifier ou la supprimer.',
  },
  budgets: {
    titre: 'Budgets', avecMois: true, rendre: rendreBudgets,
    intro: "Fixe une limite de dépense par mois pour chaque catégorie, et vois d'un coup d'œil si tu la respectes.",
  },
  epargne: {
    titre: 'Épargne', avecMois: false, rendre: rendreObjectifs,
    intro: "Crée des objectifs (vacances, permis, fonds d'urgence…) et mets de l'argent de côté petit à petit.",
  },
  abonnements: {
    titre: 'Abonnements', avecMois: false, rendre: rendreAbonnements,
    intro: 'Enregistre ce que tu paies chaque mois : la dépense est ajoutée toute seule le jour du prélèvement.',
  },
  parametres: {
    titre: 'Paramètres', avecMois: false, rendre: rendreParametres,
    intro: "Sauvegarde tes données dans un fichier pour ne jamais les perdre, ou récupère une ancienne sauvegarde.",
  },
};

const JOURS_AVANT_RAPPEL_SAUVEGARDE = 30;

const el = {
  vue: document.getElementById('vue'),
  titre: document.getElementById('titre-vue'),
  intro: document.getElementById('intro-vue'),
  selecteurMois: document.getElementById('selecteur-mois'),
  moisLibelle: document.getElementById('mois-libelle'),
  moisPrecedent: document.getElementById('mois-precedent'),
  moisSuivant: document.getElementById('mois-suivant'),
  liensNav: document.querySelectorAll('.nav__lien'),
  modale: document.getElementById('modale-transaction'),
  form: document.getElementById('form-transaction'),
  modaleTitre: document.getElementById('modale-titre'),
  formErreur: document.getElementById('form-erreur'),
  btnSupprimer: document.getElementById('btn-supprimer'),
  toast: document.getElementById('toast'),
};

/* =========================================================
   Démarrage et navigation
   ========================================================= */

function demarrer() {
  const resultat = Store.charger();

  if (!Store.stockageDisponible) {
    afficherToast("Attention : ce navigateur n'enregistre pas les données (navigation privée ?).", 6000);
  } else if (resultat.donneesIllisibles) {
    afficherToast('Les données enregistrées étaient abîmées. Importe ta dernière sauvegarde.', 6000);
  } else {
    annoncerPrelevements(Store.genererPrelevements());
  }

  brancherEvenements();
  allerDepuisAdresse();
}

function annoncerPrelevements(crees) {
  if (crees > 0) {
    afficherToast(`🔁 ${crees} prélèvement${crees > 1 ? 's' : ''} d'abonnement ajouté${crees > 1 ? 's' : ''} à tes transactions`, 4000);
  }
}

/** L'écran affiché dépend de l'adresse (#accueil, #transactions…) : le bouton « retour » fonctionne. */
function allerDepuisAdresse() {
  const nom = location.hash.slice(1);
  etat.vue = VUES[nom] ? nom : 'accueil';
  afficher();
}

function afficher() {
  const vue = VUES[etat.vue];

  el.titre.textContent = vue.titre;
  el.intro.textContent = vue.intro;
  document.title = `${vue.titre} · Mon Budget`;
  el.selecteurMois.hidden = !vue.avecMois;
  el.moisLibelle.textContent = libelleMois(etat.annee, etat.mois);

  el.liensNav.forEach((lien) => {
    if (lien.dataset.vue === etat.vue) lien.setAttribute('aria-current', 'page');
    else lien.removeAttribute('aria-current');
  });

  vue.rendre();
}

/** (2026, 1, -1) -> { annee: 2025, mois: 12 } */
function decalerMois(annee, mois, decalage) {
  const date = new Date(annee, mois - 1 + decalage, 1);
  return { annee: date.getFullYear(), mois: date.getMonth() + 1 };
}

function changerMois(decalage) {
  const { annee, mois } = decalerMois(etat.annee, etat.mois, decalage);
  etat.annee = annee;
  etat.mois = mois;
  afficher();
}

function brancherEvenements() {
  window.addEventListener('hashchange', allerDepuisAdresse);
  el.moisPrecedent.addEventListener('click', () => changerMois(-1));
  el.moisSuivant.addEventListener('click', () => changerMois(1));

  // Un seul écouteur pour tous les clics dans les écrans (on regarde sur quoi on a cliqué).
  el.vue.addEventListener('click', (e) => {
    const ajout = e.target.closest('[data-ajouter]');
    if (ajout) {
      ouvrirModale(null, ajout.dataset.ajouter);
      return;
    }
    const ligne = e.target.closest('[data-transaction]');
    if (ligne) {
      const transaction = Store.transaction(ligne.dataset.transaction);
      if (transaction) ouvrirModale(transaction);
      return;
    }
    const budget = e.target.closest('[data-budget]');
    if (budget) {
      ouvrirModaleBudget(budget.dataset.budget);
      return;
    }
    const abonnement = e.target.closest('[data-abonnement]');
    if (abonnement) {
      const trouve = Store.abonnement(abonnement.dataset.abonnement);
      if (trouve) ouvrirModaleAbonnement(trouve);
      return;
    }
    const action = e.target.closest('[data-action]');
    if (!action) return;
    if (action.dataset.action === 'nouvel-abonnement') ouvrirModaleAbonnement();
    else actionObjectif(action.dataset.action, action);
  });

  el.form.addEventListener('change', (e) => {
    if (e.target.name === 'type') remplirCategories(e.target.value);
  });
  el.form.addEventListener('submit', enregistrerFormulaire);
  el.btnSupprimer.addEventListener('click', supprimerTransactionEnCours);

  document.querySelectorAll('dialog.modale').forEach((modale) => {
    // Clic sur le fond assombri : on ferme.
    modale.addEventListener('click', (e) => {
      if (e.target === modale) modale.close();
    });
    // Boutons « Annuler »
    modale.querySelectorAll('[data-fermer]').forEach((bouton) => {
      bouton.addEventListener('click', () => modale.close());
    });
  });

  brancherBudgets();
  brancherObjectifs();
  brancherAbonnements();
}

/* =========================================================
   Calculs
   ========================================================= */

function calculerTotaux(transactions) {
  let revenus = 0;
  let depenses = 0;
  for (const t of transactions) {
    if (t.type === 'revenu') revenus += t.montant;
    else depenses += t.montant;
  }
  return { revenus, depenses, solde: revenus - depenses };
}

/** Map : id de catégorie -> total dépensé (en centimes). */
function totauxDepensesParCategorie(transactions) {
  const totaux = new Map();
  for (const t of transactions) {
    if (t.type !== 'depense') continue;
    totaux.set(t.categorieId, (totaux.get(t.categorieId) || 0) + t.montant);
  }
  return totaux;
}

/** Total des dépenses par catégorie, de la plus grosse à la plus petite. */
function depensesParCategorie(transactions) {
  return [...totauxDepensesParCategorie(transactions).entries()]
    .map(([categorieId, montant]) => ({ categorie: Store.categorie(categorieId), montant }))
    .sort((a, b) => b.montant - a.montant);
}

function rappelSauvegardeNecessaire() {
  const { transactions, derniereSauvegarde } = Store.donnees;
  if (transactions.length === 0) return false;
  if (!derniereSauvegarde) return true;
  const jours = (Date.now() - new Date(derniereSauvegarde).getTime()) / 86400000;
  return jours > JOURS_AVANT_RAPPEL_SAUVEGARDE;
}

/* =========================================================
   Morceaux de HTML réutilisés
   ========================================================= */

function ligneTransaction(t, { avecDate = false } = {}) {
  const categorie = Store.categorie(t.categorieId);
  const estRevenu = t.type === 'revenu';
  const sousTitre = [
    t.abonnementId ? '🔁' : '', // dépense créée automatiquement par un abonnement
    t.note,
    avecDate ? formaterDateCourte(t.date) : '',
  ].filter(Boolean).join(' · ').replace('🔁 · ', '🔁 ');

  return `
    <li>
      <button type="button" class="ligne" data-transaction="${echapper(t.id)}">
        <span class="pastille" style="--c: ${categorie.couleur}" aria-hidden="true">${echapper(categorie.icone)}</span>
        <span class="ligne__textes">
          <span class="ligne__titre">${echapper(categorie.nom)}</span>
          ${sousTitre ? `<span class="ligne__sous">${echapper(sousTitre)}</span>` : ''}
        </span>
        <span class="ligne__montant ${estRevenu ? 'positif' : ''}">
          ${estRevenu ? '+' : '−'}${formaterMontant(t.montant)}
        </span>
      </button>
    </li>`;
}

function optionsCategories(type, selection) {
  return Store.categoriesDuType(type)
    .map((c) => `<option value="${echapper(c.id)}" ${c.id === selection ? 'selected' : ''}>${echapper(c.icone)} ${echapper(c.nom)}</option>`)
    .join('');
}

/* =========================================================
   Écran : Accueil
   ========================================================= */

function rendreAccueil() {
  const transactions = Store.transactionsDuMois(etat.annee, etat.mois);
  const { revenus, depenses, solde } = calculerTotaux(transactions);
  const repartition = depensesParCategorie(transactions);
  const dernieres = transactions.slice(0, 5);

  const htmlRepartition = repartition.length === 0
    ? '<p class="vide">Aucune dépense ce mois-ci.</p>'
    : `<ul class="repartition">${repartition.map(({ categorie, montant }) => {
        const pourcentage = Math.round((montant / depenses) * 100);
        return `
          <li>
            <div class="repartition__haut">
              <span>${echapper(categorie.icone)} ${echapper(categorie.nom)}</span>
              <span class="repartition__montant">${formaterMontant(montant)} · ${pourcentage} %</span>
            </div>
            <div class="piste"><div class="remplissage" style="width: ${pourcentage}%; background: ${categorie.couleur}"></div></div>
          </li>`;
      }).join('')}</ul>`;

  const htmlDernieres = dernieres.length === 0
    ? '<p class="vide">Rien pour l\'instant.<br><a href="#transactions">Ajoute ta première transaction</a></p>'
    : `<ul class="liste">${dernieres.map((t) => ligneTransaction(t, { avecDate: true })).join('')}</ul>`;

  // Les 3 budgets les plus entamés
  const budgets = suiviBudgets(etat.annee, etat.mois);
  const htmlBudgets = budgets.length === 0
    ? '<p class="vide">Fixe une limite de dépense par catégorie dans <a href="#budgets">Budgets</a>.</p>'
    : `<ul class="liste">${budgets.slice(0, 3).map(ligneBudget).join('')}</ul>`;

  // Objectifs d'épargne : une ligne par objectif, avec une mini barre
  const objectifs = Store.donnees.objectifs;
  const htmlEpargne = objectifs.length === 0
    ? '<p class="vide">Crée un objectif (vacances, permis…) dans <a href="#epargne">Épargne</a>.</p>'
    : `<ul class="repartition">${objectifs.map((o) => {
        const total = Store.totalObjectif(o);
        const pourcentage = Math.round((total / o.cible) * 100);
        return `
          <li>
            <div class="repartition__haut">
              <span>${echapper(o.icone)} ${echapper(o.nom)}</span>
              <span class="repartition__montant">${formaterMontant(total)} / ${formaterMontant(o.cible)}</span>
            </div>
            <div class="piste"><div class="remplissage remplissage--ok" style="width: ${Math.min(pourcentage, 100)}%"></div></div>
          </li>`;
      }).join('')}</ul>`;

  // Les 3 prochains prélèvements d'abonnement
  const abonnements = abonnementsActifsTries();
  const totalAbonnements = abonnements.reduce((s, a) => s + a.montant, 0);
  const htmlAbonnements = abonnements.length === 0
    ? '<p class="vide">Note tes paiements mensuels (forfait, Spotify…) dans <a href="#abonnements">Abonnements</a>.</p>'
    : `<p class="resume">${formaterMontant(totalAbonnements)} par mois · prochains prélèvements :</p>
       <ul class="liste">${abonnements.slice(0, 3).map(ligneAbonnement).join('')}</ul>`;

  el.vue.innerHTML = `
    <section class="cartes">
      <div class="carte carte--solde">
        <span class="carte__label">Solde du mois</span>
        <strong class="carte__valeur ${solde < 0 ? 'negatif' : ''}">${formaterMontant(solde)}</strong>
      </div>
      <div class="carte">
        <span class="carte__label">Revenus</span>
        <strong class="carte__valeur positif">+${formaterMontant(revenus)}</strong>
      </div>
      <div class="carte">
        <span class="carte__label">Dépenses</span>
        <strong class="carte__valeur negatif">−${formaterMontant(depenses)}</strong>
      </div>
    </section>

    ${rappelSauvegardeNecessaire() ? `
      <div class="banniere">
        <span>💾 Pense à sauvegarder tes données de temps en temps.</span>
        <a href="#parametres">Sauvegarder</a>
      </div>` : ''}

    <section class="bloc">
      <div class="bloc__entete">
        <h2>Budgets</h2>
        ${budgets.length > 0 ? '<a href="#budgets">Tout voir</a>' : ''}
      </div>
      ${htmlBudgets}
    </section>

    <section class="bloc">
      <h2>Dépenses par catégorie</h2>
      ${htmlRepartition}
    </section>

    <section class="bloc">
      <div class="bloc__entete">
        <h2>Dernières transactions</h2>
        ${transactions.length > 0 ? '<a href="#transactions">Tout voir</a>' : ''}
      </div>
      ${htmlDernieres}
    </section>

    <section class="bloc">
      <div class="bloc__entete">
        <h2>Épargne</h2>
        ${objectifs.length > 0 ? '<a href="#epargne">Tout voir</a>' : ''}
      </div>
      ${htmlEpargne}
    </section>

    <section class="bloc">
      <div class="bloc__entete">
        <h2>Abonnements</h2>
        ${abonnements.length > 0 ? '<a href="#abonnements">Tout voir</a>' : ''}
      </div>
      ${htmlAbonnements}
    </section>`;
}

/* =========================================================
   Écran : Transactions
   ========================================================= */

function rendreTransactions() {
  const { filtres } = etat;
  const groupe = (type, libelle) => `<optgroup label="${libelle}">${optionsCategories(type, filtres.categorieId)}</optgroup>`;

  el.vue.innerHTML = `
    <div class="ajout">
      <button type="button" class="ajout__btn ajout__btn--depense" data-ajouter="depense">
        <span class="ajout__signe" aria-hidden="true">−</span>Ajouter une dépense
      </button>
      <button type="button" class="ajout__btn ajout__btn--revenu" data-ajouter="revenu">
        <span class="ajout__signe" aria-hidden="true">+</span>Ajouter un revenu
      </button>
    </div>
    <div class="filtres">
      <select id="filtre-type" aria-label="Filtrer par type">
        <option value="tous">Tout</option>
        <option value="depense">Dépenses</option>
        <option value="revenu">Revenus</option>
      </select>
      <select id="filtre-categorie" aria-label="Filtrer par catégorie">
        <option value="toutes">Toutes catégories</option>
        ${groupe('depense', 'Dépenses')}
        ${groupe('revenu', 'Revenus')}
      </select>
      <input id="filtre-recherche" type="search" placeholder="Rechercher…" aria-label="Rechercher" value="${echapper(filtres.recherche)}">
    </div>
    <div id="liste-transactions"></div>`;

  const filtreType = document.getElementById('filtre-type');
  const filtreCategorie = document.getElementById('filtre-categorie');
  const filtreRecherche = document.getElementById('filtre-recherche');

  filtreType.value = filtres.type;
  filtreType.addEventListener('change', () => { filtres.type = filtreType.value; rendreListeTransactions(); });
  filtreCategorie.addEventListener('change', () => { filtres.categorieId = filtreCategorie.value; rendreListeTransactions(); });
  // Seule la liste est redessinée pendant la frappe, pour ne pas perdre le curseur.
  filtreRecherche.addEventListener('input', () => { filtres.recherche = filtreRecherche.value; rendreListeTransactions(); });

  rendreListeTransactions();
}

function rendreListeTransactions() {
  const conteneur = document.getElementById('liste-transactions');
  const { type, categorieId, recherche } = etat.filtres;
  const texteRecherche = normaliser(recherche.trim());
  const duMois = Store.transactionsDuMois(etat.annee, etat.mois);

  const liste = duMois.filter((t) => {
    if (type !== 'tous' && t.type !== type) return false;
    if (categorieId !== 'toutes' && t.categorieId !== categorieId) return false;
    if (texteRecherche) {
      const texte = normaliser(`${t.note} ${Store.categorie(t.categorieId).nom}`);
      if (!texte.includes(texteRecherche)) return false;
    }
    return true;
  });

  if (liste.length === 0) {
    conteneur.innerHTML = `<section class="bloc"><p class="vide">${
      duMois.length === 0 ? 'Aucune transaction ce mois-ci.' : 'Aucune transaction ne correspond aux filtres.'
    }</p></section>`;
    return;
  }

  // Regroupement par jour (la liste est déjà triée du plus récent au plus ancien).
  const parJour = new Map();
  for (const t of liste) {
    if (!parJour.has(t.date)) parJour.set(t.date, []);
    parJour.get(t.date).push(t);
  }

  const { solde } = calculerTotaux(liste);
  const pluriel = liste.length > 1 ? 's' : '';

  conteneur.innerHTML = `
    <p class="resume">${liste.length} transaction${pluriel} · total ${formaterMontant(solde)}</p>
    ${[...parJour.entries()].map(([date, transactions]) => `
      <section class="bloc groupe">
        <h3 class="groupe__date">${formaterDateLongue(date)}</h3>
        <ul class="liste">${transactions.map((t) => ligneTransaction(t)).join('')}</ul>
      </section>`).join('')}`;
}

/* =========================================================
   Écran : Paramètres
   ========================================================= */

function rendreParametres() {
  const { transactions, categories, budgets, objectifs, abonnements, derniereSauvegarde } = Store.donnees;
  const compter = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
  const libelleSauvegarde = derniereSauvegarde
    ? new Date(derniereSauvegarde).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'jamais';
  const puces = (type) => categories
    .filter((c) => c.type === type)
    .map((c) => `<span class="puce">${echapper(c.icone)} ${echapper(c.nom)}</span>`)
    .join('');

  el.vue.innerHTML = `
    <section class="bloc">
      <h2>Sauvegarde</h2>
      <p class="texte-doux">
        Tes données sont enregistrées uniquement dans ce navigateur : rien n'est envoyé sur internet.
        Exporte-les régulièrement pour ne jamais les perdre, ou pour les transférer sur un autre appareil.
      </p>
      <p>Dernière sauvegarde : <strong>${libelleSauvegarde}</strong></p>
      <div class="boutons">
        <button type="button" class="btn btn--principal" id="btn-exporter">Exporter mes données</button>
        <button type="button" class="btn" id="btn-importer">Importer une sauvegarde</button>
        <input type="file" id="fichier-import" accept="application/json,.json" hidden>
      </div>
    </section>

    <section class="bloc">
      <h2>Mes données</h2>
      <p>
        Enregistrés dans ce navigateur : ${compter(transactions.length, 'transaction')},
        ${compter(budgets.length, 'budget')}, ${compter(objectifs.length, 'objectif')} d'épargne
        et ${compter(abonnements.length, 'abonnement')}.
      </p>
    </section>

    <section class="bloc">
      <h2>Catégories</h2>
      <p class="texte-doux">Dépenses</p>
      <div class="puces">${puces('depense')}</div>
      <p class="texte-doux">Revenus</p>
      <div class="puces">${puces('revenu')}</div>
      <p class="texte-doux">La personnalisation des catégories arrivera dans une prochaine version.</p>
    </section>`;

  const fichierImport = document.getElementById('fichier-import');
  document.getElementById('btn-exporter').addEventListener('click', exporterDonnees);
  document.getElementById('btn-importer').addEventListener('click', () => fichierImport.click());
  fichierImport.addEventListener('change', () => {
    if (fichierImport.files[0]) importerFichier(fichierImport.files[0]);
    fichierImport.value = '';
  });
}

function exporterDonnees() {
  const contenu = Store.exporter();
  const url = URL.createObjectURL(new Blob([contenu], { type: 'application/json' }));
  const lien = document.createElement('a');
  lien.href = url;
  lien.download = `mon-budget-sauvegarde-${dateDuJour()}.json`;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  afficherToast('Sauvegarde téléchargée ✔');
  afficher();
}

async function importerFichier(fichier) {
  try {
    const donnees = Store.lireSauvegarde(await fichier.text());
    const actuelles = Store.donnees.transactions.length;
    const message = `Cette sauvegarde contient ${donnees.transactions.length} transaction(s), `
      + `${donnees.budgets.length} budget(s) et ${donnees.objectifs.length} objectif(s).\n`
      + `Elle va remplacer toutes tes données actuelles (${actuelles} transaction(s)). Continuer ?`;
    if (!confirm(message)) return;

    if (!Store.remplacer(donnees)) {
      afficherToast("Impossible d'enregistrer les données importées.", 5000);
      return;
    }
    afficherToast('Sauvegarde importée ✔');
    // Les prélèvements passés depuis la sauvegarde sont ajoutés maintenant.
    annoncerPrelevements(Store.genererPrelevements());
    afficher();
  } catch (erreur) {
    afficherToast(erreur.message || 'Fichier invalide.', 5000);
  }
}

/* =========================================================
   Formulaire d'ajout / modification
   ========================================================= */

function champ(nom) {
  return el.form.elements.namedItem(nom);
}

function remplirCategories(type, selection) {
  champ('categorieId').innerHTML = optionsCategories(type, selection);
}

/** Date proposée : aujourd'hui si on regarde le mois en cours, sinon le 1er du mois affiché. */
function dateParDefaut() {
  const moisAffiche = `${etat.annee}-${String(etat.mois).padStart(2, '0')}`;
  const jour = dateDuJour();
  return jour.startsWith(moisAffiche) ? jour : `${moisAffiche}-01`;
}

/** Sans transaction : nouvelle transaction du type demandé ('depense' ou 'revenu'). */
function ouvrirModale(transaction = null, typeNouvelle = 'depense') {
  etat.transactionEnEdition = transaction;
  el.form.reset();

  const type = transaction ? transaction.type : typeNouvelle;
  champ('type').value = type;
  remplirCategories(type, transaction && transaction.categorieId);
  champ('montant').value = transaction ? centimesVersSaisie(transaction.montant) : '';
  champ('date').value = transaction ? transaction.date : dateParDefaut();
  champ('note').value = transaction ? transaction.note : '';

  el.modaleTitre.textContent = transaction ? 'Modifier la transaction' : 'Nouvelle transaction';
  el.btnSupprimer.hidden = !transaction;
  el.formErreur.textContent = '';

  el.modale.showModal();
  if (!transaction) champ('montant').focus();
}

function enregistrerFormulaire(e) {
  e.preventDefault();

  const montant = lireMontant(champ('montant').value);
  if (montant === null) {
    el.formErreur.textContent = 'Indique un montant valide, par exemple 12,50.';
    champ('montant').focus();
    return;
  }

  const date = champ('date').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    el.formErreur.textContent = 'Choisis une date.';
    return;
  }

  const valeurs = {
    type: champ('type').value,
    montant,
    categorieId: champ('categorieId').value,
    date,
    note: champ('note').value.trim(),
  };

  const enEdition = etat.transactionEnEdition;
  const ok = enEdition
    ? Store.modifierTransaction(enEdition.id, valeurs)
    : Store.ajouterTransaction(valeurs);

  el.modale.close();

  // On affiche le mois de la transaction, pour que l'utilisateur la voie tout de suite.
  const [annee, mois] = date.split('-').map(Number);
  etat.annee = annee;
  etat.mois = mois;
  afficher();

  if (!ok) afficherToast("⚠️ Impossible d'enregistrer : le stockage du navigateur est indisponible.", 5000);
  else afficherToast(enEdition ? 'Transaction modifiée ✔' : 'Transaction ajoutée ✔');
}

function supprimerTransactionEnCours() {
  const transaction = etat.transactionEnEdition;
  if (!transaction || !confirm('Supprimer cette transaction ?')) return;

  Store.supprimerTransaction(transaction.id);
  el.modale.close();
  afficher();
  afficherToast('Transaction supprimée');
}

/* =========================================================
   Petit message temporaire en bas de l'écran
   ========================================================= */

let minuteurToast = null;

function afficherToast(message, duree = 2500) {
  el.toast.textContent = message;
  el.toast.classList.add('toast--visible');
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => el.toast.classList.remove('toast--visible'), duree);
}

demarrer();
