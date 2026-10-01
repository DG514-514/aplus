'use strict';

// Shared "app" features: offline support, install button, and push notifications.

(() => {
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  /* ---------- Install ---------- */

  let deferredPrompt = null;
  const installButtons = () => document.querySelectorAll('[data-install]');
  const refreshInstallButtons = () => {
    const canInstall = !isStandalone() && (deferredPrompt || isIOS());
    installButtons().forEach((btn) => { btn.hidden = !canInstall; });
    document.querySelectorAll('[data-installed]').forEach((n) => { n.hidden = !isStandalone(); });
  };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    refreshInstallButtons();
  });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; refreshInstallButtons(); });

  function showIOSHelp(reason) {
    let dialog = document.getElementById('ios-install-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'ios-install-dialog';
      dialog.className = 'app-dialog';
      dialog.innerHTML = `
        <h2>Add to your Home Screen</h2>
        <p class="app-dialog-reason"></p>
        <ol>
          <li>Tap the <strong>Share</strong> button <span aria-hidden="true">⬆️</span> at the bottom (or top) of Safari.</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong>. Then open the app from your Home Screen.</li>
        </ol>
        <button type="button" class="btn btn-primary btn-block">Got it</button>`;
      dialog.querySelector('button').addEventListener('click', () => dialog.close());
      document.body.append(dialog);
    }
    dialog.querySelector('.app-dialog-reason').textContent = reason || '';
    dialog.showModal();
  }

  async function install() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice.catch(() => null);
      deferredPrompt = null;
      refreshInstallButtons();
    } else if (isIOS()) {
      showIOSHelp('Install the app for one-tap access and notifications.');
    }
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-install]')) install();
  });
  document.addEventListener('DOMContentLoaded', refreshInstallButtons);

  /* ---------- Push notifications ---------- */

  const base64ToBytes = (b64) => {
    const padded = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  };
  const post = (url, body) => fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  });

  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  // audience: 'owner' (dashboard) or 'client' (portal)
  const apiBase = (audience) => (audience === 'owner' ? '/api/admin/push' : '/api/push');

  async function currentSubscription() {
    if (!pushSupported()) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  async function enablePush(audience) {
    if (!pushSupported()) {
      if (isIOS() && !isStandalone()) {
        showIOSHelp('On iPhone, notifications work once A+ is added to your Home Screen. Add it, open it from the Home Screen, then turn notifications on.');
        return { ok: false, reason: 'install' };
      }
      throw new Error('This browser doesn’t support notifications.');
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser or phone settings, then try again.');
    const { publicKey } = await fetch(`${apiBase(audience)}/key`).then((r) => r.json());
    const reg = await navigator.serviceWorker.ready;
    const subscription = (await reg.pushManager.getSubscription())
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(publicKey) });
    return post(`${apiBase(audience)}/subscribe`, { subscription: subscription.toJSON() });
  }

  async function disablePush(audience) {
    const subscription = await currentSubscription();
    if (!subscription) return { ok: true };
    await post(`${apiBase(audience)}/unsubscribe`, { endpoint: subscription.endpoint });
    await subscription.unsubscribe();
    return { ok: true };
  }

  async function pushEnabled() {
    return Boolean(pushSupported() && Notification.permission === 'granted' && await currentSubscription());
  }

  window.APlusApp = { isStandalone, isIOS, install, enablePush, disablePush, pushEnabled, pushSupported };
})();
