'use strict';

/* =========================================================
   Stockage des données dans le navigateur (localStorage).

   Forme des données :
   {
     version: 2,
     categories: [{ id, nom, type: 'depense' | 'revenu', couleur, icone }],
     transactions: [{ id, type, montant (centimes), categorieId, date: 'AAAA-MM-JJ', note, creeLe }],
     budgets: [{ categorieId, montant (centimes par mois) }],
     objectifs: [{ id, nom, icone, cible (centimes), dateLimite: 'AAAA-MM-JJ' | null, creeLe,
                   versements: [{ id, montant (centimes, négatif = retrait), date }] }],
     derniereSauvegarde: '2026-10-18T…' | null
   }

   Le numéro de version permet de mettre à jour les anciennes données
   quand l'application évolue (voir validerEtMigrer).
   ========================================================= */

const CLE_STOCKAGE = 'mon-budget.donnees';
const VERSION_DONNEES = 2;
const TYPES = ['depense', 'revenu'];

const CATEGORIES_PAR_DEFAUT = [
  { id: 'cat-salaire',       nom: 'Salaire',       type: 'revenu',  couleur: '#2e9e6b', icone: '💼' },
  { id: 'cat-aides',         nom: 'Aides',         type: 'revenu',  couleur: '#3f8fd2', icone: '🤝' },
  { id: 'cat-autre-revenu',  nom: 'Autre revenu',  type: 'revenu',  couleur: '#7a8b99', icone: '➕' },
  { id: 'cat-courses',       nom: 'Courses',       type: 'depense', couleur: '#e07a3f', icone: '🛒' },
  { id: 'cat-transport',     nom: 'Transport',     type: 'depense', couleur: '#3f8fd2', icone: '🚆' },
  { id: 'cat-logement',      nom: 'Logement',      type: 'depense', couleur: '#8a63d2', icone: '🏠' },
  { id: 'cat-sorties',       nom: 'Sorties',       type: 'depense', couleur: '#d2457a', icone: '🎉' },
  { id: 'cat-sante',         nom: 'Santé',         type: 'depense', couleur: '#2fa3a3', icone: '💊' },
  { id: 'cat-shopping',      nom: 'Shopping',      type: 'depense', couleur: '#d2a92f', icone: '🛍️' },
  { id: 'cat-abonnements',   nom: 'Abonnements',   type: 'depense', couleur: '#5b6fd6', icone: '📱' },
  { id: 'cat-autre-depense', nom: 'Autre dépense', type: 'depense', couleur: '#7a8b99', icone: '📦' },
];

/** Utilisée si une transaction pointe vers une catégorie qui n'existe plus. */
const CATEGORIE_INCONNUE = { id: '', nom: 'Sans catégorie', type: 'depense', couleur: '#7a8b99', icone: '❔' };

function donneesInitiales() {
  return {
    version: VERSION_DONNEES,
    categories: CATEGORIES_PAR_DEFAUT.map((c) => ({ ...c })),
    transactions: [],
    budgets: [],
    objectifs: [],
    derniereSauvegarde: null,
  };
}

function genererId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** Les plus récentes d'abord (par date, puis par heure de création). */
function trierTransactions(a, b) {
  return b.date.localeCompare(a.date) || (b.creeLe || '').localeCompare(a.creeLe || '');
}

/* ---------- Validation (données stockées ou fichier importé) ---------- */

const ERREUR_FORMAT = "Ce fichier n'est pas une sauvegarde de Mon Budget.";

function validerEtMigrer(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error(ERREUR_FORMAT);
  if (!Number.isInteger(d.version) || d.version < 1) throw new Error(ERREUR_FORMAT);
  if (d.version > VERSION_DONNEES) {
    throw new Error("Cette sauvegarde vient d'une version plus récente de l'application.");
  }

  // Migrations : chaque étape fait passer les données à la version suivante.
  if (d.version === 1) {
    d = { ...d, budgets: [], objectifs: [], version: 2 };
  }

  const tableaux = ['categories', 'transactions', 'budgets', 'objectifs'];
  if (tableaux.some((cle) => !Array.isArray(d[cle]))) throw new Error(ERREUR_FORMAT);

  return {
    version: VERSION_DONNEES,
    categories: d.categories.map(validerCategorie),
    transactions: d.transactions.map(validerTransaction),
    budgets: d.budgets.map(validerBudget),
    objectifs: d.objectifs.map(validerObjectif),
    derniereSauvegarde: typeof d.derniereSauvegarde === 'string' ? d.derniereSauvegarde : null,
  };
}

