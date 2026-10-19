'use strict';

/* =========================================================
   Petites fonctions utilitaires : montants, dates, texte.
   Les montants sont toujours stockés en CENTIMES (nombres entiers)
   pour éviter les erreurs d'arrondi (0.1 + 0.2 !== 0.3 en JavaScript).
   ========================================================= */

const formateurEuro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

/** 1250 -> "12,50 €" */
function formaterMontant(centimes) {
  return formateurEuro.format(centimes / 100);
}

/** 1250 -> "12,50" (pour pré-remplir un champ de saisie) */
function centimesVersSaisie(centimes) {
  return (centimes / 100).toFixed(2).replace('.', ',');
}

/**
 * Lit un montant tapé par l'utilisateur ("12", "12,5", "12.50", "1 200,00").
 * Renvoie le nombre de centimes, ou null si la saisie est invalide.
 * On découpe le texte au lieu de multiplier un nombre à virgule par 100,
 * pour ne jamais avoir d'erreur d'arrondi.
 */
function lireMontant(texte) {
  const propre = String(texte).trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(propre)) return null;

  const [entier, decimales = ''] = propre.split('.');
  const centimes = Number(entier) * 100 + Number(decimales.padEnd(2, '0'));
  return centimes > 0 ? centimes : null;
}

/** Comme lireMontant, mais accepte 0 et les montants négatifs ("-120,50") : pour un solde de compte. */
function lireMontantSigne(texte) {
  const propre = String(texte).trim().replace(/\s/g, '').replace(/^[−–]/, '-');
  const negatif = propre.startsWith('-');
  const sansSigne = negatif ? propre.slice(1) : propre;
  if (/^0+([.,]0{1,2})?$/.test(sansSigne)) return 0;
  const centimes = lireMontant(sansSigne);
  if (centimes === null) return null;
  return negatif ? -centimes : centimes;
}

/** Date locale ->"2026-10-18" (sans passer par l'UTC, qui peut décaler d'un jour) */
function dateVersTexte(date) {
  const a = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const j = String(date.getDate()).padStart(2, '0');
  return `${a}-${m}-${j}`;
}

function dateDuJour() {
  return dateVersTexte(new Date());
}

/** "2026-10-18" -> objet Date à minuit, heure locale */
function texteVersDate(texte) {
  const [a, m, j] = texte.split('-').map(Number);
  return new Date(a, m - 1, j);
}

/** "2026-10-18" -> "Samedi 18 octobre" */
function formaterDateLongue(texte) {
  const libelle = texteVersDate(texte).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  return majuscule(libelle);
}

/** "2026-10-18" -> "18 oct." */
function formaterDateCourte(texte) {
  return texteVersDate(texte).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** "2027-06-01" -> "1 juin 2027" */
function formaterDateAvecAnnee(texte) {
  return texteVersDate(texte).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** (2026, 10) -> "Octobre 2026" */
function libelleMois(annee, mois) {
  const libelle = new Date(annee, mois - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return majuscule(libelle);
}

function majuscule(texte) {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

/** Pour la recherche : minuscules et sans accents ("Économies" -> "economies") */
function normaliser(texte) {
  return String(texte).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Protège un texte avant de l'insérer dans du HTML.
 * Indispensable pour tout ce qui vient de l'utilisateur ou d'un fichier importé.
 */
function echapper(texte) {
  return String(texte)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
