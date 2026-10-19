'use strict';

/* =========================================================
   Stockage des données dans le navigateur (localStorage).

   Forme des données :
   {
     version: 4,
     categories: [{ id, nom, type: 'depense' | 'revenu', couleur, icone }],
     comptes: [{ id, nom, icone, soldeInitial (centimes, peut être négatif), archive, creeLe }],
     transactions: [{ id, type: 'depense' | 'revenu' | 'virement', montant (centimes), compteId,
                      compteDestId (virement seulement : compte qui reçoit), categorieId ('' pour un virement),
                      date: 'AAAA-MM-JJ', note, creeLe, abonnementId? }],
     budgets: [{ categorieId, montant (centimes par mois) }],
     objectifs: [{ id, nom, icone, cible (centimes), dateLimite: 'AAAA-MM-JJ' | null, creeLe,
                   versements: [{ id, montant (centimes, négatif = retrait), date }] }],
     abonnements: [{ id, nom, montant (centimes par mois), categorieId, compteId, jour (1 à 31), actif,
                     depuis: 'AAAA-MM-JJ' (aucun prélèvement avant cette date),
                     dernierMoisGenere: 'AAAA-MM' | null }],
     derniereSauvegarde: '2026-10-18T…' | null
   }

   Le numéro de version permet de mettre à jour les anciennes données
   quand l'application évolue (voir validerEtMigrer).
   ========================================================= */

const CLE_STOCKAGE = 'mon-budget.donnees';
const VERSION_DONNEES = 4;
const TYPES = ['depense', 'revenu'];                    // types de catégorie
const TYPES_TRANSACTION = [...TYPES, 'virement'];       // un virement va d'un de tes comptes à un autre
const COMPTE_PRINCIPAL = { id: 'cpt-principal', nom: 'Compte principal', icone: '🏦' };

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
    comptes: [nouveauComptePrincipal()],
    transactions: [],
    budgets: [],
    objectifs: [],
    abonnements: [],
    derniereSauvegarde: null,
  };
}

