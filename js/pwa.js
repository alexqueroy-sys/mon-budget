'use strict';

/* =========================================================
   App installable (PWA) :
   - enregistre le service worker (sw.js) qui permet l'usage hors ligne ;
   - propose « Mettre à jour » quand une nouvelle version est en ligne ;
   - demande au navigateur de ne jamais effacer les données ;
   - gère le bouton « Installer l'app » (Android / Chrome / Edge).
   ========================================================= */

const pwa = {
  invitationInstallation: null, // événement gardé pour afficher la fenêtre d'installation plus tard
};

/** L'app tourne-t-elle comme une app installée (plein écran, sans barre d'adresse) ? */
function estInstallee() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function estIphone() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function demarrerPwa() {
  // Hors ligne et mises à jour : seulement quand le site est servi en https
  // (GitHub Pages) ou en local. Pas quand on ouvre index.html comme un simple fichier.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    enregistrerServiceWorker();
  }

  // Demande de stockage « persistant » : le navigateur n'effacera pas tes données
  // pour faire de la place (important sur iPhone).
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then((deja) => { if (!deja) navigator.storage.persist(); });
  }

  // Android / Chrome / Edge : le navigateur prévient quand l'app peut être installée.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    pwa.invitationInstallation = e;
    if (etat.vue === 'parametres') afficher();
  });
  window.addEventListener('appinstalled', () => {
    pwa.invitationInstallation = null;
    afficherToast('App installée ✔ Tu la retrouves sur ton écran d\'accueil.', 4000);
  });
}

function enregistrerServiceWorker() {
  navigator.serviceWorker.register('sw.js').then((enregistrement) => {
    // Une nouvelle version était déjà téléchargée et attend.
    if (enregistrement.waiting && navigator.serviceWorker.controller) proposerMiseAJour(enregistrement.waiting);

    // Une nouvelle version se télécharge maintenant.
    enregistrement.addEventListener('updatefound', () => {
      const nouveau = enregistrement.installing;
      nouveau.addEventListener('statechange', () => {
        if (nouveau.state === 'installed' && navigator.serviceWorker.controller) proposerMiseAJour(nouveau);
      });
    });
  }).catch(() => { /* sans service worker, l'app marche quand même (en ligne) */ });

  // Quand la nouvelle version prend la main, on recharge la page une seule fois.
  let rechargee = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (rechargee) return;
    rechargee = true;
    location.reload();
  });
}

function proposerMiseAJour(serviceWorker) {
  const bandeau = document.getElementById('bandeau-maj');
  bandeau.hidden = false;
  document.getElementById('btn-maj').onclick = () => {
    bandeau.hidden = true;
    serviceWorker.postMessage('activer');
  };
}

/** Section « Installer l'app » de l'écran Paramètres. */
function htmlInstallation() {
  let contenu;
  if (estInstallee()) {
    contenu = '<p>✔ Tu utilises déjà l\'app installée.</p>';
  } else if (pwa.invitationInstallation) {
    contenu = `
      <p class="texte-doux">Ajoute Mon Budget sur ton écran d'accueil : elle s'ouvrira comme une vraie app, même sans internet.</p>
      <div class="boutons"><button type="button" class="btn btn--principal" id="btn-installer">Installer l'app</button></div>`;
  } else if (estIphone()) {
    contenu = `
      <p class="texte-doux">Sur iPhone, dans <strong>Safari</strong> :</p>
      <ol class="etapes">
        <li>Touche le bouton <strong>Partager</strong> (le carré avec une flèche vers le haut).</li>
        <li>Choisis <strong>« Sur l'écran d'accueil »</strong>.</li>
        <li>Touche <strong>Ajouter</strong>.</li>
      </ol>`;
  } else {
    contenu = `
      <p class="texte-doux">
        Ouvre <strong>alexqueroy-sys.github.io/mon-budget</strong> sur ton téléphone, puis :
      </p>
      <ul class="etapes">
        <li><strong>Android (Chrome)</strong> : menu ⋮ → « Installer l'application ».</li>
        <li><strong>iPhone (Safari)</strong> : bouton Partager → « Sur l'écran d'accueil ».</li>
      </ul>`;
  }
  return `
    <section class="bloc">
      <h2>Installer l'app</h2>
      ${contenu}
      <p class="texte-doux">Tes données restent propres à chaque appareil : utilise l'export/l'import ci-dessus pour les transférer.</p>
    </section>`;
}

function brancherInstallation() {
  const bouton = document.getElementById('btn-installer');
  if (!bouton) return;
  bouton.addEventListener('click', async () => {
    const invitation = pwa.invitationInstallation;
    if (!invitation) return;
    pwa.invitationInstallation = null;
    invitation.prompt();
    await invitation.userChoice;
    afficher();
  });
}
