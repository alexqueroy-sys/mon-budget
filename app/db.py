"""SQLite : un fichier par utilisateur (voir auth.chemin_base). BUDGET_DB ne sert qu'au mode démo (BUDGET_AUTH=off)."""
import os
import sqlite3
from pathlib import Path

SCHEMA_VERSION = 2

SCHEMA = """
CREATE TABLE comptes (
    id INTEGER PRIMARY KEY,
    nom TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('courant', 'epargne')),
    solde_initial INTEGER NOT NULL DEFAULT 0,   -- centimes, avant la première transaction importée
    archive INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    nom TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('depense', 'revenu', 'interne'))  -- interne = virement entre ses comptes
);
CREATE TABLE transactions (
    id INTEGER PRIMARY KEY,
    compte_id INTEGER NOT NULL REFERENCES comptes(id),
    date TEXT NOT NULL,                          -- AAAA-MM-JJ
    libelle TEXT NOT NULL,
    montant INTEGER NOT NULL,                    -- centimes, négatif = dépense
    categorie_id INTEGER REFERENCES categories(id),
    hash TEXT NOT NULL UNIQUE,                   -- anti-doublons à l'import
    cree_le TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_tx_date ON transactions(date);
CREATE INDEX idx_tx_compte ON transactions(compte_id);
CREATE TABLE regles (
    id INTEGER PRIMARY KEY,
    motif TEXT NOT NULL,                         -- texte cherché dans le libellé (sans accents, majuscules)
    categorie_id INTEGER NOT NULL REFERENCES categories(id),
    priorite INTEGER NOT NULL DEFAULT 100        -- plus petit = testé d'abord
);
CREATE TABLE budgets (
    categorie_id INTEGER PRIMARY KEY REFERENCES categories(id),
    montant INTEGER NOT NULL CHECK (montant > 0) -- centimes par mois
);
CREATE TABLE objectifs (
    id INTEGER PRIMARY KEY,
    nom TEXT NOT NULL,
    cible INTEGER NOT NULL CHECK (cible > 0),
    date_limite TEXT
);
CREATE TABLE versements (
    id INTEGER PRIMARY KEY,
    objectif_id INTEGER NOT NULL REFERENCES objectifs(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    montant INTEGER NOT NULL CHECK (montant != 0)  -- négatif = retrait
);
CREATE TABLE abonnements (
    id INTEGER PRIMARY KEY,
    cle TEXT NOT NULL UNIQUE,                    -- marchand normalisé
    nom TEXT NOT NULL,
    montant INTEGER NOT NULL,                    -- centimes, valeur habituelle (positive)
    periode TEXT NOT NULL CHECK (periode IN ('hebdo', 'mensuel', 'annuel')),
    derniere_date TEXT NOT NULL,
    statut TEXT NOT NULL DEFAULT 'candidat' CHECK (statut IN ('candidat', 'valide', 'rejete'))
);
CREATE TABLE releves_epargne (                   -- Livret A etc. : valeur saisie à la main
    id INTEGER PRIMARY KEY,
    compte_id INTEGER NOT NULL REFERENCES comptes(id),
    date TEXT NOT NULL,
    solde INTEGER NOT NULL,
    UNIQUE (compte_id, date)
);
CREATE TABLE prets (
    id INTEGER PRIMARY KEY,
    nom TEXT NOT NULL,
    capital INTEGER NOT NULL CHECK (capital > 0),   -- centimes empruntés
    taux_annuel REAL NOT NULL CHECK (taux_annuel >= 0),  -- 0.012 = 1,2 %
    date_debut TEXT NOT NULL,                       -- début du différé
    differe_mois INTEGER NOT NULL DEFAULT 0,        -- intérêts capitalisés pendant cette période
    duree_mois INTEGER NOT NULL CHECK (duree_mois > 0)  -- nombre de mensualités après le différé
);
"""

CATEGORIES_PAR_DEFAUT = [
    ("Salaire", "revenu"), ("Aides", "revenu"), ("Autre revenu", "revenu"),
    ("Courses", "depense"), ("Transport", "depense"), ("Logement", "depense"),
    ("Sorties", "depense"), ("Santé", "depense"), ("Shopping", "depense"),
    ("Loisirs", "depense"), ("Abonnements", "depense"), ("Prêt", "depense"),
    ("Autre dépense", "depense"), ("Virement interne", "interne"),
]

# Exemples de règles de départ : à adapter dans l'app. (motif, catégorie)
REGLES_PAR_DEFAUT = [
    ("NETFLIX", "Abonnements"), ("SPOTIFY", "Abonnements"), ("DISNEY", "Abonnements"),
    ("CARREFOUR", "Courses"), ("LECLERC", "Courses"), ("AUCHAN", "Courses"), ("LIDL", "Courses"),
    ("SNCF", "Transport"), ("NAVIGO", "Transport"), ("RATP", "Transport"),
    ("PHARMACIE", "Santé"), ("AMAZON", "Shopping"), ("STEAM", "Loisirs"),
]


def chemin_db() -> Path:
    return Path(os.environ.get("BUDGET_DB", "data/budget.db"))


def connect(chemin: str | Path | None = None) -> sqlite3.Connection:
    """Ouvre la base (la crée au besoin). À appeler à chaque exécution de page : pas de partage entre threads."""
    p = Path(chemin) if chemin else chemin_db()
    if str(p) != ":memory:":
        p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    conn = sqlite3.connect(str(p))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    migrer(conn)
    return conn


def migrer(conn: sqlite3.Connection) -> None:
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version > SCHEMA_VERSION:
        raise RuntimeError("La base vient d'une version plus récente de l'application.")
    if version == 0:
        conn.executescript(SCHEMA)
        conn.executemany("INSERT INTO categories (nom, type) VALUES (?, ?)", CATEGORIES_PAR_DEFAUT)
        for priorite, (motif, cat) in enumerate(REGLES_PAR_DEFAUT):
            conn.execute(
                "INSERT INTO regles (motif, categorie_id, priorite) "
                "SELECT ?, id, ? FROM categories WHERE nom = ?", (motif, priorite, cat))
        conn.execute("PRAGMA user_version = 1")
        conn.commit()
        version = 1
    if version < 2:
        # Chaque compte appartient à une banque ('bnp', 'boursorama' ou 'autre') : détermine le format d'import.
        conn.execute("ALTER TABLE comptes ADD COLUMN banque TEXT NOT NULL DEFAULT 'autre'")
        conn.execute("PRAGMA user_version = 2")
        conn.commit()


def categorie_id(conn: sqlite3.Connection, nom: str) -> int | None:
    r = conn.execute("SELECT id FROM categories WHERE nom = ?", (nom,)).fetchone()
    return r["id"] if r else None
