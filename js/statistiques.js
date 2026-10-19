'use strict';

/* =========================================================
   Écran Trésorerie (onglet #statistiques) :
   - un graphique : entrées et sorties par mois (colonnes)
     + solde de trésorerie en fin de mois (ligne), sur UN seul axe en € ;
   - une prévision pour les 3 mois suivants (moyenne des 3 derniers mois) ;
   - un tableau détaillé mois par mois, catégorie par catégorie.
   Sur « Tous les comptes », les virements entre tes comptes sont ignorés
   (l'argent ne sort pas de chez toi). Sur un seul compte, ils apparaissent.
   ========================================================= */

const PERIODES_STATS = [3, 6, 12];
const NB_MOIS_PREVISION = 3;
const HAUTEUR_GRAPHIQUE = 260;
const CLE_VIREMENT = '__virement';

/* ---------- Calculs ---------- */

function texteMoisCle(annee, mois) {
  return `${annee}-${String(mois).padStart(2, '0')}`;
}

/** Dernier jour d'un mois, au format AAAA-MM-JJ. */
function finDeMois(annee, mois) {
  return `${texteMoisCle(annee, mois)}-${String(new Date(annee, mois, 0).getDate()).padStart(2, '0')}`;
}

/** Ce qu'une transaction ajoute (+) ou retire (−) à la trésorerie suivie. */
function effetSurTresorerie(t, compteId) {
  if (compteId === 'tous') {
    if (t.type === 'revenu') return t.montant;
    if (t.type === 'depense') return -t.montant;
    return 0; // virement entre deux de tes comptes : le total ne bouge pas
  }
  let effet = 0;
  if (t.compteId === compteId) effet += t.type === 'revenu' ? t.montant : -t.montant; // dépense ou virement envoyé
  if (t.type === 'virement' && t.compteDestId === compteId) effet += t.montant;
  return effet;
}

/** Trésorerie à la fin d'une journée donnée (tous les comptes, ou un seul). */
function tresorerieAu(date, compteId) {
  const comptes = compteId === 'tous' ? Store.donnees.comptes : Store.donnees.comptes.filter((c) => c.id === compteId);
  let total = comptes.reduce((s, c) => s + c.soldeInitial, 0);
  for (const t of Store.donnees.transactions) {
    if (t.date <= date) total += effetSurTresorerie(t, compteId);
  }
  return total;
}

/** Entrées et sorties d'un mois, rangées par catégorie : Map(clé -> montant). */
function fluxDuMois(annee, mois, compteId) {
  const entrees = new Map();
  const sorties = new Map();
  const ajouter = (carte, cle, montant) => carte.set(cle, (carte.get(cle) || 0) + montant);
  const surLeCompte = (t) => compteId === 'tous' || t.compteId === compteId;

  for (const t of Store.transactionsDuMois(annee, mois)) {
    if (t.type === 'revenu' && surLeCompte(t)) ajouter(entrees, t.categorieId, t.montant);
    if (t.type === 'depense' && surLeCompte(t)) ajouter(sorties, t.categorieId, t.montant);
    if (t.type === 'virement' && compteId !== 'tous') {
      if (t.compteDestId === compteId) ajouter(entrees, CLE_VIREMENT, t.montant);
      if (t.compteId === compteId) ajouter(sorties, CLE_VIREMENT, t.montant);
    }
  }
  return { entrees, sorties };
}

const somme = (carte) => [...carte.values()].reduce((s, v) => s + v, 0);

/**
 * Prévision : moyenne, catégorie par catégorie, des 3 derniers mois terminés
 * qui contiennent quelque chose. Les abonnements y sont donc déjà compris.
 */
function prevision(compteId, aujourdhui) {
  const mois = [];
  for (let i = 1; i <= 3; i++) {
    const { annee, mois: m } = decalerMois(aujourdhui.annee, aujourdhui.mois, -i);
    const flux = fluxDuMois(annee, m, compteId);
    if (flux.entrees.size || flux.sorties.size) mois.push(flux);
  }
  const moyenne = (cle) => {
    const resultat = new Map();
    for (const flux of mois) for (const [k, v] of flux[cle]) resultat.set(k, (resultat.get(k) || 0) + v);
    for (const [k, v] of resultat) resultat.set(k, Math.round(v / mois.length));
    return resultat;
  };
  return { entrees: moyenne('entrees'), sorties: moyenne('sorties'), base: mois.length };
}

