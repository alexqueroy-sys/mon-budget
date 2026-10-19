'use strict';

/* =========================================================
   Écran Statistiques : l'évolution sur plusieurs mois.
   - des chiffres clés (moyennes, mois le plus dépensier…)
   - un graphique en colonnes : revenus et dépenses par mois
   - un graphique en barres : dépenses par catégorie sur la période
   Les virements entre tes comptes ne comptent pas (voir calculerTotaux).
   Chaque graphique a aussi sa version tableau.
   ========================================================= */

const PERIODES_STATS = [3, 6, 12];
const HAUTEUR_GRAPHIQUE = 220;
const MAX_CATEGORIES_STATS = 7; // au-delà, regroupées dans « Autres »

/** Les n mois qui se terminent au mois affiché, du plus ancien au plus récent. */
function moisDeLaPeriode() {
  const liste = [];
  for (let i = etat.periodeStats - 1; i >= 0; i--) liste.push(decalerMois(etat.annee, etat.mois, -i));
  return liste;
}

function calculerStatistiques() {
  const mois = moisDeLaPeriode().map(({ annee, mois: m }) => {
    const transactions = Store.transactionsDuMois(annee, m);
    return { annee, mois: m, transactions, ...calculerTotaux(transactions) };
  });

  // Les moyennes commencent au premier mois où il y a quelque chose :
  // les mois d'avant l'utilisation de l'app ne doivent pas faire baisser la moyenne.
  const premier = mois.findIndex((m) => m.revenus > 0 || m.depenses > 0);
  const actifs = premier === -1 ? [] : mois.slice(premier);
  const somme = (cle) => actifs.reduce((s, m) => s + m[cle], 0);

  const plusCher = actifs.reduce((max, m) => (!max || m.depenses > max.depenses ? m : max), null);

  const parCategorie = depensesParCategorie(actifs.flatMap((m) => m.transactions));
  let categories = parCategorie;
  if (parCategorie.length > MAX_CATEGORIES_STATS) {
    const reste = parCategorie.slice(MAX_CATEGORIES_STATS - 1);
    categories = [
      ...parCategorie.slice(0, MAX_CATEGORIES_STATS - 1),
      { categorie: { nom: `Autres (${reste.length})`, icone: '➕' }, montant: reste.reduce((s, c) => s + c.montant, 0) },
    ];
  }

  return {
    mois,
    nbMoisActifs: actifs.length,
    revenus: somme('revenus'),
    depenses: somme('depenses'),
    solde: somme('solde'),
    plusCher,
    categories,
  };
}

/* ---------- Mise en forme ---------- */

function abregeMois(annee, mois) {
  return new Date(annee, mois - 1, 1).toLocaleDateString('fr-FR', { month: 'short' });
}

/** Pour les axes : 1250000 centimes -> "12,5 k€", 45000 -> "450 €" */
function formaterCompact(centimes) {
  const euros = centimes / 100;
  if (Math.abs(euros) >= 1000) return `${(euros / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k€`;
  return `${Math.round(euros).toLocaleString('fr-FR')} €`;
}

/** Une graduation « ronde » : 1, 2 ou 5 × une puissance de 10. */
function pasRond(maximum, nbGraduations = 4) {
  const brut = maximum / nbGraduations;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 5, 10].map((k) => k * puissance).find((p) => p >= brut);
  return pas;
}

/** Colonne avec le haut arrondi (4px) et la base carrée, posée sur la ligne du zéro. */
function cheminColonne(x, y, largeur, hauteur) {
  const r = Math.min(4, largeur / 2, hauteur);
  return `M${x},${y + hauteur} V${y + r} Q${x},${y} ${x + r},${y} H${x + largeur - r} Q${x + largeur},${y} ${x + largeur},${y + r} V${y + hauteur} Z`;
}

/* ---------- Graphique 1 : revenus et dépenses par mois ---------- */

