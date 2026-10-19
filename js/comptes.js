'use strict';

/* =========================================================
   Comptes bancaires : compte courant, livret, compte joint…
   Ils se gèrent depuis l'Accueil (bloc « Mes comptes »).
   Tant qu'il n'y a qu'un seul compte, l'app ne pose pas de question
   sur le compte : tout va dessus automatiquement.
   ========================================================= */

const ICONES_COMPTE = ['🏦', '💳', '🐖', '👥', '💰', '📈', '🪙', '🏧'];

function plusieursComptes() {
  return Store.comptesActifs().length > 1;
}

function comptePrincipalId() {
  return Store.comptesActifs()[0].id;
}

/**
 * Options d'un <select> de comptes. Un compte archivé n'apparaît que s'il est
 * déjà sélectionné (pour modifier une ancienne transaction sans la changer de compte).
 */
function optionsComptes(selection, { sauf = null } = {}) {
  return Store.donnees.comptes
    .filter((c) => c.id !== sauf && (!c.archive || c.id === selection))
    .map((c) => `<option value="${echapper(c.id)}" ${c.id === selection ? 'selected' : ''}>${echapper(c.icone)} ${echapper(c.nom)}</option>`)
    .join('');
}

function carteCompte(compte) {
  const solde = Store.soldeCompte(compte.id);
  return `
    <li class="compte">
      <button type="button" class="compte__corps" data-voir-compte="${echapper(compte.id)}" title="Voir les transactions de ce compte">
        <span class="pastille" style="--c: var(--principal)" aria-hidden="true">${echapper(compte.icone)}</span>
        <span class="ligne__textes">
          <span class="ligne__titre">${echapper(compte.nom)}</span>
          <strong class="compte__solde ${solde < 0 ? 'negatif' : ''}">${formaterMontant(solde)}</strong>
        </span>
      </button>
      <button type="button" class="btn-icone" data-action="modifier-compte" data-id="${echapper(compte.id)}" aria-label="Modifier le compte ${echapper(compte.nom)}">✏️</button>
    </li>`;
}

/** Bloc « Mes comptes » affiché en haut de l'Accueil. */
function blocComptes() {
  const actifs = Store.comptesActifs();
  const archives = Store.donnees.comptes.filter((c) => c.archive);
  const total = actifs.reduce((s, c) => s + Store.soldeCompte(c.id), 0);

  return `
    <section class="bloc bloc--comptes">
      <div class="bloc__entete">
        <h2>Mes comptes</h2>
        <button type="button" class="btn btn--petit" data-action="nouveau-compte">+ Ajouter un compte</button>
      </div>
      <ul class="comptes">${actifs.map(carteCompte).join('')}</ul>
      ${actifs.length > 1 ? `
        <p class="comptes__total">Total sur tes comptes : <strong class="${total < 0 ? 'negatif' : ''}">${formaterMontant(total)}</strong></p>` : ''}
      ${archives.length > 0 ? `
        <details class="historique">
          <summary>Comptes archivés (${archives.length})</summary>
          <ul class="comptes">${archives.map(carteCompte).join('')}</ul>
        </details>` : ''}
    </section>`;
}

/** Clic sur un compte : on ouvre ses transactions du mois. */
function voirCompte(compteId) {
  etat.filtres.compteId = compteId;
  location.hash = '#transactions';
}

/* ---------- Modale « compte » (création / modification) ---------- */

const elCompte = {
  modale: document.getElementById('modale-compte'),
  form: document.getElementById('form-compte'),
  titre: document.getElementById('compte-titre'),
  icones: document.getElementById('compte-icones'),
  choixArchive: document.getElementById('compte-archive'),
  erreur: document.getElementById('compte-erreur'),
  btnSupprimer: document.getElementById('compte-supprimer'),
};

function ouvrirModaleCompte(compte = null) {
  etat.compteEnEdition = compte;
  const champs = elCompte.form.elements;
  elCompte.form.reset();

  champs.namedItem('nom').value = compte ? compte.nom : '';
  champs.namedItem('icone').value = compte ? compte.icone : ICONES_COMPTE[0];
  champs.namedItem('solde').value = compte ? centimesVersSaisie(Store.soldeCompte(compte.id)) : '';
  champs.namedItem('archive').checked = compte ? compte.archive : false;

  elCompte.titre.textContent = compte ? 'Modifier le compte' : 'Nouveau compte';
  elCompte.choixArchive.hidden = !compte;
  elCompte.btnSupprimer.hidden = !compte;
  elCompte.erreur.textContent = '';

  elCompte.modale.showModal();
  if (!compte) champs.namedItem('nom').focus();
}

function actionCompte(action, bouton) {
  if (action === 'nouveau-compte') ouvrirModaleCompte();
  if (action === 'modifier-compte') {
    const compte = Store.compte(bouton.dataset.id);
    if (compte) ouvrirModaleCompte(compte);
  }
}

function brancherComptes() {
  elCompte.icones.insertAdjacentHTML('beforeend', ICONES_COMPTE.map((icone) => `
    <label><input type="radio" name="icone" value="${icone}"><span>${icone}</span></label>`).join(''));

  elCompte.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const champs = elCompte.form.elements;
    const nom = champs.namedItem('nom').value.trim();
    const soldeActuel = lireMontantSigne(champs.namedItem('solde').value || '0');
    const archive = champs.namedItem('archive').checked;
    const enEdition = etat.compteEnEdition;

    if (!nom) {
      elCompte.erreur.textContent = 'Donne un nom à ton compte (ex. Livret A).';
      return;
    }
    if (soldeActuel === null) {
      elCompte.erreur.textContent = 'Indique un solde valide, par exemple 1250,40 ou -35 si tu es à découvert.';
      return;
    }
    const dernierActif = enEdition && !enEdition.archive && Store.comptesActifs().length === 1;
    if (archive && dernierActif) {
      elCompte.erreur.textContent = 'Il faut garder au moins un compte actif.';
      return;
    }

    const valeurs = { nom, icone: champs.namedItem('icone').value || ICONES_COMPTE[0], soldeActuel, archive };
    const ok = enEdition ? Store.modifierCompte(enEdition.id, valeurs) : Store.ajouterCompte(valeurs);

    elCompte.modale.close();
    afficher();
    if (!ok) afficherToast("⚠️ Impossible d'enregistrer.");
    else afficherToast(enEdition ? 'Compte modifié ✔' : 'Compte ajouté ✔');
  });

  elCompte.btnSupprimer.addEventListener('click', () => {
    const compte = etat.compteEnEdition;
    if (!compte) return;
    if (Store.compteUtilise(compte.id)) {
      elCompte.erreur.textContent = 'Ce compte a des transactions ou des abonnements : tu ne peux pas le supprimer, '
        + 'mais tu peux l\'archiver pour le masquer.';
      return;
    }
    if (!compte.archive && Store.comptesActifs().length === 1) {
      elCompte.erreur.textContent = 'Il faut garder au moins un compte actif.';
      return;
    }
    if (!confirm(`Supprimer le compte « ${compte.nom} » ?`)) return;
    Store.supprimerCompte(compte.id);
    elCompte.modale.close();
    afficher();
    afficherToast('Compte supprimé');
  });
}