function calculerTresorerie() {
  const compteId = etat.compteStats;
  const maintenant = new Date();
  const aujourdhui = { annee: maintenant.getFullYear(), mois: maintenant.getMonth() + 1 };
  const cleAujourdhui = texteMoisCle(aujourdhui.annee, aujourdhui.mois);
  const prev = prevision(compteId, aujourdhui);

  const mois = [];
  for (let i = -(etat.periodeStats - 1); i <= NB_MOIS_PREVISION; i++) {
    const { annee, mois: m } = decalerMois(etat.annee, etat.mois, i);
    const cle = texteMoisCle(annee, m);
    let statut = 'futur';
    if (cle < cleAujourdhui) statut = 'passe';
    if (cle === cleAujourdhui) statut = 'courant';
    const flux = statut === 'futur' ? { entrees: prev.entrees, sorties: prev.sorties } : fluxDuMois(annee, m, compteId);
    mois.push({ annee, mois: m, cle, statut, ...flux, totalEntrees: somme(flux.entrees), totalSorties: somme(flux.sorties) });
  }

  // Trésorerie début / fin : réelle pour le passé et le mois en cours, enchaînée pour la prévision.
  let precedente = null;
  for (const m of mois) {
    if (m.statut === 'futur') {
      m.debut = precedente !== null ? precedente : tresorerieAu(dateDuJour(), compteId);
      m.fin = m.debut + m.totalEntrees - m.totalSorties;
    } else {
      const avant = decalerMois(m.annee, m.mois, -1);
      m.debut = tresorerieAu(finDeMois(avant.annee, avant.mois), compteId);
      m.fin = tresorerieAu(finDeMois(m.annee, m.mois), compteId);
    }
    precedente = m.fin;
  }

  return { mois, prev, compteId };
}

/* ---------- Mise en forme ---------- */

function abregeMois(annee, mois) {
  return new Date(annee, mois - 1, 1).toLocaleDateString('fr-FR', { month: 'short' });
}

/** Pour les axes : 1250000 centimes -> "12,5 k", 45000 -> "450" */
function formaterCompact(centimes) {
  const euros = centimes / 100;
  if (Math.abs(euros) >= 1000) return `${(euros / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k`;
  return `${Math.round(euros).toLocaleString('fr-FR')}`;
}

/** Une graduation « ronde » : 1, 2 ou 5 × une puissance de 10. */
function pasRond(etendue, nbGraduations = 5) {
  const brut = etendue / nbGraduations;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  return [1, 2, 5, 10].map((k) => k * puissance).find((p) => p >= brut);
}

/** Colonne au haut arrondi (4px) et à la base carrée, posée sur la ligne du zéro. */
function cheminColonne(x, y, largeur, hauteur) {
  const r = Math.min(4, largeur / 2, hauteur);
  return `M${x},${y + hauteur} V${y + r} Q${x},${y} ${x + r},${y} H${x + largeur - r} Q${x + largeur},${y} ${x + largeur},${y + r} V${y + hauteur} Z`;
}

/** Nom et icône d'une ligne du tableau (catégorie, ou virements entre comptes). */
function libelleLigne(cle) {
  if (cle === CLE_VIREMENT) return { nom: 'Virements entre comptes', icone: '⇄' };
  return Store.categorie(cle);
}

/* ---------- Graphique ---------- */