function dessinerColonnes(stats, largeurTotale) {
  const marge = { haut: 12, droite: 8, bas: 26, gauche: 52 };
  const largeur = largeurTotale - marge.gauche - marge.droite;
  const hauteur = HAUTEUR_GRAPHIQUE - marge.haut - marge.bas;

  const maximum = Math.max(...stats.mois.map((m) => Math.max(m.revenus, m.depenses)), 1);
  const pas = pasRond(maximum);
  const haut = Math.ceil(maximum / pas) * pas;
  const y = (v) => marge.haut + hauteur - (v / haut) * hauteur;

  const bande = largeur / stats.mois.length;
  const largeurBarre = Math.max(3, Math.min(24, (bande * 0.7 - 2) / 2));
  const libelleUnSurDeux = bande < 30; // sur téléphone en 12 mois, on n'écrit qu'un mois sur deux

  let svg = '';

  // Graduations et lignes de grille (traits fins, discrets)
  for (let v = 0; v <= haut; v += pas) {
    const yy = Math.round(y(v)) + 0.5;
    svg += `<line class="grille ${v === 0 ? 'grille--zero' : ''}" x1="${marge.gauche}" x2="${marge.gauche + largeur}" y1="${yy}" y2="${yy}"/>`;
    svg += `<text class="axe" x="${marge.gauche - 8}" y="${yy}" text-anchor="end" dominant-baseline="middle">${formaterCompact(v)}</text>`;
  }

  stats.mois.forEach((m, i) => {
    const centre = marge.gauche + bande * i + bande / 2;
    const xRevenus = centre - largeurBarre - 1; // 2px d'écart entre les deux colonnes
    const xDepenses = centre + 1;
    if (m.revenus > 0) svg += `<path class="serie-revenus" d="${cheminColonne(xRevenus, y(m.revenus), largeurBarre, y(0) - y(m.revenus))}"/>`;
    if (m.depenses > 0) svg += `<path class="serie-depenses" d="${cheminColonne(xDepenses, y(m.depenses), largeurBarre, y(0) - y(m.depenses))}"/>`;

    if (!libelleUnSurDeux || (stats.mois.length - 1 - i) % 2 === 0) {
      svg += `<text class="axe" x="${centre}" y="${HAUTEUR_GRAPHIQUE - 8}" text-anchor="middle">${echapper(abregeMois(m.annee, m.mois))}</text>`;
    }
    // Zone de survol : toute la hauteur du mois, bien plus grande que les colonnes
    svg += `<rect class="zone-survol" x="${marge.gauche + bande * i}" y="${marge.haut}" width="${bande}" height="${hauteur}" data-index="${i}" tabindex="0" aria-label="${echapper(libelleMois(m.annee, m.mois))}"/>`;
  });

  return `<svg class="graphique__svg" width="${largeurTotale}" height="${HAUTEUR_GRAPHIQUE}" viewBox="0 0 ${largeurTotale} ${HAUTEUR_GRAPHIQUE}" role="img"
    aria-label="Revenus et dépenses par mois. Les chiffres exacts sont dans le tableau sous le graphique.">${svg}</svg>`;
}

