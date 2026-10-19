'use strict';

/* =========================================================
   Écran Budgets : une limite de dépense par mois et par catégorie.
   ========================================================= */

const SEUIL_ATTENTION = 0.8; // à partir de 80 % du budget, la barre passe en orange

/** 'ok' (vert), 'attention' (orange) ou 'depasse' (rouge) */
function etatBudget(depense, budget) {
  if (depense > budget) return 'depasse';
  if (depense >= budget * SEUIL_ATTENTION) return 'attention';
  return 'ok';
}

/** Budgets du mois affiché, avec ce qui a été dépensé, les plus « consommés » d'abord. */
function suiviBudgets(annee, mois) {
  const depenses = totauxDepensesParCategorie(Store.transactionsDuMois(annee, mois));
  return Store.donnees.budgets
    .map((b) => {
      const depense = depenses.get(b.categorieId) || 0;
      return { categorie: Store.categorie(b.categorieId), budget: b.montant, depense, etat: etatBudget(depense, b.montant) };
    })
    .sort((a, b) => b.depense / b.budget - a.depense / a.budget);
}

/** Ligne avec barre de progression, utilisée sur l'écran Budgets et sur l'Accueil. */
function ligneBudget({ categorie, budget, depense, etat }) {
  const pourcentage = Math.round((depense / budget) * 100);
  const reste = budget - depense;
  const texteReste = reste >= 0
    ? `Reste ${formaterMontant(reste)}`
    : `Dépassé de ${formaterMontant(-reste)}`;

  return `
    <li>
      <button type="button" class="ligne-budget" data-budget="${echapper(categorie.id)}">
        <div class="repartition__haut">
          <span>${echapper(categorie.icone)} ${echapper(categorie.nom)}</span>
          <span class="repartition__montant">${formaterMontant(depense)} / ${formaterMontant(budget)}</span>
        </div>
        <div class="piste"><div class="remplissage remplissage--${etat}" style="width: ${Math.min(pourcentage, 100)}%"></div></div>
        <div class="ligne-budget__bas">
          <span class="texte-${etat}">${texteReste}</span>
          <span>${pourcentage} %</span>
        </div>
      </button>
    </li>`;
}

function rendreBudgets() {
  const suivis = suiviBudgets(etat.annee, etat.mois);
  const depenses = totauxDepensesParCategorie(Store.transactionsDuMois(etat.annee, etat.mois));
  const sansBudget = Store.categoriesDuType('depense').filter((c) => Store.budget(c.id) === null);

  let htmlResume = '';
  if (suivis.length > 0) {
    const totalBudget = suivis.reduce((s, b) => s + b.budget, 0);
    const totalDepense = suivis.reduce((s, b) => s + b.depense, 0);
    const pourcentage = Math.round((totalDepense / totalBudget) * 100);
    const etatTotal = etatBudget(totalDepense, totalBudget);
    const reste = totalBudget - totalDepense;

    htmlResume = `
      <section class="carte">
        <span class="carte__label">Total des budgets</span>
        <strong class="carte__valeur">${formaterMontant(totalDepense)} <span class="texte-doux">/ ${formaterMontant(totalBudget)}</span></strong>
        <div class="piste piste--grande"><div class="remplissage remplissage--${etatTotal}" style="width: ${Math.min(pourcentage, 100)}%"></div></div>
        <span class="carte__sous texte-${etatTotal}">
          ${reste >= 0 ? `Il te reste ${formaterMontant(reste)} à dépenser` : `Dépassé de ${formaterMontant(-reste)}`}
        </span>
      </section>`;
  }

  const htmlBudgets = suivis.length === 0
    ? `<p class="vide">Aucun budget pour l'instant.<br>Clique sur « Ajouter un budget » ou sur « Définir » à côté d'une catégorie.</p>`
    : `<ul class="liste">${suivis.map(ligneBudget).join('')}</ul>`;

  const htmlSansBudget = sansBudget.map((c) => {
    const depense = depenses.get(c.id) || 0;
    return `
      <li class="ligne-simple">
        <span>${echapper(c.icone)} ${echapper(c.nom)}</span>
        <span class="texte-doux">${depense > 0 ? `${formaterMontant(depense)} dépensés` : ''}</span>
        <button type="button" class="btn btn--petit" data-budget="${echapper(c.id)}">Définir</button>
      </li>`;
  }).join('');

  el.vue.innerHTML = `
    <div class="ajout ajout--seul">
      <button type="button" class="ajout__btn ajout__btn--principal" data-action="nouveau-budget">
        <span class="ajout__signe" aria-hidden="true">+</span>Ajouter un budget
      </button>
    </div>
    ${htmlResume}
    <section class="bloc">
      <h2>Mes budgets</h2>
      ${htmlBudgets}
    </section>
    ${sansBudget.length > 0 ? `
      <section class="bloc">
        <h2>Sans budget</h2>
        <ul class="liste">${htmlSansBudget}</ul>
      </section>` : ''}`;
}

/* ---------- Modale « définir un budget » ---------- */

const elBudget = {
  modale: document.getElementById('modale-budget'),
  form: document.getElementById('form-budget'),
  titre: document.getElementById('budget-titre'),
  choixCategorie: document.getElementById('budget-choix-categorie'),
  nouvelleCategorie: document.getElementById('budget-nouvelle-categorie'),
  icones: document.getElementById('budget-icones'),
  aide: document.getElementById('budget-aide'),
  erreur: document.getElementById('budget-erreur'),
  btnSupprimer: document.getElementById('budget-supprimer'),
};