function dessinerGraphique(donnees, largeurTotale) {
  const { mois } = donnees;
  const marge = { haut: 14, droite: 10, bas: 40, gauche: 48 };
  const largeur = largeurTotale - marge.gauche - marge.droite;
  const hauteur = HAUTEUR_GRAPHIQUE - marge.haut - marge.bas;

  // UN seul axe en euros pour les colonnes et la ligne : rien n'est déformé.
  const valeurs = mois.flatMap((m) => [m.totalEntrees, m.totalSorties, m.fin, m.debut]);
  const bas0 = Math.min(0, ...valeurs);
  const haut0 = Math.max(1, ...valeurs);
  const pas = pasRond(haut0 - bas0);
  const bas = Math.floor(bas0 / pas) * pas;
  const haut = Math.ceil(haut0 / pas) * pas;
  const y = (v) => marge.haut + hauteur - ((v - bas) / (haut - bas)) * hauteur;

  const bande = largeur / mois.length;
  const largeurBarre = Math.max(3, Math.min(20, (bande * 0.56 - 2) / 2));
  const unSurDeux = bande < 34; // sur téléphone, un libellé de mois sur deux
  const centre = (i) => marge.gauche + bande * i + bande / 2;

  let fond = '';
  let grille = '';
  let colonnes = '';
  let libelles = '';
  let zones = '';

  mois.forEach((m, i) => {
    if (m.statut === 'courant') {
      fond += `<rect class="mois-courant" x="${marge.gauche + bande * i}" y="${marge.haut}" width="${bande}" height="${hauteur + marge.bas - 4}" rx="6"/>`;
    }
  });

  for (let v = bas; v <= haut + 1; v += pas) {
    const yy = Math.round(y(v)) + 0.5;
    grille += `<line class="grille ${v === 0 ? 'grille--zero' : ''}" x1="${marge.gauche}" x2="${marge.gauche + largeur}" y1="${yy}" y2="${yy}"/>`;
    grille += `<text class="axe" x="${marge.gauche - 8}" y="${yy}" text-anchor="end" dominant-baseline="middle">${formaterCompact(v)}</text>`;
  }

  mois.forEach((m, i) => {
    const c = centre(i);
    const classe = m.statut === 'futur' ? ' colonne--prevision' : '';
    if (m.totalEntrees > 0) colonnes += `<path class="serie-revenus${classe}" d="${cheminColonne(c - largeurBarre - 1, y(m.totalEntrees), largeurBarre, y(0) - y(m.totalEntrees))}"/>`;
    if (m.totalSorties > 0) colonnes += `<path class="serie-depenses${classe}" d="${cheminColonne(c + 1, y(m.totalSorties), largeurBarre, y(0) - y(m.totalSorties))}"/>`;

    if (!unSurDeux || (mois.length - 1 - i) % 2 === 0 || m.statut === 'courant') {
      libelles += `<text class="axe axe--mois ${m.statut === 'courant' ? 'axe--courant' : ''}" x="${c}" y="${HAUTEUR_GRAPHIQUE - 22}" text-anchor="middle">${echapper(abregeMois(m.annee, m.mois))}</text>`;
      libelles += `<text class="axe axe--annee" x="${c}" y="${HAUTEUR_GRAPHIQUE - 8}" text-anchor="middle">${m.annee}</text>`;
    }
    zones += `<rect class="zone-survol" x="${marge.gauche + bande * i}" y="${marge.haut}" width="${bande}" height="${hauteur}" data-index="${i}" tabindex="0" aria-label="${echapper(libelleMois(m.annee, m.mois))}"/>`;
  });

  // Ligne de trésorerie : pleine pour le réel, en pointillés pour la prévision.
  const points = mois.map((m, i) => [centre(i), y(m.fin)]);
  const statuts = mois.map((m) => m.statut);
  const dernierReel = Math.max(statuts.lastIndexOf('courant'), statuts.lastIndexOf('passe'));
  const trace = (de, a) => points.slice(de, a + 1).map(([x, yy], k) => `${k ? 'L' : 'M'}${x.toFixed(1)},${yy.toFixed(1)}`).join(' ');
  let ligne = '';
  if (dernierReel > 0) ligne += `<path class="ligne-tresorerie" d="${trace(0, dernierReel)}"/>`;
  if (dernierReel < points.length - 1) ligne += `<path class="ligne-tresorerie ligne-tresorerie--prevision" d="${trace(Math.max(dernierReel, 0), points.length - 1)}"/>`;
  const marqueurs = points.map(([x, yy], i) => `<circle class="point-tresorerie" cx="${x.toFixed(1)}" cy="${yy.toFixed(1)}" r="4"/>`).join('');

  return `<svg class="graphique__svg" width="${largeurTotale}" height="${HAUTEUR_GRAPHIQUE}" viewBox="0 0 ${largeurTotale} ${HAUTEUR_GRAPHIQUE}" role="img"
    aria-label="Entrées, sorties et solde de trésorerie par mois. Les chiffres exacts sont dans le tableau sous le graphique.">
    ${fond}${grille}${colonnes}${ligne}${marqueurs}${libelles}${zones}</svg>`;
}

