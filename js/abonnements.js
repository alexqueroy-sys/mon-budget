'use strict';

/* =========================================================
   Écran Abonnements : les dépenses qui reviennent chaque mois.
   Le jour du prélèvement, la dépense est ajoutée toute seule
   dans les transactions (voir Store.genererPrelevements).
   ========================================================= */

/** "Le 5 de chaque mois · prochain : 5 nov." */
function descriptionAbonnement(abonnement) {
  if (!abonnement.actif) return '⏸️ En pause';
  const prochain = prochainPrelevement(abonnement);
  const jour = abonnement.jour === 1 ? '1er' : abonnement.jour;
  return `Le ${jour} de chaque mois${prochain ? ` · prochain : ${formaterDateCourte(prochain)}` : ''}`;
}

function ligneAbonnement(abonnement) {
  const categorie = Store.categorie(abonnement.categorieId);
  return `
    <li>
      <button type="button" class="ligne ${abonnement.actif ? '' : 'ligne--pause'}" data-abonnement="${echapper(abonnement.id)}">
        <span class="pastille" style="--c: ${categorie.couleur}" aria-hidden="true">${echapper(categorie.icone)}</span>
        <span class="ligne__textes">
          <span class="ligne__titre">${echapper(abonnement.nom)}</span>
          <span class="ligne__sous">${descriptionAbonnement(abonnement)}</span>
        </span>
        <span class="ligne__montant">${formaterMontant(abonnement.montant)}<span class="ligne__unite">/mois</span></span>
      </button>
    </li>`;
}

/** Abonnements actifs, du prochain prélèvement au plus lointain. */
function abonnementsActifsTries() {
  return Store.donnees.abonnements
    .filter((a) => a.actif)
    .map((a) => ({ abonnement: a, prochain: prochainPrelevement(a) || '9999' }))
    .sort((x, y) => x.prochain.localeCompare(y.prochain))
    .map((x) => x.abonnement);
}