const NOUVELLE_CATEGORIE = '__nouvelle';
const ICONES_CATEGORIE = ['⛽', '🍔', '☕', '🎁', '👕', '💇', '🏋️', '🎮', '📚', '🐶', '🍷', '✈️', '🧾', '🔧', '👶'];

function texteAideBudget(categorieId) {
  const moyenne = categorieId ? moyenneTroisDerniersMois(categorieId) : 0;
  return moyenne > 0
    ? `Pour t'aider : tu as dépensé en moyenne ${formaterMontant(moyenne)} par mois sur les 3 derniers mois.`
    : '';
}

/** Montre les champs « nouvelle catégorie » quand on choisit « ➕ Nouvelle catégorie… ». */
function adapterChoixCategorie() {
  const choix = elBudget.form.elements.namedItem('categorieId').value;
  const nouvelle = choix === NOUVELLE_CATEGORIE;
  elBudget.nouvelleCategorie.hidden = !nouvelle;
  elBudget.aide.textContent = nouvelle ? '' : texteAideBudget(choix);
}

/**
 * Ajouter un budget : sur une catégorie qui n'en a pas encore,
 * ou sur une nouvelle catégorie créée au passage (ex. « Essence »).
 */
function ouvrirModaleNouveauBudget() {
  etat.budgetEnEdition = null;
  const champs = elBudget.form.elements;
  elBudget.form.reset();

  const libres = Store.categoriesDuType('depense').filter((c) => Store.budget(c.id) === null);
  champs.namedItem('categorieId').innerHTML = libres
    .map((c) => `<option value="${echapper(c.id)}">${echapper(c.icone)} ${echapper(c.nom)}</option>`)
    .join('') + `<option value="${NOUVELLE_CATEGORIE}">➕ Nouvelle catégorie…</option>`;
  champs.namedItem('icone').value = ICONES_CATEGORIE[0];

  elBudget.titre.textContent = 'Nouveau budget';
  elBudget.choixCategorie.hidden = false;
  elBudget.erreur.textContent = '';
  elBudget.btnSupprimer.hidden = true;
  adapterChoixCategorie();

  elBudget.modale.showModal();
  champs.namedItem('categorieId').focus();
}

/** Moyenne des dépenses d'une catégorie sur les 3 mois avant le mois affiché. */
function moyenneTroisDerniersMois(categorieId) {
  let total = 0;
  for (let i = 1; i <= 3; i++) {
    const { annee, mois } = decalerMois(etat.annee, etat.mois, -i);
    total += totauxDepensesParCategorie(Store.transactionsDuMois(annee, mois)).get(categorieId) || 0;
  }
  return Math.round(total / 3);
}

function ouvrirModaleBudget(categorieId) {
  const categorie = Store.categorie(categorieId);
  const budget = Store.budget(categorieId);

  etat.budgetEnEdition = categorieId;
  elBudget.form.reset();
  elBudget.titre.textContent = `Budget · ${categorie.icone} ${categorie.nom}`;
  elBudget.choixCategorie.hidden = true;
  elBudget.nouvelleCategorie.hidden = true;
  elBudget.form.elements.namedItem('montant').value = budget ? centimesVersSaisie(budget) : '';
  elBudget.aide.textContent = texteAideBudget(categorieId);
  elBudget.erreur.textContent = '';
  elBudget.btnSupprimer.hidden = budget === null;

  elBudget.modale.showModal();
  elBudget.form.elements.namedItem('montant').focus();
}

function brancherBudgets() {
  elBudget.icones.insertAdjacentHTML('beforeend', ICONES_CATEGORIE.map((icone) => `
    <label><input type="radio" name="icone" value="${icone}"><span>${icone}</span></label>`).join(''));

  elBudget.form.addEventListener('change', (e) => {
    if (e.target.name === 'categorieId') adapterChoixCategorie();
  });

  elBudget.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const champs = elBudget.form.elements;
    const montant = lireMontant(champs.namedItem('montant').value);
    let categorieId = etat.budgetEnEdition || champs.namedItem('categorieId').value;
    const creation = categorieId === NOUVELLE_CATEGORIE;

    if (creation) {
      const nom = champs.namedItem('nomCategorie').value.trim();
      if (!nom) {
        elBudget.erreur.textContent = 'Donne un nom à la nouvelle catégorie (ex. Essence).';
        return;
      }
      const existe = Store.categoriesDuType('depense').some((c) => normaliser(c.nom) === normaliser(nom));
      if (existe) {
        elBudget.erreur.textContent = 'Une catégorie porte déjà ce nom : choisis-la dans la liste.';
        return;
      }
      if (montant === null) {
        elBudget.erreur.textContent = 'Indique un montant valide, par exemple 150.';
        return;
      }
      categorieId = Store.ajouterCategorie({ nom, icone: champs.namedItem('icone').value || ICONES_CATEGORIE[0], type: 'depense' });
    }

    if (montant === null) {
      elBudget.erreur.textContent = 'Indique un montant valide, par exemple 150.';
      return;
    }
    const ok = Boolean(categorieId) && Store.definirBudget(categorieId, montant);
    elBudget.modale.close();
    afficher();
    if (!ok) afficherToast("⚠️ Impossible d'enregistrer.");
    else afficherToast(creation ? 'Catégorie et budget créés ✔' : 'Budget enregistré ✔');
  });

  elBudget.btnSupprimer.addEventListener('click', () => {
    if (!confirm('Supprimer ce budget ? Tes transactions ne sont pas touchées.')) return;
    Store.supprimerBudget(etat.budgetEnEdition);
    elBudget.modale.close();
    afficher();
    afficherToast('Budget supprimé');
  });
}