/** Bulle d'information au survol (ou au clavier, ou au doigt) d'un mois. */
function brancherBulle(conteneur, donnees) {
  const bulle = conteneur.querySelector('.bulle');

  const montrer = (zone) => {
    const m = donnees.mois[Number(zone.dataset.index)];
    conteneur.querySelectorAll('.zone-survol').forEach((z) => z.classList.toggle('zone-survol--active', z === zone));

    // Textes insérés avec textContent : aucune donnée n'est interprétée comme du HTML.
    bulle.replaceChildren();
    const titre = document.createElement('div');
    titre.className = 'bulle__titre';
    let precision = '';
    if (m.statut === 'futur') precision = ' · prévision';
    if (m.statut === 'courant') precision = ' · en cours';
    titre.textContent = libelleMois(m.annee, m.mois) + precision;
    bulle.append(titre);
    [['revenus', `+${formaterMontant(m.totalEntrees)}`, 'Entrées'],
     ['depenses', `−${formaterMontant(m.totalSorties)}`, 'Sorties'],
     ['tresorerie', formaterMontant(m.fin), 'Trésorerie fin de mois']].forEach(([serie, valeur, nom]) => {
      const ligne = document.createElement('div');
      ligne.className = 'bulle__ligne';
      const cle = document.createElement('span');
      cle.className = `bulle__cle bulle__cle--${serie}`;
      const v = document.createElement('strong');
      v.textContent = valeur;
      const n = document.createElement('span');
      n.textContent = nom;
      ligne.append(cle, v, n);
      bulle.append(ligne);
    });

    const zoneBox = zone.getBoundingClientRect();
    const box = conteneur.getBoundingClientRect();
    bulle.hidden = false;
    const gauche = zoneBox.left - box.left + zoneBox.width / 2 - bulle.offsetWidth / 2;
    bulle.style.left = `${Math.max(0, Math.min(gauche, box.width - bulle.offsetWidth))}px`;
  };
  const cacher = () => {
    bulle.hidden = true;
    conteneur.querySelectorAll('.zone-survol--active').forEach((z) => z.classList.remove('zone-survol--active'));
  };

  conteneur.querySelectorAll('.zone-survol').forEach((zone) => {
    zone.addEventListener('pointerenter', () => montrer(zone));
    zone.addEventListener('focus', () => montrer(zone));
    zone.addEventListener('click', () => montrer(zone));
    zone.addEventListener('blur', cacher);
  });
  conteneur.addEventListener('pointerleave', cacher);
}

/* ---------- Tableau détaillé ---------- */