/** Bulle d'information au survol (ou au clavier) d'un mois. */
function brancherBulle(conteneur, stats) {
  const bulle = conteneur.querySelector('.bulle');

  const montrer = (zone) => {
    const m = stats.mois[Number(zone.dataset.index)];
    conteneur.querySelectorAll('.zone-survol').forEach((z) => z.classList.toggle('zone-survol--active', z === zone));

    // Textes insérés avec textContent : aucune donnée n'est interprétée comme du HTML.
    bulle.replaceChildren();
    const titre = document.createElement('div');
    titre.className = 'bulle__titre';
    titre.textContent = libelleMois(m.annee, m.mois);
    bulle.append(titre);
    [['revenus', `+${formaterMontant(m.revenus)}`, 'Revenus'],
     ['depenses', `−${formaterMontant(m.depenses)}`, 'Dépenses'],
     ['', formaterMontant(m.solde), 'Gardé']].forEach(([serie, valeur, nom]) => {
      const ligne = document.createElement('div');
      ligne.className = 'bulle__ligne';
      const cle = document.createElement('span');
      cle.className = serie ? `bulle__cle bulle__cle--${serie}` : 'bulle__cle';
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
    zone.addEventListener('click', () => montrer(zone)); // au doigt sur téléphone
    zone.addEventListener('blur', cacher);
  });
  conteneur.addEventListener('pointerleave', cacher);
}

/* ---------- Graphique 2 : dépenses par catégorie ---------- */

function htmlBarresCategories(stats) {
  const maximum = Math.max(...stats.categories.map((c) => c.montant), 1);
  return `<ul class="barres">${stats.categories.map(({ categorie, montant }) => {
    const pourcentage = Math.round((montant / stats.depenses) * 100);
    return `
      <li class="barres__ligne">
        <span class="barres__nom">${echapper(categorie.icone)} ${echapper(categorie.nom)}</span>
        <span class="barres__piste">
          <span class="barres__barre" style="width: calc((100% - 130px) * ${(montant / maximum).toFixed(4)})"></span>
          <span class="barres__valeur">${formaterMontant(montant)} · ${pourcentage} %</span>
        </span>
      </li>`;
  }).join('')}</ul>`;
}

/* ---------- Tableaux (même information que les graphiques) ---------- */

function tableauMois(stats) {
  return `
    <details class="tableau-vue">
      <summary>Voir les chiffres en tableau</summary>
      <table>
        <thead><tr><th scope="col">Mois</th><th scope="col">Revenus</th><th scope="col">Dépenses</th><th scope="col">Gardé</th></tr></thead>
        <tbody>${stats.mois.map((m) => `
          <tr>
            <th scope="row">${echapper(libelleMois(m.annee, m.mois))}</th>
            <td>${formaterMontant(m.revenus)}</td>
            <td>${formaterMontant(m.depenses)}</td>
            <td class="${m.solde < 0 ? 'negatif' : ''}">${formaterMontant(m.solde)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </details>`;
}

/* ---------- L'écran ---------- */

function rendreStatistiques() {
  const stats = calculerStatistiques();
  const premierMois = stats.mois[0];
  const dernierMois = stats.mois[stats.mois.length - 1];

  const boutonsPeriode = PERIODES_STATS.map((n) => `
    <button type="button" class="periode__btn" data-periode="${n}" aria-pressed="${etat.periodeStats === n}">${n} mois</button>`).join('');

  const entete = `
    <div class="filtre-stats">
      <div class="periode" role="group" aria-label="Période">${boutonsPeriode}</div>
      <span class="texte-doux">${echapper(libelleMois(premierMois.annee, premierMois.mois))} → ${echapper(libelleMois(dernierMois.annee, dernierMois.mois))}</span>
    </div>`;

  if (stats.nbMoisActifs === 0) {
    el.vue.innerHTML = `${entete}
      <section class="bloc"><p class="vide">Pas encore de revenus ni de dépenses sur cette période.<br>
      Les statistiques se rempliront au fil de tes <a href="#transactions">transactions</a>.</p></section>`;
    brancherPeriode();
    return;
  }

  const n = stats.nbMoisActifs;
  const moyenneGardee = Math.round(stats.solde / n);
  const moyenneDepenses = Math.round(stats.depenses / n);
  const surNMois = n > 1 ? `sur ${n} mois` : 'sur 1 mois';

  el.vue.innerHTML = `
    ${entete}

    <section class="cartes cartes--stats">
      <div class="carte carte--solde">
        <span class="carte__label">Gardé en moyenne par mois</span>
        <strong class="carte__valeur ${moyenneGardee < 0 ? 'negatif' : ''}">${formaterMontant(moyenneGardee)}</strong>
        <span class="carte__sous texte-doux">${surNMois} · total ${formaterMontant(stats.solde)}</span>
      </div>
      <div class="carte">
        <span class="carte__label">Dépense moyenne par mois</span>
        <strong class="carte__valeur">${formaterMontant(moyenneDepenses)}</strong>
      </div>
      <div class="carte">
        <span class="carte__label">Mois le plus dépensier</span>
        <strong class="carte__valeur">${formaterMontant(stats.plusCher.depenses)}</strong>
        <span class="carte__sous texte-doux">${echapper(libelleMois(stats.plusCher.annee, stats.plusCher.mois))}</span>
      </div>
    </section>

    <section class="bloc">
      <h2>Revenus et dépenses par mois</h2>
      <div class="legende" aria-hidden="true">
        <span><span class="legende__cle legende__cle--revenus"></span>Revenus</span>
        <span><span class="legende__cle legende__cle--depenses"></span>Dépenses</span>
      </div>
      <div class="graphique" id="graphique-mois">
        <div class="bulle" hidden></div>
      </div>
      ${tableauMois(stats)}
    </section>

    <section class="bloc">
      <h2>Dépenses par catégorie</h2>
      <p class="resume">${formaterMontant(stats.depenses)} dépensés ${surNMois}</p>
      ${stats.categories.length === 0 ? '<p class="vide">Aucune dépense sur cette période.</p>' : htmlBarresCategories(stats)}
    </section>`;

  brancherPeriode();
  dessinerGraphiqueMois(stats);
}

/** Le graphique est dessiné à la largeur réelle de l'écran, pour que le texte reste lisible. */
function dessinerGraphiqueMois(stats = calculerStatistiques()) {
  const conteneur = document.getElementById('graphique-mois');
  if (!conteneur) return;
  const bulle = conteneur.querySelector('.bulle');
  conteneur.innerHTML = dessinerColonnes(stats, conteneur.clientWidth);
  conteneur.append(bulle);
  brancherBulle(conteneur, stats);
}

function brancherPeriode() {
  el.vue.querySelectorAll('[data-periode]').forEach((bouton) => {
    bouton.addEventListener('click', () => {
      etat.periodeStats = Number(bouton.dataset.periode);
      rendreStatistiques();
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