const FORMAT_DATE = /^\d{4}-\d{2}-\d{2}$/;

function montantValide(m) {
  return Number.isInteger(m) && m > 0 && m < 1e11;
}

function validerBudget(b, i) {
  if (!b || typeof b.categorieId !== 'string' || !montantValide(b.montant)) {
    throw new Error(`Le budget n°${i + 1} du fichier est invalide.`);
  }
  return { categorieId: b.categorieId, montant: b.montant };
}

function validerObjectif(o, i) {
  const erreur = new Error(`L'objectif n°${i + 1} du fichier est invalide.`);
  const valide = o
    && typeof o.id === 'string'
    && typeof o.nom === 'string'
    && montantValide(o.cible)
    && (o.dateLimite === null || o.dateLimite === undefined || FORMAT_DATE.test(o.dateLimite))
    && Array.isArray(o.versements);
  if (!valide) throw erreur;

  const versements = o.versements.map((v) => {
    const ok = v && typeof v.id === 'string'
      && Number.isInteger(v.montant) && v.montant !== 0 && Math.abs(v.montant) < 1e11
      && typeof v.date === 'string' && FORMAT_DATE.test(v.date);
    if (!ok) throw erreur;
    return { id: v.id, montant: v.montant, date: v.date };
  });

  return {
    id: o.id,
    nom: o.nom.slice(0, 40),
    icone: typeof o.icone === 'string' ? Array.from(o.icone).slice(0, 3).join('') : '🎯',
    cible: o.cible,
    dateLimite: o.dateLimite || null,
    creeLe: typeof o.creeLe === 'string' ? o.creeLe : '',
    versements,
  };
}

function validerCategorie(c, i) {
  if (!c || typeof c.id !== 'string' || typeof c.nom !== 'string' || !TYPES.includes(c.type)) {
    throw new Error(`La catégorie n°${i + 1} du fichier est invalide.`);
  }
  return {
    id: c.id,
    nom: c.nom.slice(0, 40),
    type: c.type,
    couleur: /^#[0-9a-f]{6}$/i.test(c.couleur) ? c.couleur : '#7a8b99',
    icone: typeof c.icone === 'string' ? Array.from(c.icone).slice(0, 3).join('') : '•',
  };
}

function validerTransaction(t, i) {
  const valide = t
    && typeof t.id === 'string'
    && TYPES.includes(t.type)
    && Number.isInteger(t.montant) && t.montant > 0 && t.montant < 1e11
    && typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date)
    && typeof t.categorieId === 'string';
  if (!valide) throw new Error(`La transaction n°${i + 1} du fichier est invalide.`);

  return {
    id: t.id,
    type: t.type,
    montant: t.montant,
    categorieId: t.categorieId,
    date: t.date,
    note: typeof t.note === 'string' ? t.note.slice(0, 100) : '',
    creeLe: typeof t.creeLe === 'string' ? t.creeLe : '',
  };
}

/* ---------- Le magasin de données ---------- */