/** Toutes les catégories d'un groupe sur la période, de la plus grosse à la plus petite. */
function clesDuGroupe(mois, groupe) {
  const totaux = new Map();
  for (const m of mois) for (const [k, v] of m[groupe]) totaux.set(k, (totaux.get(k) || 0) + v);
  return [...totaux.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

function celluleMontant(m, valeur, { signe = false } = {}) {
  const classes = [`col--${m.statut}`];
  if (valeur === 0) classes.push('cellule--zero');
  if (signe && valeur < 0) classes.push('negatif');
  return `<td class="${classes.join(' ')}">${formaterMontant(valeur)}</td>`;
}

function htmlTableau(donnees) {
  const { mois } = donnees;
  const ouvert = etat.groupesOuverts;

  const entete = mois.map((m) => {
    let note = '';
    if (m.statut === 'courant') note = '<span class="col-note">mois en cours</span>';
    if (m.statut === 'futur') note = '<span class="col-note">prévision</span>';
    const nomMois = majuscule(new Date(m.annee, m.mois - 1, 1).toLocaleDateString('fr-FR', { month: 'long' }));
    return `<th scope="col" class="col--${m.statut}">${echapper(nomMois)}<span class="col-annee">${m.annee}</span>${note}</th>`;
  }).join('');

  const groupe = (cle, libelle) => {
    const total = cle === 'entrees' ? 'totalEntrees' : 'totalSorties';
    const sousLignes = clesDuGroupe(mois, cle).map((k) => {
      const { nom, icone } = libelleLigne(k);
      return `
        <tr class="sous-ligne" data-groupe="${cle}" ${ouvert[cle] ? '' : 'hidden'}>
          <th scope="row"><span class="etiquette">${echapper(icone)} ${echapper(nom)}</span></th>
          ${mois.map((m) => celluleMontant(m, m[cle].get(k) || 0)).join('')}
        </tr>`;
    }).join('');
    return `
      <tr class="ligne-groupe ligne-groupe--${cle}">
        <th scope="row">
          <button type="button" class="basculer" data-basculer="${cle}" aria-expanded="${ouvert[cle]}">
            <span class="basculer__fleche" aria-hidden="true">›</span>${libelle}
          </button>
        </th>
        ${mois.map((m) => celluleMontant(m, m[total])).join('')}
      </tr>
      ${sousLignes}`;
  };

  return `
    <div class="tableau-treso" id="tableau-treso">
      <table>
        <thead><tr><th scope="col" class="col-libelle">Mois</th>${entete}</tr></thead>
        <tbody>
          <tr class="ligne-treso">
            <th scope="row">Trésorerie début de mois</th>
            ${mois.map((m) => celluleMontant(m, m.debut, { signe: true })).join('')}
          </tr>
          ${groupe('entrees', 'Entrées')}
          ${groupe('sorties', 'Sorties')}
          <tr class="ligne-variation">
            <th scope="row">Variation du mois</th>
            ${mois.map((m) => celluleMontant(m, m.totalEntrees - m.totalSorties, { signe: true })).join('')}
          </tr>
          <tr class="ligne-treso">
            <th scope="row">Trésorerie fin de mois</th>
            ${mois.map((m) => celluleMontant(m, m.fin, { signe: true })).join('')}
          </tr>
        </tbody>
      </table>
    </div>`;
}

/* ---------- L'écran ---------- */

function rendreStatistiques() {
  if (etat.compteStats !== 'tous' && !Store.compte(etat.compteStats)) etat.compteStats = 'tous';
  const donnees = calculerTresorerie();
  const { mois, prev } = donnees;
  const premier = mois[0];
  const dernier = mois[mois.length - 1];
  const reels = mois.filter((m) => m.statut !== 'futur' && (m.totalEntrees || m.totalSorties));

  const boutonsPeriode = PERIODES_STATS.map((n) => `
    <button type="button" class="periode__btn" data-periode="${n}" aria-pressed="${etat.periodeStats === n}">${n} mois</button>`).join('');

  const choixCompte = Store.donnees.comptes.length > 1 ? `
    <select id="filtre-compte-treso" class="filtre-treso__select" aria-label="Compte">
      <option value="tous">Tous les comptes</option>
      ${optionsComptes(etat.compteStats === 'tous' ? null : etat.compteStats)}
    </select>` : '';

  // Chiffres clés sur les mois réels de la période (hors prévision)
  const nb = reels.length;
  const moyenneEntrees = nb ? Math.round(reels.reduce((s, m) => s + m.totalEntrees, 0) / nb) : 0;
  const moyenneSorties = nb ? Math.round(reels.reduce((s, m) => s + m.totalSorties, 0) / nb) : 0;
  const tresoActuelle = tresorerieAu(dateDuJour(), etat.compteStats);

  let notePrevision = "Pas encore assez d'historique pour une prévision : elle apparaîtra après ton premier mois complet.";
  if (prev.base) {
    notePrevision = `Pointillés et colonnes pâles : prévision, d'après la moyenne de tes ${prev.base} dernier${prev.base > 1 ? 's' : ''} mois (abonnements compris).`;
  }

  el.vue.innerHTML = `
    <div class="filtre-treso">
      <span class="filtre-treso__periode">
        <svg class="icone" aria-hidden="true"><use href="#i-calendrier"/></svg>
        ${echapper(abregeMois(premier.annee, premier.mois))} ${premier.annee} – ${echapper(abregeMois(dernier.annee, dernier.mois))} ${dernier.annee}
      </span>
      <div class="periode" role="group" aria-label="Nombre de mois passés">${boutonsPeriode}</div>
      ${choixCompte}
    </div>

    <section class="cartes cartes--treso">
      <div class="carte">
        <span class="carte__label">Trésorerie aujourd'hui</span>
        <strong class="carte__valeur ${tresoActuelle < 0 ? 'negatif' : ''}">${formaterMontant(tresoActuelle)}</strong>
      </div>
      <div class="carte">
        <span class="carte__label">Entrées moyennes / mois</span>
        <strong class="carte__valeur">${formaterMontant(moyenneEntrees)}</strong>
      </div>
      <div class="carte">
        <span class="carte__label">Sorties moyennes / mois</span>
        <strong class="carte__valeur">${formaterMontant(moyenneSorties)}</strong>
      </div>
      <div class="carte">
        <span class="carte__label">Prévue fin ${echapper(abregeMois(dernier.annee, dernier.mois))} ${dernier.annee}</span>
        <strong class="carte__valeur ${dernier.fin < 0 ? 'negatif' : ''}">${formaterMontant(dernier.fin)}</strong>
      </div>
    </section>

    <section class="bloc bloc--treso">
      <div class="legende-treso" aria-hidden="true">
        <span><span class="legende__cle legende__cle--revenus"></span>Entrées</span>
        <span><span class="legende__cle legende__cle--depenses"></span>Sorties</span>
        <span class="legende-treso__droite"><span class="legende__trait"></span>Solde de trésorerie</span>
      </div>
      <div class="graphique" id="graphique-mois">
        <div class="bulle" hidden></div>
      </div>
      <p class="note-prevision">${notePrevision}</p>
      ${htmlTableau(donnees)}
    </section>`;

  brancherFiltresTreso();
  dessinerGraphiqueMois(donnees);
  centrerSurMoisCourant();
}

/** Le graphique est dessiné à la largeur réelle de l'écran, pour que le texte reste lisible. */
function dessinerGraphiqueMois(donnees = calculerTresorerie()) {
  const conteneur = document.getElementById('graphique-mois');
  if (!conteneur) return;
  const bulle = conteneur.querySelector('.bulle');
  conteneur.innerHTML = dessinerGraphique(donnees, conteneur.clientWidth);
  conteneur.append(bulle);
  brancherBulle(conteneur, donnees);
}

/** Dans le tableau, on fait défiler jusqu'au mois en cours (utile sur téléphone). */
function centrerSurMoisCourant() {
  const tableau = document.getElementById('tableau-treso');
  const colonne = tableau && tableau.querySelector('thead .col--courant');
  if (!colonne) return;
  const largeurLibelle = tableau.querySelector('.col-libelle').offsetWidth;
  tableau.scrollLeft = Math.max(0, colonne.offsetLeft - largeurLibelle - 24);
}

function brancherFiltresTreso() {
  el.vue.querySelectorAll('[data-periode]').forEach((bouton) => {
    bouton.addEventListener('click', () => {
      etat.periodeStats = Number(bouton.dataset.periode);
      rendreStatistiques();
    });
  });

  const choix = document.getElementById('filtre-compte-treso');
  if (choix) {
    choix.value = etat.compteStats;
    choix.addEventListener('change', () => {
      etat.compteStats = choix.value;
      rendreStatistiques();
    });
  }

  // Ouvrir / fermer le détail des entrées ou des sorties
  el.vue.querySelectorAll('[data-basculer]').forEach((bouton) => {
    bouton.addEventListener('click', () => {
      const groupe = bouton.dataset.basculer;
      etat.groupesOuverts[groupe] = !etat.groupesOuverts[groupe];
      bouton.setAttribute('aria-expanded', etat.groupesOuverts[groupe]);
      el.vue.querySelectorAll(`.sous-ligne[data-groupe="${groupe}"]`).forEach((tr) => { tr.hidden = !etat.groupesOuverts[groupe]; });
    });
  });
}

function brancherStatistiques() {
  let minuteur = null;
  window.addEventListener('resize', () => {
    clearTimeout(minuteur);
    minuteur = setTimeout(() => {
      if (etat.vue === 'statistiques') dessinerGraphiqueMois();
    }, 150);
  });
}