function nouveauComptePrincipal() {
  return { ...COMPTE_PRINCIPAL, soldeInitial: 0, archive: false, creeLe: new Date().toISOString() };
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
  if (d.version === 2) {
    d = { ...d, abonnements: [], version: 3 };
  }
  if (d.version === 3) {
    // Tout ce qui existait avant les comptes est rangé dans un « Compte principal ».
    const avecCompte = (liste) => (Array.isArray(liste) ? liste.map((x) => ({ ...x, compteId: COMPTE_PRINCIPAL.id })) : liste);
    d = {
      ...d,
      comptes: [nouveauComptePrincipal()],
      transactions: avecCompte(d.transactions),
      abonnements: avecCompte(d.abonnements),
      version: 4,
    };
  }

  const tableaux = ['categories', 'comptes', 'transactions', 'budgets', 'objectifs', 'abonnements'];
  if (Array.isArray(d.comptes) && d.comptes.length === 0) throw new Error(ERREUR_FORMAT);
  if (tableaux.some((cle) => !Array.isArray(d[cle]))) throw new Error(ERREUR_FORMAT);

  return {
    version: VERSION_DONNEES,
    categories: d.categories.map(validerCategorie),
    comptes: d.comptes.map(validerCompte),
    transactions: d.transactions.map(validerTransaction),
    budgets: d.budgets.map(validerBudget),
    objectifs: d.objectifs.map(validerObjectif),
    abonnements: d.abonnements.map(validerAbonnement),
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

function validerCompte(c, i) {
  const valide = c
    && typeof c.id === 'string'
    && typeof c.nom === 'string'
    && Number.isInteger(c.soldeInitial) && Math.abs(c.soldeInitial) < 1e11;
  if (!valide) throw new Error(`Le compte n°${i + 1} du fichier est invalide.`);

  return {
    id: c.id,
    nom: c.nom.slice(0, 40),
    icone: typeof c.icone === 'string' ? Array.from(c.icone).slice(0, 3).join('') : '🏦',
    soldeInitial: c.soldeInitial,
    archive: c.archive === true,
    creeLe: typeof c.creeLe === 'string' ? c.creeLe : '',
  };
}

function validerTransaction(t, i) {
  const valide = t
    && typeof t.id === 'string'
    && TYPES_TRANSACTION.includes(t.type)
    && Number.isInteger(t.montant) && t.montant > 0 && t.montant < 1e11
    && typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date)
    && typeof t.categorieId === 'string'
    && typeof t.compteId === 'string'
    && (t.type !== 'virement' || (typeof t.compteDestId === 'string' && t.compteDestId !== t.compteId));
  if (!valide) throw new Error(`La transaction n°${i + 1} du fichier est invalide.`);

  const transaction = {
    id: t.id,
    type: t.type,
    montant: t.montant,
    compteId: t.compteId,
    categorieId: t.type === 'virement' ? '' : t.categorieId,
    date: t.date,
    note: typeof t.note === 'string' ? t.note.slice(0, 100) : '',
    creeLe: typeof t.creeLe === 'string' ? t.creeLe : '',
  };
  if (t.type === 'virement') transaction.compteDestId = t.compteDestId;
  // Présent seulement sur les dépenses créées automatiquement par un abonnement
  if (typeof t.abonnementId === 'string') transaction.abonnementId = t.abonnementId;
  return transaction;
}

function validerAbonnement(a, i) {
  const valide = a
    && typeof a.id === 'string'
    && typeof a.nom === 'string'
    && montantValide(a.montant)
    && typeof a.categorieId === 'string'
    && typeof a.compteId === 'string'
    && Number.isInteger(a.jour) && a.jour >= 1 && a.jour <= 31
    && typeof a.actif === 'boolean'
    && typeof a.depuis === 'string' && FORMAT_DATE.test(a.depuis)
    && (a.dernierMoisGenere === null || (typeof a.dernierMoisGenere === 'string' && /^\d{4}-\d{2}$/.test(a.dernierMoisGenere)));
  if (!valide) throw new Error(`L'abonnement n°${i + 1} du fichier est invalide.`);

  return {
    id: a.id,
    nom: a.nom.slice(0, 40),
    montant: a.montant,
    categorieId: a.categorieId,
    compteId: a.compteId,
    jour: a.jour,
    actif: a.actif,
    depuis: a.depuis,
    dernierMoisGenere: a.dernierMoisGenere,
  };
}

/* ---------- Calendrier des prélèvements ---------- */

/** "2026-10" -> { annee: 2026, mois: 10 } */
function lireMois(texte) {
  const [annee, mois] = texte.split('-').map(Number);
  return { annee, mois };
}

function texteMois(annee, mois) {
  return `${annee}-${String(mois).padStart(2, '0')}`;
}

function moisApres({ annee, mois }) {
  return mois === 12 ? { annee: annee + 1, mois: 1 } : { annee, mois: mois + 1 };
}

/**
 * Date du prélèvement d'un mois donné. Un abonnement prélevé « le 31 »
 * tombe le dernier jour des mois plus courts (30 avril, 28 février…).
 */
function datePrelevement(annee, mois, jour) {
  const joursDansLeMois = new Date(annee, mois, 0).getDate();
  return `${texteMois(annee, mois)}-${String(Math.min(jour, joursDansLeMois)).padStart(2, '0')}`;
}

/** Premier mois pas encore traité pour cet abonnement. */
function premierMoisATraiter(abonnement) {
  return abonnement.dernierMoisGenere
    ? moisApres(lireMois(abonnement.dernierMoisGenere))
    : lireMois(abonnement.depuis.slice(0, 7));
}

/** Prochaine date de prélèvement à venir (strictement après aujourd'hui). */
function prochainPrelevement(abonnement, aujourdhui = dateDuJour()) {
  let courant = premierMoisATraiter(abonnement);
  for (let i = 0; i < 36; i++) {
    const date = datePrelevement(courant.annee, courant.mois, abonnement.jour);
    if (date >= abonnement.depuis && date > aujourdhui) return date;
    courant = moisApres(courant);
  }
  return null;
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
    if (transaction.type !== 'virement') delete transaction.compteDestId;
    return this.sauvegarder();
  },

  supprimerTransaction(id) {
    this.donnees.transactions = this.donnees.transactions.filter((t) => t.id !== id);
    return this.sauvegarder();
  },

  /* ---------- Comptes bancaires ---------- */

  compte(id) {
    return this.donnees.comptes.find((c) => c.id === id);
  },

  comptesActifs() {
    return this.donnees.comptes.filter((c) => !c.archive);
  },

  /** Ce que les transactions ont ajouté (+) ou retiré (−) sur un compte. */
  mouvementsCompte(compteId) {
    let total = 0;
    for (const t of this.donnees.transactions) {
      if (t.type === 'revenu' && t.compteId === compteId) total += t.montant;
      if (t.type === 'depense' && t.compteId === compteId) total -= t.montant;
      if (t.type === 'virement') {
        if (t.compteId === compteId) total -= t.montant;
        if (t.compteDestId === compteId) total += t.montant;
      }
    }
    return total;
  },

  /** Solde réel d'un compte : solde de départ + tous les mouvements. */
  soldeCompte(compteId) {
    const compte = this.compte(compteId);
    return compte ? compte.soldeInitial + this.mouvementsCompte(compteId) : 0;
  },

  /**
   * L'utilisateur indique toujours le solde ACTUEL du compte (ce qu'il voit sur l'appli
   * de sa banque). On en déduit le solde de départ en retirant les mouvements déjà saisis.
   */
  ajouterCompte({ nom, icone, soldeActuel }) {
    const id = genererId();
    this.donnees.comptes.push({ id, nom, icone, soldeInitial: soldeActuel, archive: false, creeLe: new Date().toISOString() });
    return this.sauvegarder();
  },

  modifierCompte(id, { nom, icone, soldeActuel, archive }) {
    const compte = this.compte(id);
    if (!compte) return false;
    Object.assign(compte, { nom, icone, archive, soldeInitial: soldeActuel - this.mouvementsCompte(id) });
    return this.sauvegarder();
  },

  /** Un compte encore utilisé par une transaction ou un abonnement ne peut pas être supprimé. */
  compteUtilise(id) {
    return this.donnees.transactions.some((t) => t.compteId === id || t.compteDestId === id)
      || this.donnees.abonnements.some((a) => a.compteId === id);
  },

  supprimerCompte(id) {
    if (this.compteUtilise(id)) return false;
    this.donnees.comptes = this.donnees.comptes.filter((c) => c.id !== id);
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

  /* ---------- Abonnements (dépenses qui reviennent chaque mois) ---------- */

  abonnement(id) {
    return this.donnees.abonnements.find((a) => a.id === id);
  },

  ajouterAbonnement(valeurs) {
    this.donnees.abonnements.push({ id: genererId(), ...valeurs, actif: true, dernierMoisGenere: null });
    return this.sauvegarder();
  },

  modifierAbonnement(id, valeurs) {
    const abonnement = this.abonnement(id);
    if (!abonnement) return false;
    // Au moment de la reprise après une pause, on ne rattrape pas les mois en pause.
    if (valeurs.actif && !abonnement.actif) valeurs.depuis = dateDuJour();
    Object.assign(abonnement, valeurs);
    return this.sauvegarder();
  },

  /** Les dépenses déjà créées par l'abonnement restent : elles ont vraiment été payées. */
  supprimerAbonnement(id) {
    this.donnees.abonnements = this.donnees.abonnements.filter((a) => a.id !== id);
    return this.sauvegarder();
  },

  /**
   * Crée les dépenses des abonnements actifs dont la date de prélèvement est arrivée,
   * y compris les mois manqués si l'app n'a pas été ouverte depuis longtemps.
   * Renvoie le nombre de dépenses créées.
   */
  genererPrelevements(aujourdhui = dateDuJour()) {
    const moisActuel = aujourdhui.slice(0, 7);
    let crees = 0;

    for (const abonnement of this.donnees.abonnements) {
      if (!abonnement.actif) continue;
      let courant = premierMoisATraiter(abonnement);

      while (texteMois(courant.annee, courant.mois) <= moisActuel) {
        const date = datePrelevement(courant.annee, courant.mois, abonnement.jour);
        if (date > aujourdhui) break; // pas encore le jour du prélèvement

        if (date >= abonnement.depuis) {
          this.donnees.transactions.push({
            id: genererId(),
            type: 'depense',
            montant: abonnement.montant,
            categorieId: abonnement.categorieId,
            compteId: abonnement.compteId,
            date,
            note: abonnement.nom,
            creeLe: new Date().toISOString(),
            abonnementId: abonnement.id,
          });
          crees += 1;
        }
        abonnement.dernierMoisGenere = texteMois(courant.annee, courant.mois);
        courant = moisApres(courant);
      }
    }

    this.sauvegarder();
    return crees;
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
