'use strict';

/* =========================================================
   Service worker : garde une copie des fichiers de l'app sur l'appareil.
   - l'app s'ouvre instantanément et fonctionne sans internet ;
   - une nouvelle version n'est installée que quand on change VERSION.

   ⚠️ À CHAQUE MISE EN LIGNE : augmenter VERSION, sinon les téléphones
   garderont l'ancienne version. Et ajouter ici tout nouveau fichier.
   (Tes données ne sont pas ici : elles restent dans le localStorage.)
   ========================================================= */

const VERSION = 'mon-budget-v1';

const FICHIERS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'favicon.svg',
  'css/style.css',
  'js/format.js',
  'js/store.js',
  'js/comptes.js',
  'js/budgets.js',
  'js/objectifs.js',
  'js/abonnements.js',
  'js/statistiques.js',
  'js/pwa.js',
  'js/app.js',
  'icones/icone-192.png',
  'icones/icone-512.png',
  'icones/icone-maskable-512.png',
  'icones/apple-touch-icon.png',
];

// Installation : on télécharge tous les fichiers de la nouvelle version.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FICHIERS)));
  // On n'active pas tout de suite : l'app propose « Mettre à jour » (voir app.js).
});

// Activation : on supprime les copies des anciennes versions.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((cle) => cle !== VERSION).map((cle) => caches.delete(cle))))
      .then(() => self.clients.claim()),
  );
});

// Message envoyé par l'app quand tu cliques sur « Mettre à jour ».
self.addEventListener('message', (e) => {
  if (e.data === 'activer') self.skipWaiting();
});

// Chaque fichier demandé est servi depuis la copie locale, sinon depuis internet.
self.addEventListener('fetch', (e) => {
  const requete = e.request;
  if (requete.method !== 'GET' || new URL(requete.url).origin !== self.location.origin) return;

  // Ouvrir l'app (ou recharger la page) renvoie toujours la page principale.
  if (requete.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then((reponse) => reponse || fetch(requete)));
    return;
  }

  e.respondWith(caches.match(requete, { ignoreSearch: true }).then((reponse) => reponse || fetch(requete)));
});