const Store = {
  donnees: null,
  stockageDisponible: true,

  /** Charge les données. Renvoie { donneesIllisibles: true } si elles étaient abîmées. */
  charger() {
    let brut = null;
    try {
      brut = localStorage.getItem(CLE_STOCKAGE);
    } catch {
      this.stockageDisponible = false;
    }

    if (brut) {
      try {
        this.donnees = validerEtMigrer(JSON.parse(brut));
        return {};
      } catch {
        // On ne jette jamais des données : on les met de côté avant de repartir à zéro.
        try { localStorage.setItem(`${CLE_STOCKAGE}.illisibles`, brut); } catch { /* rien à faire */ }
        this.donnees = donneesInitiales();
        return { donneesIllisibles: true };
      }
    }

    this.donnees = donneesInitiales();
    return {};
  },

  /** Enregistre tout. Renvoie false si le navigateur a refusé. */
  sauvegarder() {
    try {
      localStorage.setItem(CLE_STOCKAGE, JSON.stringify(this.donnees));
      return true;
    } catch {
      return false;
    }
  },

  categorie(id) {
    return this.donnees.categories.find((c) => c.id === id) || CATEGORIE_INCONNUE;
  },

  categoriesDuType(type) {
    return this.donnees.categories.filter((c) => c.type === type);
  },

  transaction(id) {
    return this.donnees.transactions.find((t) => t.id === id);
  },

  /** Transactions d'un mois donné (mois de 1 à 12), les plus récentes d'abord. */
  transactionsDuMois(annee, mois) {
    const prefixe = `${annee}-${String(mois).padStart(2, '0')}-`;
    return this.donnees.transactions
      .filter((t) => t.date.startsWith(prefixe))
      .sort(trierTransactions);
  },

  ajouterTransaction(valeurs) {
    this.donnees.transactions.push({ id: genererId(), ...valeurs, creeLe: new Date().toISOString() });
    return this.sauvegarder();
  },

  modifierTransaction(id, valeurs) {
    const transaction = this.transaction(id);
    if (!transaction) return false;
    Object.assign(transaction, valeurs);
    return this.sauvegarder();
  },

  supprimerTransaction(id) {
    this.donnees.transactions = this.donnees.transactions.filter((t) => t.id !== id);
    return this.sauvegarder();
  },

  /* ---------- Budgets (un montant par mois et par catégorie de dépense) ---------- */

  /** Budget mensuel d'une catégorie, en centimes, ou null s'il n'y en a pas. */
  budget(categorieId) {
    const budget = this.donnees.budgets.find((b) => b.categorieId === categorieId);
    return budget ? budget.montant : null;
  },

  definirBudget(categorieId, montant) {
    const existant = this.donnees.budgets.find((b) => b.categorieId === categorieId);
    if (existant) existant.montant = montant;
    else this.donnees.budgets.push({ categorieId, montant });
    return this.sauvegarder();
  },

  supprimerBudget(categorieId) {
    this.donnees.budgets = this.donnees.budgets.filter((b) => b.categorieId !== categorieId);
    return this.sauvegarder();
  },

  /* ---------- Objectifs d'épargne ---------- */

  objectif(id) {
    return this.donnees.objectifs.find((o) => o.id === id);
  },

  /** Somme mise de côté pour un objectif (ajouts moins retraits). */
  totalObjectif(objectif) {
    return objectif.versements.reduce((total, v) => total + v.montant, 0);
  },

  ajouterObjectif(valeurs) {
    this.donnees.objectifs.push({ id: genererId(), ...valeurs, versements: [], creeLe: new Date().toISOString() });
    return this.sauvegarder();
  },

  modifierObjectif(id, valeurs) {
    const objectif = this.objectif(id);
    if (!objectif) return false;
    Object.assign(objectif, valeurs);
    return this.sauvegarder();
  },

  supprimerObjectif(id) {
    this.donnees.objectifs = this.donnees.objectifs.filter((o) => o.id !== id);
    return this.sauvegarder();
  },

  /** montant positif = ajout, négatif = retrait. */
  ajouterVersement(objectifId, montant, date) {
    const objectif = this.objectif(objectifId);
    if (!objectif) return false;
    objectif.versements.push({ id: genererId(), montant, date });
    return this.sauvegarder();
  },

  supprimerVersement(objectifId, versementId) {
    const objectif = this.objectif(objectifId);
    if (!objectif) return false;
    objectif.versements = objectif.versements.filter((v) => v.id !== versementId);
    return this.sauvegarder();
  },

  /* ---------- Export / import ---------- */

  exporter() {
    this.donnees.derniereSauvegarde = new Date().toISOString();
    this.sauvegarder();
    return JSON.stringify(this.donnees, null, 2);
  },

  /** Lit et vérifie le contenu d'un fichier de sauvegarde. Lève une erreur lisible si invalide. */
  lireSauvegarde(texte) {
    let d;
    try {
      d = JSON.parse(texte);
    } catch {
      throw new Error(ERREUR_FORMAT);
    }
    return validerEtMigrer(d);
  },

  remplacer(donnees) {
    this.donnees = donnees;
    return this.sauvegarder();
  },
};
