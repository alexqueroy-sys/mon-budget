'use strict';

/* =========================================================
   Écran Épargne : des objectifs (vacances, voiture, fonds d'urgence…)
   que l'on remplit petit à petit avec des versements.
   L'épargne est suivie à part : elle ne change pas le solde du mois.
   ========================================================= */

const ICONES_OBJECTIF = ['🎯', '🛟', '🏖️', '✈️', '🚗', '🏠', '💻', '📱', '🎓', '🎁'];

/** Nombre de mois entre aujourd'hui et une date (au moins 1), ou 0 si la date est passée. */
function moisRestants(dateLimite) {
  const fin = texteVersDate(dateLimite);
  const maintenant = new Date();
  if (fin < texteVersDate(dateDuJour())) return 0;
  const mois = (fin.getFullYear() - maintenant.getFullYear()) * 12 + (fin.getMonth() - maintenant.getMonth());
  return Math.max(mois, 1);
}

function libelleMoisCourt(dateTexte) {
  return texteVersDate(dateTexte).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

/** Phrase d'aide sous la barre : combien il reste, et à quel rythme épargner. */
function conseilObjectif(objectif, total) {
  const reste = objectif.cible - total;
  if (reste <= 0) return '🎉 Objectif atteint, bravo !';
  if (!objectif.dateLimite) return `Reste ${formaterMontant(reste)}`;

  const mois = moisRestants(objectif.dateLimite);
  if (mois === 0) return `Reste ${formaterMontant(reste)} · la date limite est passée`;
  const parMois = Math.ceil(reste / mois);
  return `Reste ${formaterMontant(reste)} · environ <strong>${formaterMontant(parMois)} par mois</strong> jusqu'en ${libelleMoisCourt(objectif.dateLimite)}`;
}

function carteObjectif(objectif) {
  const total = Store.totalObjectif(objectif);
  const pourcentage = Math.round((total / objectif.cible) * 100);
  const atteint = total >= objectif.cible;
  const id = echapper(objectif.id);
  const versements = [...objectif.versements].sort((a, b) => b.date.localeCompare(a.date));

  const htmlHistorique = versements.map((v) => `
    <li>
      <span>${formaterDateCourte(v.date)}</span>
      <span class="${v.montant > 0 ? 'positif' : 'negatif'}">${v.montant > 0 ? '+' : '−'}${formaterMontant(Math.abs(v.montant))}</span>
      <button type="button" class="btn-icone" data-action="supprimer-versement" data-id="${id}" data-versement="${echapper(v.id)}" aria-label="Supprimer ce mouvement">✕</button>
    </li>`).join('');

  return `
    <article class="bloc objectif">
      <div class="objectif__haut">
        <span class="pastille" style="--c: var(--principal)" aria-hidden="true">${echapper(objectif.icone)}</span>
        <span class="ligne__textes">
          <span class="ligne__titre">${echapper(objectif.nom)}</span>
          ${objectif.dateLimite ? `<span class="ligne__sous">Avant le ${formaterDateAvecAnnee(objectif.dateLimite)}</span>` : ''}
        </span>
        <button type="button" class="btn-icone" data-action="modifier-objectif" data-id="${id}" aria-label="Modifier l'objectif">✏️</button>
      </div>

      <div class="objectif__montants">
        <strong>${formaterMontant(total)}</strong>
        <span class="texte-doux">/ ${formaterMontant(objectif.cible)}</span>
        <span class="objectif__pct">${pourcentage} %</span>
      </div>
      <div class="piste piste--grande"><div class="remplissage remplissage--ok" style="width: ${Math.min(pourcentage, 100)}%"></div></div>
      <p class="objectif__conseil">${conseilObjectif(objectif, total)}</p>

      <div class="boutons">
        <button type="button" class="btn ${atteint ? '' : 'btn--principal'}" data-action="ajouter-versement" data-id="${id}">+ Ajouter</button>
        <button type="button" class="btn" data-action="retirer-versement" data-id="${id}" ${total <= 0 ? 'disabled' : ''}>− Retirer</button>
      </div>

      ${versements.length > 0 ? `
        <details class="historique">
          <summary>Historique (${versements.length})</summary>
          <ul>${htmlHistorique}</ul>
        </details>` : ''}
    </article>`;
}

function rendreObjectifs() {
  const objectifs = Store.donnees.objectifs;
  const totalEpargne = objectifs.reduce((s, o) => s + Store.totalObjectif(o), 0);

  el.vue.innerHTML = `
    <div class="barre-actions">
      ${objectifs.length > 0 ? `<p class="resume">Total épargné : <strong>${formaterMontant(totalEpargne)}</strong></p>` : '<span></span>'}
      <button type="button" class="btn btn--principal" data-action="nouvel-objectif">+ Nouvel objectif</button>
    </div>
    ${objectifs.length === 0 ? `
      <section class="bloc">
        <p class="vide">
          Pas encore d'objectif.<br>
          Crée-en un (vacances, permis, fonds d'urgence…) et ajoute de l'argent dedans au fil des mois.
        </p>
      </section>` : objectifs.map(carteObjectif).join('')}`;
}

/* ---------- Modale « objectif » (création / modification) ---------- */

const elObjectif = {
  modale: document.getElementById('modale-objectif'),
  form: document.getElementById('form-objectif'),
  titre: document.getElementById('objectif-titre'),
  icones: document.getElementById('objectif-icones'),
  erreur: document.getElementById('objectif-erreur'),
  btnSupprimer: document.getElementById('objectif-supprimer'),
};

const elVersement = {
  modale: document.getElementById('modale-versement'),
  form: document.getElementById('form-versement'),
  titre: document.getElementById('versement-titre'),
  aide: document.getElementById('versement-aide'),
  erreur: document.getElementById('versement-erreur'),
};

function ouvrirModaleObjectif(objectif = null) {
  etat.objectifEnEdition = objectif;
  const champs = elObjectif.form.elements;
  elObjectif.form.reset();

  champs.namedItem('nom').value = objectif ? objectif.nom : '';
  champs.namedItem('icone').value = objectif ? objectif.icone : ICONES_OBJECTIF[0];
  champs.namedItem('cible').value = objectif ? centimesVersSaisie(objectif.cible) : '';
  champs.namedItem('dateLimite').value = objectif && objectif.dateLimite ? objectif.dateLimite : '';

  elObjectif.titre.textContent = objectif ? "Modifier l'objectif" : 'Nouvel objectif';
  elObjectif.btnSupprimer.hidden = !objectif;
  elObjectif.erreur.textContent = '';

  elObjectif.modale.showModal();
  if (!objectif) champs.namedItem('nom').focus();
}

/** sens : 1 pour ajouter de l'argent, -1 pour en retirer. */
function ouvrirModaleVersement(objectif, sens) {
  etat.versement = { objectifId: objectif.id, sens };
  const champs = elVersement.form.elements;
  elVersement.form.reset();

  champs.namedItem('date').value = dateDuJour();
  elVersement.titre.textContent = `${sens > 0 ? 'Ajouter à' : 'Retirer de'} ${objectif.icone} ${objectif.nom}`;
  elVersement.aide.textContent = sens < 0
    ? `Disponible : ${formaterMontant(Store.totalObjectif(objectif))}`
    : '';
  elVersement.erreur.textContent = '';

  elVersement.modale.showModal();
  champs.namedItem('montant').focus();
}

/** Clics sur les boutons de l'écran Épargne (data-action="…"). */
function actionObjectif(action, bouton) {
  const objectif = Store.objectif(bouton.dataset.id);

  switch (action) {
    case 'nouvel-objectif':
      ouvrirModaleObjectif();
      break;
    case 'modifier-objectif':
      if (objectif) ouvrirModaleObjectif(objectif);
      break;
    case 'ajouter-versement':
      if (objectif) ouvrirModaleVersement(objectif, 1);
      break;
    case 'retirer-versement':
      if (objectif) ouvrirModaleVersement(objectif, -1);
      break;
    case 'supprimer-versement':
      if (objectif && confirm('Supprimer ce mouvement de l\'historique ?')) {
        Store.supprimerVersement(objectif.id, bouton.dataset.versement);
        afficher();
        afficherToast('Mouvement supprimé');
      }
      break;
  }
}

function brancherObjectifs() {
  // Les icônes proposées sont générées ici pour n'avoir la liste qu'à un seul endroit.
  elObjectif.icones.insertAdjacentHTML('beforeend', ICONES_OBJECTIF.map((icone) => `
    <label><input type="radio" name="icone" value="${icone}"><span>${icone}</span></label>`).join(''));

  elObjectif.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const champs = elObjectif.form.elements;
    const nom = champs.namedItem('nom').value.trim();
    const cible = lireMontant(champs.namedItem('cible').value);
    const dateLimite = champs.namedItem('dateLimite').value || null;

    if (!nom) {
      elObjectif.erreur.textContent = "Donne un nom à ton objectif.";
      return;
    }
    if (cible === null) {
      elObjectif.erreur.textContent = 'Indique un montant à atteindre valide, par exemple 1000.';
      return;
    }

    const valeurs = { nom, icone: champs.namedItem('icone').value || ICONES_OBJECTIF[0], cible, dateLimite };
    const enEdition = etat.objectifEnEdition;
    const ok = enEdition ? Store.modifierObjectif(enEdition.id, valeurs) : Store.ajouterObjectif(valeurs);

    elObjectif.modale.close();
    afficher();
    if (!ok) afficherToast("⚠️ Impossible d'enregistrer.");
    else afficherToast(enEdition ? 'Objectif modifié ✔' : 'Objectif créé ✔');
  });

  elObjectif.btnSupprimer.addEventListener('click', () => {
    const objectif = etat.objectifEnEdition;
    if (!objectif || !confirm(`Supprimer l'objectif « ${objectif.nom} » et tout son historique ?`)) return;
    Store.supprimerObjectif(objectif.id);
    elObjectif.modale.close();
    afficher();
    afficherToast('Objectif supprimé');
  });

  elVersement.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const { objectifId, sens } = etat.versement;
    const objectif = Store.objectif(objectifId);
    const champs = elVersement.form.elements;
    const montant = lireMontant(champs.namedItem('montant').value);
    const date = champs.namedItem('date').value;

    if (montant === null) {
      elVersement.erreur.textContent = 'Indique un montant valide, par exemple 50.';
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      elVersement.erreur.textContent = 'Choisis une date.';
      return;
    }
    if (sens < 0 && montant > Store.totalObjectif(objectif)) {
      elVersement.erreur.textContent = "Tu ne peux pas retirer plus que ce qui a été mis de côté.";
      return;
    }

    const avant = Store.totalObjectif(objectif);
    const ok = Store.ajouterVersement(objectifId, sens * montant, date);
    elVersement.modale.close();
    afficher();

    const vientDAtteindre = avant < objectif.cible && Store.totalObjectif(objectif) >= objectif.cible;
    if (!ok) afficherToast("⚠️ Impossible d'enregistrer.");
    else if (vientDAtteindre) afficherToast(`🎉 Objectif « ${objectif.nom} » atteint !`, 4000);
    else afficherToast(sens > 0 ? 'Argent ajouté ✔' : 'Argent retiré ✔');
  });
}
