'use strict';

/* =========================================================
   Écran Abonnements : ce qui revient chaque mois.
   - ce que tu paies (forfait, Spotify, loyer…) ;
   - ce que tu reçois (salaire, APL, bourse…).
   Le jour J, la transaction est ajoutée toute seule
   dans les transactions (voir Store.genererPrelevements).
   ========================================================= */

const abonnementEstRevenu = (abonnement) => abonnement.type === 'revenu';

/** "Le 5 de chaque mois · prochain : 5 nov." */
function descriptionAbonnement(abonnement) {
  if (!abonnement.actif) return '⏸️ En pause';
  const prochain = prochainPrelevement(abonnement);
  const jour = abonnement.jour === 1 ? '1er' : abonnement.jour;
  const compte = plusieursComptes() ? ` · ${nomCompte(abonnement.compteId)}` : '';
  return `Le ${jour} de chaque mois${prochain ? ` · prochain : ${formaterDateCourte(prochain)}` : ''}${compte}`;
}

function ligneAbonnement(abonnement) {
  const categorie = Store.categorie(abonnement.categorieId);
  const revenu = abonnementEstRevenu(abonnement);
  return `
    <li>
      <button type="button" class="ligne ${abonnement.actif ? '' : 'ligne--pause'}" data-abonnement="${echapper(abonnement.id)}">
        <span class="pastille" style="--c: ${categorie.couleur}" aria-hidden="true">${echapper(categorie.icone)}</span>
        <span class="ligne__textes">
          <span class="ligne__titre">${echapper(abonnement.nom)}</span>
          <span class="ligne__sous">${descriptionAbonnement(abonnement)}</span>
        </span>
        <span class="ligne__montant ${revenu ? 'positif' : ''}">${revenu ? '+' : '−'}${formaterMontant(abonnement.montant)}<span class="ligne__unite">/mois</span></span>
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
  const aPayer = actifs.filter((a) => !abonnementEstRevenu(a));
  const aRecevoir = actifs.filter(abonnementEstRevenu);
  const enPause = Store.donnees.abonnements.filter((a) => !a.actif);
  const total = (liste) => liste.reduce((s, a) => s + a.montant, 0);

  el.vue.innerHTML = `
    <div class="ajout ajout--seul">
      <button type="button" class="ajout__btn ajout__btn--principal" data-action="nouvel-abonnement">
        <span class="ajout__signe" aria-hidden="true">+</span>Ajouter un abonnement ou un revenu régulier
      </button>
    </div>

    ${actifs.length > 0 ? `
      <section class="cartes">
        <div class="carte">
          <span class="carte__label">Je paie chaque mois</span>
          <strong class="carte__valeur negatif">${formaterMontant(total(aPayer))}</strong>
          <span class="carte__sous texte-doux">soit ${formaterMontant(total(aPayer) * 12)} par an</span>
        </div>
        <div class="carte">
          <span class="carte__label">Je reçois chaque mois</span>
          <strong class="carte__valeur positif">${formaterMontant(total(aRecevoir))}</strong>
          <span class="carte__sous texte-doux">soit ${formaterMontant(total(aRecevoir) * 12)} par an</span>
        </div>
      </section>` : ''}

    <section class="bloc">
      <h2>Je reçois</h2>
      ${aRecevoir.length === 0
        ? '<p class="vide">Ajoute ton salaire, tes APL ou ta bourse : tu verras sur l\'Accueil quand l\'argent arrive.</p>'
        : `<ul class="liste">${aRecevoir.map(ligneAbonnement).join('')}</ul>`}
    </section>

    <section class="bloc">
      <h2>Je paie</h2>
      ${aPayer.length === 0
        ? `<p class="vide">Aucun abonnement pour l'instant.<br>Ajoute ton forfait, Spotify, ta salle de sport, ton loyer…</p>`
        : `<ul class="liste">${aPayer.map(ligneAbonnement).join('')}</ul>`}
    </section>

    ${enPause.length > 0 ? `
      <section class="bloc">
        <h2>En pause</h2>
        <ul class="liste">${enPause.map(ligneAbonnement).join('')}</ul>
      </section>` : ''}`;
}

/* ---------- Bloc « À venir » de l'Accueil ---------- */

const JOURS_A_VENIR = 30;

/** "demain", "dans 4 jours" */
function delaiAvant(date) {
  const jours = Math.round((texteVersDate(date) - texteVersDate(dateDuJour())) / 86400000);
  return jours === 1 ? 'demain' : `dans ${jours} jours`;
}

/** Ce qui va arriver (ou partir) sur tes comptes dans les 30 prochains jours. */
function blocAVenir() {
  const limite = new Date();
  limite.setDate(limite.getDate() + JOURS_A_VENIR);
  const echeances = prochainesEcheances(dateVersTexte(limite));

  const entrees = echeances.filter((e) => abonnementEstRevenu(e.abonnement)).reduce((s, e) => s + e.abonnement.montant, 0);
  const sorties = echeances.filter((e) => !abonnementEstRevenu(e.abonnement)).reduce((s, e) => s + e.abonnement.montant, 0);

  const lignes = echeances.map(({ date, abonnement }) => {
    const revenu = abonnementEstRevenu(abonnement);
    const categorie = Store.categorie(abonnement.categorieId);
    const compte = plusieursComptes() ? ` · ${nomCompte(abonnement.compteId)}` : '';
    const d = texteVersDate(date);
    return `
      <li>
        <button type="button" class="ligne" data-abonnement="${echapper(abonnement.id)}">
          <span class="date-bloc" aria-hidden="true">
            <strong>${d.getDate()}</strong>
            <span>${echapper(d.toLocaleDateString('fr-FR', { month: 'short' }))}</span>
          </span>
          <span class="ligne__textes">
            <span class="ligne__titre">${echapper(categorie.icone)} ${echapper(abonnement.nom)}</span>
            <span class="ligne__sous">${formaterDateLongue(date)} · ${delaiAvant(date)}${echapper(compte)}</span>
          </span>
          <span class="ligne__montant ${revenu ? 'positif' : ''}">${revenu ? '+' : '−'}${formaterMontant(abonnement.montant)}</span>
        </button>
      </li>`;
  }).join('');

  return `
    <section class="bloc">
      <div class="bloc__entete">
        <h2>À venir · 30 prochains jours</h2>
        <a href="#abonnements">Gérer</a>
      </div>
      ${echeances.length === 0
        ? `<p class="vide">Rien de programmé.<br>Ajoute ton salaire, tes APL ou tes abonnements dans
           <a href="#abonnements">Abonnements</a> pour voir ici quand l'argent arrive et part.</p>`
        : `<p class="resume">
             ${entrees > 0 ? `<strong class="positif">+${formaterMontant(entrees)}</strong> à recevoir` : ''}
             ${entrees > 0 && sorties > 0 ? ' · ' : ''}
             ${sorties > 0 ? `<strong class="negatif">−${formaterMontant(sorties)}</strong> à payer` : ''}
           </p>
           <ul class="liste">${lignes}</ul>`}
    </section>`;
}

/* ---------- Modale « abonnement » (création / modification) ---------- */

const elAbonnement = {
  modale: document.getElementById('modale-abonnement'),
  form: document.getElementById('form-abonnement'),
  titre: document.getElementById('abonnement-titre'),
  libelleCompte: document.getElementById('abonnement-libelle-compte'),
  libelleMois: document.getElementById('abonnement-libelle-mois'),
  choixMoisActuel: document.getElementById('abonnement-mois-actuel'),
  choixPause: document.getElementById('abonnement-pause'),
  erreur: document.getElementById('abonnement-erreur'),
  btnSupprimer: document.getElementById('abonnement-supprimer'),
};

/** Les catégories et les libellés changent selon « je paie » / « je reçois ». */
function adapterAbonnementAuType(type, categorieId) {
  const revenu = type === 'revenu';
  const champs = elAbonnement.form.elements;
  const parDefaut = revenu ? 'cat-salaire' : 'cat-abonnements';
  champs.namedItem('categorieId').innerHTML = optionsCategories(type, categorieId || parDefaut);
  elAbonnement.libelleCompte.textContent = revenu ? 'Versé sur le compte' : 'Prélevé sur le compte';
  elAbonnement.libelleMois.textContent = revenu
    ? 'Compter aussi le versement de ce mois-ci'
    : 'Compter aussi le prélèvement de ce mois-ci';
  champs.namedItem('nom').placeholder = revenu ? 'ex. Salaire, APL, bourse' : 'ex. Spotify, forfait, loyer';
}

function ouvrirModaleAbonnement(abonnement = null) {
  etat.abonnementEnEdition = abonnement;
  const champs = elAbonnement.form.elements;
  elAbonnement.form.reset();

  const type = abonnement ? abonnement.type : 'depense';
  champs.namedItem('type').value = type;
  adapterAbonnementAuType(type, abonnement && abonnement.categorieId);
  champs.namedItem('compteId').innerHTML = optionsComptes(abonnement ? abonnement.compteId : comptePrincipalId());
  champs.namedItem('nom').value = abonnement ? abonnement.nom : '';
  champs.namedItem('montant').value = abonnement ? centimesVersSaisie(abonnement.montant) : '';
  champs.namedItem('jour').value = abonnement ? abonnement.jour : new Date().getDate();
  champs.namedItem('moisActuel').checked = true;
  champs.namedItem('pause').checked = abonnement ? !abonnement.actif : false;

  // « Compter ce mois-ci » n'a de sens qu'à la création, « En pause » qu'en modification.
  elAbonnement.choixMoisActuel.hidden = Boolean(abonnement);
  elAbonnement.choixPause.hidden = !abonnement;
  elAbonnement.titre.textContent = abonnement ? 'Modifier' : 'Nouvel abonnement ou revenu régulier';
  elAbonnement.btnSupprimer.hidden = !abonnement;
  elAbonnement.erreur.textContent = '';

  elAbonnement.modale.showModal();
  if (!abonnement) champs.namedItem('nom').focus();
}

function brancherAbonnements() {
  elAbonnement.form.addEventListener('change', (e) => {
    if (e.target.name === 'type') adapterAbonnementAuType(e.target.value);
  });

  elAbonnement.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const champs = elAbonnement.form.elements;
    const type = champs.namedItem('type').value;
    const nom = champs.namedItem('nom').value.trim();
    const montant = lireMontant(champs.namedItem('montant').value);
    const jour = Number(champs.namedItem('jour').value);

    if (!nom) {
      elAbonnement.erreur.textContent = type === 'revenu' ? 'Donne un nom (ex. Salaire).' : 'Donne un nom (ex. Spotify).';
      return;
    }
    if (montant === null) {
      elAbonnement.erreur.textContent = 'Indique un montant valide, par exemple 10,99.';
      return;
    }
    if (!Number.isInteger(jour) || jour < 1 || jour > 31) {
      elAbonnement.erreur.textContent = 'Le jour doit être entre 1 et 31.';
      return;
    }

    const valeurs = {
      type, nom, montant, jour,
      categorieId: champs.namedItem('categorieId').value,
      compteId: champs.namedItem('compteId').value,
    };
    const enEdition = etat.abonnementEnEdition;
    let ok;

    if (enEdition) {
      ok = Store.modifierAbonnement(enEdition.id, { ...valeurs, actif: !champs.namedItem('pause').checked });
    } else {
      // Sans « ce mois-ci », le premier mouvement compté sera celui du mois prochain.
      const maintenant = new Date();
      const { annee, mois } = decalerMois(
        maintenant.getFullYear(), maintenant.getMonth() + 1, champs.namedItem('moisActuel').checked ? 0 : 1,
      );
      ok = Store.ajouterAbonnement({ ...valeurs, depuis: `${annee}-${String(mois).padStart(2, '0')}-01` });
    }

    const crees = Store.genererPrelevements();
    elAbonnement.modale.close();
    afficher();

    const pluriel = crees > 1 ? 's' : '';
    if (!ok) afficherToast("⚠️ Impossible d'enregistrer.");
    else if (crees > 0) afficherToast(`Enregistré ✔ (${crees} transaction${pluriel} ajoutée${pluriel})`, 3500);
    else afficherToast(enEdition ? 'Modifié ✔' : 'Ajouté ✔');
  });

  elAbonnement.btnSupprimer.addEventListener('click', () => {
    const abonnement = etat.abonnementEnEdition;
    if (!abonnement) return;
    const message = `Supprimer « ${abonnement.nom} » ?\n`
      + 'Les transactions déjà enregistrées restent dans tes transactions.';
    if (!confirm(message)) return;
    Store.supprimerAbonnement(abonnement.id);
    elAbonnement.modale.close();
    afficher();
    afficherToast('Supprimé');
  });
}
