'use strict';

// Owner/admin area: manage client logins, orders and website quote requests.
// Enabled by setting ADMIN_EMAIL and ADMIN_PASSWORD environment variables.

const crypto = require('node:crypto');
const express = require('express');
const db = require('./db');
const auth = require('./auth');

const COOKIE_NAME = 'aplus_admin';
const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;
const STATUSES = ['scheduled', 'completed', 'cancelled'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const str = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const orNull = (value) => value || null;

const adminEnabled = () => Boolean(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD);

function safeEqual(a, b) {
  // Hash first so lengths match and comparison is constant-time.
  return crypto.timingSafeEqual(Buffer.from(auth.sha256(a), 'hex'), Buffer.from(auth.sha256(b), 'hex'));
}

function isAdmin(req) {
  if (!adminEnabled()) return false;
  const token = auth.readCookie(req, COOKIE_NAME);
  if (!token) return false;
  const row = db.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash = ?').get(auth.sha256(token));
  return Boolean(row && row.expires_at > Date.now());
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin sign-in required.' });
  next();
}

function parseAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount < 100000 ? Math.round(amount * 100) : null;
}

const router = express.Router();

router.post('/login', (req, res) => {
  if (!adminEnabled()) {
    return res.status(503).json({ error: 'Admin access isn’t set up yet. Add ADMIN_EMAIL and ADMIN_PASSWORD in your hosting settings.' });
  }
  const limiterKey = `admin:${req.ip}`;
  if (auth.loginRateLimited(limiterKey)) {
    return res.status(429).json({ error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' });
  }
  const email = str(req.body?.email, 254).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const emailOk = safeEqual(email, process.env.ADMIN_EMAIL.trim().toLowerCase());
  const passwordOk = safeEqual(password, process.env.ADMIN_PASSWORD);
  if (!emailOk || !passwordOk) {
    return res.status(401).json({ error: 'Incorrect admin email or password.' });
  }

  auth.clearLoginAttempts(limiterKey);
  db.prepare('DELETE FROM admin_sessions WHERE expires_at < ?').run(Date.now());
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)')
    .run(auth.sha256(token), Date.now() + ADMIN_TTL_MS);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ADMIN_TTL_MS,
    path: '/',
  });
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  const token = auth.readCookie(req, COOKIE_NAME);
  if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(auth.sha256(token));
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

router.use(requireAdmin);

router.get('/overview', (_req, res) => {
  const clients = db.prepare(`
    SELECT c.id, c.email, c.name, c.phone, c.residence, c.room, c.created_at,
           (SELECT COUNT(*) FROM orders o WHERE o.client_id = c.id) AS order_count
    FROM clients c ORDER BY c.name COLLATE NOCASE
  `).all();
  const orders = db.prepare(`
    SELECT o.id, o.order_number, o.client_id, c.name AS client_name, o.service_date, o.service_type,
           o.plan, o.location, o.status, o.amount_cents, o.notes
    FROM orders o JOIN clients c ON c.id = o.client_id
    ORDER BY o.service_date DESC, o.id DESC
  `).all();
  const inquiries = db.prepare('SELECT * FROM inquiries ORDER BY id DESC').all();
  res.json({ clients, orders, inquiries });
});

/* ---------- Clients ---------- */

router.post('/clients', (req, res) => {
  const b = req.body || {};
  const client = {
    name: str(b.name, 120),
    email: str(b.email, 254).toLowerCase(),
    password: typeof b.password === 'string' ? b.password : '',
    phone: orNull(str(b.phone, 40)),
    residence: orNull(str(b.residence, 160)),
    room: orNull(str(b.room, 40)),
  };
  if (!client.name || !EMAIL_RE.test(client.email)) {
    return res.status(400).json({ error: 'A name and valid email are required.' });
  }
  if (client.password.length < 8) {
    return res.status(400).json({ error: 'Temporary password must be at least 8 characters.' });
  }
  if (db.prepare('SELECT 1 FROM clients WHERE email = ?').get(client.email)) {
    return res.status(409).json({ error: 'A client with that email already exists.' });
  }
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO clients (email, name, password_hash, phone, residence, room) VALUES (?, ?, ?, ?, ?, ?)
  `).run(client.email, client.name, auth.hashPassword(client.password), client.phone, client.residence, client.room);
  res.status(201).json({ id: Number(lastInsertRowid) });
});

router.patch('/clients/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Client not found.' });
  const b = req.body || {};

  if (typeof b.password === 'string') {
    if (b.password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    db.prepare('UPDATE clients SET password_hash = ? WHERE id = ?').run(auth.hashPassword(b.password), id);
    db.prepare('DELETE FROM sessions WHERE client_id = ?').run(id);
    return res.json({ ok: true });
  }

  const name = str(b.name, 120) || existing.name;
  const email = (str(b.email, 254) || existing.email).toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
  if (db.prepare('SELECT 1 FROM clients WHERE email = ? AND id != ?').get(email, id)) {
    return res.status(409).json({ error: 'Another client already uses that email.' });
  }
  db.prepare('UPDATE clients SET name = ?, email = ?, phone = ?, residence = ?, room = ? WHERE id = ?')
    .run(name, email, orNull(str(b.phone, 40)), orNull(str(b.residence, 160)), orNull(str(b.room, 40)), id);
  res.json({ ok: true });
});

router.delete('/clients/:id', (req, res) => {
  const result = db.prepare('DELETE FROM clients WHERE id = ?').run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Client not found.' });
  res.json({ ok: true });
});

/* ---------- Orders ---------- */

function readOrder(b) {
  const order = {
    service_date: str(b.date, 10),
    service_type: str(b.service, 120),
    plan: str(b.plan, 40),
    location: orNull(str(b.location, 160)),
    status: str(b.status, 20) || 'scheduled',
    amount_cents: parseAmount(b.amount),
    notes: orNull(str(b.notes, 1000)),
  };
  if (!DATE_RE.test(order.service_date)) return { error: 'Pick a service date.' };
  if (!order.service_type || !order.plan) return { error: 'Service and plan are required.' };
  if (!STATUSES.includes(order.status)) return { error: 'Invalid status.' };
  if (order.amount_cents === null) return { error: 'Enter a valid amount (e.g. 49 or 49.00).' };
  return { order };
}

router.post('/orders', (req, res) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(req.body?.clientId));
  if (!client) return res.status(400).json({ error: 'Choose a client.' });
  const { order, error } = readOrder(req.body || {});
  if (error) return res.status(400).json({ error });

  order.location = order.location
    || [client.residence, client.room && `Rm ${client.room}`].filter(Boolean).join(', ') || null;
  const orderNumber = db.nextOrderNumber();
  db.prepare(`
    INSERT INTO orders (client_id, order_number, service_date, service_type, plan, location, status, amount_cents, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(client.id, orderNumber, order.service_date, order.service_type, order.plan, order.location,
    order.status, order.amount_cents, order.notes);
  res.status(201).json({ orderNumber });
});

router.patch('/orders/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Order not found.' });

  // Quick status change from the orders list.
  if (Object.keys(req.body || {}).length === 1 && 'status' in req.body) {
    if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status.' });
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(req.body.status, id);
    return res.json({ ok: true });
  }

  const { order, error } = readOrder(req.body || {});
  if (error) return res.status(400).json({ error });
  db.prepare(`
    UPDATE orders SET service_date = ?, service_type = ?, plan = ?, location = ?, status = ?, amount_cents = ?, notes = ?
    WHERE id = ?
  `).run(order.service_date, order.service_type, order.plan, order.location, order.status,
    order.amount_cents, order.notes, id);
  res.json({ ok: true });
});

router.delete('/orders/:id', (req, res) => {
  const result = db.prepare('DELETE FROM orders WHERE id = ?').run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Order not found.' });
  res.json({ ok: true });
});

/* ---------- Website quote requests ---------- */

router.delete('/inquiries/:id', (req, res) => {
  db.prepare('DELETE FROM inquiries WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = { router, isAdmin };
