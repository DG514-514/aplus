'use strict';

// Owner/admin area: manage client logins, orders and website quote requests.
// Enabled by setting ADMIN_EMAIL and ADMIN_PASSWORD environment variables.

const crypto = require('node:crypto');
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const notify = require('./notify');
const invoices = require('./invoices');
const stripe = require('./stripe');

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
  res.json({ clients, orders, inquiries, invoices: invoices.listAll(), payments: stripe.status() });
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
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM invoices WHERE client_id = ?').get(Number(req.params.id));
  if (count) {
    return res.status(409).json({ error: 'This client has invoices, which are kept as financial records. Void any open invoices instead of deleting the client.' });
  }
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

/* ---------- Invoices ---------- */

router.post('/invoices', async (req, res) => {
  const b = req.body || {};
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(b.clientId));
  if (!client) return res.status(400).json({ error: 'Choose a client.' });

  const items = (Array.isArray(b.items) ? b.items : [])
    .map((item) => ({ description: str(item?.description, 200), amount_cents: parseAmount(item?.amount) }))
    .filter((item) => item.description || item.amount_cents);
  if (!items.length) return res.status(400).json({ error: 'Add at least one line item.' });
  if (items.some((item) => !item.description)) return res.status(400).json({ error: 'Every line item needs a description.' });
  if (items.some((item) => !item.amount_cents)) return res.status(400).json({ error: 'Every line item needs an amount above $0.' });
  if (items.length > 20) return res.status(400).json({ error: 'Up to 20 line items per invoice.' });
  if (items.reduce((sum, item) => sum + item.amount_cents, 0) < 50) {
    return res.status(400).json({ error: 'The invoice total must be at least $0.50 (Stripe’s minimum).' });
  }

  const dueDate = str(b.dueDate, 10);
  if (dueDate && !DATE_RE.test(dueDate)) return res.status(400).json({ error: 'Pick a valid due date.' });
  const serviceDate = str(b.serviceDate, 10);
  if (serviceDate && !DATE_RE.test(serviceDate)) return res.status(400).json({ error: 'Pick a valid service date.' });
  const serviceTime = str(b.serviceTime, 5);
  if (serviceTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(serviceTime)) return res.status(400).json({ error: 'Pick a valid service time.' });
  if (serviceTime && !serviceDate) return res.status(400).json({ error: 'Add a service date to go with the time.' });
  const inquiryId = Number(b.inquiryId) || null;

  const invoice = invoices.create({
    clientId: client.id, items, dueDate, serviceDate, serviceTime, notes: str(b.notes, 1000), inquiryId,
  });

  let email = 'skipped';
  if (b.sendEmail !== false) {
    try {
      await notify.sendInvoiceEmail({ client, invoice, items: invoice.items });
      email = 'sent';
    } catch (err) {
      email = err.message;
    }
  }
  res.status(201).json({ invoiceNumber: invoice.invoice_number, email });
});

router.post('/invoices/:id/mark-paid', (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(req.params.id));
  if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
  if (invoice.status !== 'open') return res.status(409).json({ error: `Invoice is already ${invoice.status}.` });
  invoices.markPaid(invoice, { method: str(req.body?.method, 40) || 'manual' });
  res.json({ ok: true });
});

router.post('/invoices/:id/void', (req, res) => {
  const result = db.prepare("UPDATE invoices SET status = 'void' WHERE id = ? AND status = 'open'").run(Number(req.params.id));
  if (!result.changes) return res.status(409).json({ error: 'Only unpaid invoices can be voided.' });
  res.json({ ok: true });
});

/* ---------- Email alerts ---------- */

router.get('/email-status', (_req, res) => {
  res.json(notify.emailStatus());
});

router.post('/email-test', async (_req, res) => {
  try {
    const { to } = await notify.sendTestEmail();
    res.json({ ok: true, message: `Test email sent to ${to.join(', ')}. Check the inbox (and spam/junk) in a minute.` });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/* ---------- Website quote requests ---------- */

router.post('/inquiries/:id/decline', async (req, res) => {
  const inquiry = db.prepare('SELECT * FROM inquiries WHERE id = ?').get(Number(req.params.id));
  if (!inquiry) return res.status(404).json({ error: 'Quote request not found.' });
  if (inquiry.invoice_number) return res.status(409).json({ error: `This request was already invoiced (${inquiry.invoice_number}).` });
  if (inquiry.declined_at) return res.status(409).json({ error: 'This request was already declined.' });

  const reason = str(req.body?.reason, 1500);
  const sendEmail = req.body?.sendEmail !== false;
  if (sendEmail && !reason) return res.status(400).json({ error: 'Add a reason to include in the email.' });

  db.prepare("UPDATE inquiries SET declined_at = datetime('now'), decline_reason = ? WHERE id = ?")
    .run(reason || null, inquiry.id);

  let email = 'skipped';
  if (sendEmail) {
    try {
      await notify.sendDeclineEmail({ inquiry, reason });
      email = 'sent';
    } catch (err) {
      email = err.message;
    }
  }
  res.json({ ok: true, email });
});

router.delete('/inquiries/:id', (req, res) => {
  db.prepare('DELETE FROM inquiries WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = { router, isAdmin };
