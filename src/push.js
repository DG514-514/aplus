'use strict';

// Push notifications to installed app users (owner dashboard and client portal).
// VAPID keys are generated once and stored in the database, so no setup is needed;
// VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars override them if set.

const webpush = require('web-push');
const db = require('./db');

let keys;
function vapidKeys() {
  if (keys) return keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'vapid'").get();
    if (row) {
      keys = JSON.parse(row.value);
    } else {
      keys = webpush.generateVAPIDKeys();
      db.prepare("INSERT INTO settings (key, value) VALUES ('vapid', ?)").run(JSON.stringify(keys));
    }
  }
  const contact = process.env.NOTIFY_EMAIL?.split(',')[0]?.trim() || 'info@aplus-cleaning-solutions.com';
  webpush.setVapidDetails(`mailto:${contact}`, keys.publicKey, keys.privateKey);
  return keys;
}

const publicKey = () => vapidKeys().publicKey;

function readSubscription(body) {
  const sub = body?.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000) return null;
  if (typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string') return null;
  return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh.slice(0, 200), auth: sub.keys.auth.slice(0, 100) } };
}

function save(sub, audience, clientId = null) {
  db.prepare(`
    INSERT INTO push_subscriptions (endpoint, keys_json, audience, client_id) VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET keys_json = excluded.keys_json, audience = excluded.audience, client_id = excluded.client_id
  `).run(sub.endpoint, JSON.stringify(sub.keys), audience, clientId);
}

function remove(endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(String(endpoint || ''));
}

// Test hook: lets tests capture notifications instead of sending them.
let sender = (subscription, payload) => webpush.sendNotification(subscription, payload, { TTL: 60 * 60 * 24 });
function setSender(fn) { sender = fn; }

async function sendTo(rows, message) {
  if (!rows.length) return 0;
  vapidKeys();
  const payload = JSON.stringify(message);
  let delivered = 0;
  await Promise.all(rows.map(async (row) => {
    try {
      await sender({ endpoint: row.endpoint, keys: JSON.parse(row.keys_json) }, payload);
      delivered += 1;
    } catch (err) {
      // 404/410 = the device unsubscribed or the app was removed; forget it.
      if (err.statusCode === 404 || err.statusCode === 410) remove(row.endpoint);
      else console.error('Push failed:', err.statusCode || '', err.message);
    }
  }));
  return delivered;
}

function notifyOwner(message) {
  return sendTo(db.prepare("SELECT * FROM push_subscriptions WHERE audience = 'owner'").all(),
    { icon: '/icons/owner-192.png', ...message });
}

function notifyClient(clientId, message) {
  return sendTo(db.prepare("SELECT * FROM push_subscriptions WHERE audience = 'client' AND client_id = ?").all(clientId),
    { icon: '/icons/client-192.png', ...message });
}

const ownerDeviceCount = () => db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE audience = 'owner'").get().n;

module.exports = { publicKey, readSubscription, save, remove, notifyOwner, notifyClient, ownerDeviceCount, setSender };