function rendreAbonnements() {
  const actifs = abonnementsActifsTries();
  const enPause = Store.donnees.abonnements.filter((a) => !a.actif);
  const totalMois = actifs.reduce((s, a) => s + a.montant, 0);

  el.vue.innerHTML = `
    <div class="ajout ajout--seul">
      <button type="button" class="ajout__btn ajout__btn--principal" data-action="nouvel-abonnement">
        <span class="ajout__signe" aria-hidden="true">+</span>Ajouter un abonnement
      </button>
    </div>

    ${actifs.length > 0 ? `
      <section class="cartes">
        <div class="carte">
          <span class="carte__label">Par mois</span>
          <strong class="carte__valeur negatif">${formaterMontant(totalMois)}</strong>
        </div>
        <div class="carte">
          <span class="carte__label">Par an</span>
          <strong class="carte__valeur negatif">${formaterMontant(totalMois * 12)}</strong>
        </div>
      </section>` : ''}

    <section class="bloc">
      <h2>Mes abonnements</h2>
      ${actifs.length === 0
        ? `<p class="vide">Aucun abonnement pour l'instant.<br>Ajoute ton forfait, Spotify, ta salle de sport, ton loyer…</p>`
        : `<ul class="liste">${actifs.map(ligneAbonnement).join('')}</ul>`}
    </section>

    ${enPause.length > 0 ? `
      <section class="bloc">
        <h2>En pause</h2>
        <ul class="liste">${enPause.map(ligneAbonnement).join('')}</ul>
      </section>` : ''}`;
}

/* ---------- Modale « abonnement » (création / modification) ---------- */

const elAbonnement = {
  modale: document.getElementById('modale-abonnement'),
  form: document.getElementById('form-abonnement'),
  titre: document.getElementById('abonnement-titre'),
  choixMoisActuel: document.getElementById('abonnement-mois-actuel'),
  choixPause: document.getElementById('abonnement-pause'),
  erreur: document.getElementById('abonnement-erreur'),
  btnSupprimer: document.getElementById('abonnement-supprimer'),
};

function ouvrirModaleAbonnement(abonnement = null) {
  etat.abonnementEnEdition = abonnement;
  const champs = elAbonnement.form.elements;
  elAbonnement.form.reset();

  champs.namedItem('categorieId').innerHTML = optionsCategories('depense', abonnement ? abonnement.categorieId : 'cat-abonnements');
  champs.namedItem('nom').value = abonnement ? abonnement.nom : '';
  champs.namedItem('montant').value = abonnement ? centimesVersSaisie(abonnement.montant) : '';
  champs.namedItem('jour').value = abonnement ? abonnement.jour : new Date().getDate();
  champs.namedItem('moisActuel').checked = true;
  champs.namedItem('pause').checked = abonnement ? !abonnement.actif : false;

  // « Compter ce mois-ci » n'a de sens qu'à la création, « En pause » qu'en modification.
  elAbonnement.choixMoisActuel.hidden = Boolean(abonnement);
  elAbonnement.choixPause.hidden = !abonnement;
  elAbonnement.titre.textContent = abonnement ? "Modifier l'abonnement" : 'Nouvel abonnement';
  elAbonnement.btnSupprimer.hidden = !abonnement;
  elAbonnement.erreur.textContent = '';

  elAbonnement.modale.showModal();
  if (!abonnement) champs.namedItem('nom').focus();
}

function brancherAbonnements() {
  elAbonnement.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const champs = elAbonnement.form.elements;
    const nom = champs.namedItem('nom').value.trim();
    const montant = lireMontant(champs.namedItem('montant').value);
    const jour = Number(champs.namedItem('jour').value);

    if (!nom) {
      elAbonnement.erreur.textContent = 'Donne un nom à ton abonnement (ex. Spotify).';
      return;
    }
    if (montant === null) {
      elAbonnement.erreur.textContent = 'Indique un montant valide, par exemple 10,99.';
      return;
    }
    if (!Number.isInteger(jour) || jour < 1 || jour > 31) {
      elAbonnement.erreur.textContent = 'Le jour du prélèvement doit être entre 1 et 31.';
      return;
    }

    const valeurs = { nom, montant, jour, categorieId: champs.namedItem('categorieId').value };
    const enEdition = etat.abonnementEnEdition;
    let ok;

    if (enEdition) {
      ok = Store.modifierAbonnement(enEdition.id, { ...valeurs, actif: !champs.namedItem('pause').checked });
    } else {
      // Sans « ce mois-ci », le premier prélèvement compté sera celui du mois prochain.
      const maintenant = new Date();
      const { annee, mois } = decalerMois(
        maintenant.getFullYear(), maintenant.getMonth() + 1, champs.namedItem('moisActuel').checked ? 0 : 1,
      );
      ok = Store.ajouterAbonnement({ ...valeurs, depuis: `${annee}-${String(mois).padStart(2, '0')}-01` });
    }

    const crees = Store.genererPrelevements();
    elAbonnement.modale.close();
    afficher();

    if (!ok) afficherToast("⚠️ Impossible d'enregistrer.");
    else if (crees > 0) afficherToast(`Abonnement enregistré ✔ (${crees} dépense${crees > 1 ? 's' : ''} ajoutée${crees > 1 ? 's' : ''})`, 3500);
    else afficherToast(enEdition ? 'Abonnement modifié ✔' : 'Abonnement ajouté ✔');
  });

  elAbonnement.btnSupprimer.addEventListener('click', () => {
    const abonnement = etat.abonnementEnEdition;
    if (!abonnement) return;
    const message = `Supprimer l'abonnement « ${abonnement.nom} » ?\n`
      + 'Les dépenses déjà enregistrées restent dans tes transactions.';
    if (!confirm(message)) return;
    Store.supprimerAbonnement(abonnement.id);
    elAbonnement.modale.close();
    afficher();
    afficherToast('Abonnement supprimé');
  });
}
