'use strict';

const path = require('node:path');
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const admin = require('./admin');
const { sendInquiryAlert } = require('./notify');
const invoices = require('./invoices');
const stripe = require('./stripe');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "script-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
  });
  next();
});

// Stripe webhook needs the raw body to verify its signature, so it's registered before JSON parsing.
app.post('/api/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
  let event;
  try {
    event = stripe.verifyWebhook(req.body.toString('utf8'), req.get('stripe-signature'));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    invoices.applyCheckoutSession(event.data.object);
  }
  res.json({ received: true });
});

app.use(express.json({ limit: '20kb' }));
app.use(auth.loadSession);

// State-changing API calls must be JSON: browsers can't send cross-site JSON
// without a CORS preflight, which (with SameSite cookies) blocks CSRF.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && !req.is('application/json')) {
    return res.status(415).json({ error: 'Expected a JSON request.' });
  }
  next();
});

const str = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------- Auth ---------- */

app.post('/api/login', (req, res) => {
  const email = str(req.body?.email, 254).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const limiterKey = req.ip;

  if (auth.loginRateLimited(limiterKey)) {
    return res.status(429).json({ error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' });
  }
  if (!email || !password) {
    return res.status(400).json({ error: 'Enter your email and password.' });
  }

  const client = db.prepare('SELECT id, password_hash FROM clients WHERE email = ?').get(email);
  const ok = auth.verifyPassword(password, client ? client.password_hash : auth.DUMMY_HASH);
  if (!client || !ok) {
    return res.status(401).json({ error: 'That email and password combination doesn’t match our records.' });
  }

  auth.clearLoginAttempts(limiterKey);
  auth.purgeExpiredSessions();
  auth.setSessionCookie(res, auth.createSession(client.id));
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  auth.destroySession(req.sessionToken);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', auth.requireClientApi, (req, res) => {
  res.json({ client: req.client });
});

app.post('/api/password', auth.requireClientApi, (req, res) => {
  const current = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const next = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  const row = db.prepare('SELECT password_hash FROM clients WHERE id = ?').get(req.client.id);
  if (!auth.verifyPassword(current, row.password_hash)) {
    return res.status(400).json({ error: 'Your current password is incorrect.' });
  }
  if (next.length < 8 || next.length > 200) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  db.prepare('UPDATE clients SET password_hash = ? WHERE id = ?').run(auth.hashPassword(next), req.client.id);
  auth.destroyOtherSessions(req.client.id, req.sessionToken);
  res.json({ ok: true });
});

/* ---------- Orders ---------- */

app.get('/api/orders', auth.requireClientApi, (req, res) => {
  const orders = db.prepare(`
    SELECT order_number, service_date, service_type, plan, location, status, amount_cents, notes
    FROM orders WHERE client_id = ?
    ORDER BY service_date DESC, id DESC
  `).all(req.client.id);
  res.json({ orders });
});

/* ---------- Invoices ---------- */

app.get('/api/invoices', auth.requireClientApi, (req, res) => {
  res.json({ invoices: invoices.listForClient(req.client.id), payments: stripe.status().configured });
});

app.post('/api/invoices/:number/pay', auth.requireClientApi, async (req, res) => {
  const invoice = invoices.findByNumber(req.params.number);
  if (!invoice || invoice.client_id !== req.client.id || invoice.status === 'void') {
    return res.status(404).json({ error: 'Invoice not found.' });
  }
  if (invoice.status === 'paid') return res.status(409).json({ error: 'This invoice is already paid.' });

  try {
    // Reuse an unexpired checkout for this invoice so double-clicks can't create two payments.
    if (invoice.stripe_session_id) {
      const existing = await stripe.retrieveCheckoutSession(invoice.stripe_session_id).catch(() => null);
      if (existing?.status === 'open' && Number(existing.amount_total) === invoice.amount_cents) {
        return res.json({ url: existing.url });
      }
      if (existing?.payment_status === 'paid') {
        invoices.applyCheckoutSession(existing);
        return res.status(409).json({ error: 'This invoice is already paid.' });
      }
    }
    const base = `${req.protocol}://${req.get('host')}`;
    const session = await stripe.createCheckoutSession({
      invoice,
      items: invoices.itemsFor(invoice.id),
      client: req.client,
      successUrl: `${base}/portal?paid={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}/portal`,
    });
    db.prepare('UPDATE invoices SET stripe_session_id = ? WHERE id = ?').run(session.id, invoice.id);
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout failed:', err.message);
    res.status(502).json({ error: 'Online payment isn’t available right now. Please try again shortly or contact us.' });
  }
});

// Called when the client returns from Stripe, so the invoice shows as paid immediately.
app.post('/api/invoices/confirm', auth.requireClientApi, async (req, res) => {
  const sessionId = str(req.body?.sessionId, 200);
  if (!sessionId) return res.status(400).json({ error: 'Missing payment reference.' });
  try {
    const session = await stripe.retrieveCheckoutSession(sessionId);
    const invoice = invoices.findByNumber(session.metadata?.invoice_number || session.client_reference_id);
    if (!invoice || invoice.client_id !== req.client.id) return res.status(404).json({ error: 'Invoice not found.' });
    const { invoice: updated, paid } = invoices.applyCheckoutSession(session);
    res.json({ paid, invoiceNumber: updated.invoice_number, status: updated.status });
  } catch (err) {
    console.error('Stripe confirm failed:', err.message);
    res.status(502).json({ error: 'We couldn’t confirm the payment yet. It will update shortly.' });
  }
});

/* ---------- Public inquiries (booking / quote form) ---------- */

app.post('/api/inquiries', (req, res) => {
  const body = req.body || {};
  // Honeypot field: real visitors never fill it in.
  if (str(body.website)) return res.json({ ok: true });

  const inquiry = {
    name: str(body.name, 120),
    email: str(body.email, 254),
    phone: str(body.phone, 40),
    residence: str(body.residence, 160),
    plan: str(body.plan, 40),
    message: str(body.message, 2000),
  };
  if (!inquiry.name || !EMAIL_RE.test(inquiry.email)) {
    return res.status(400).json({ error: 'Please include your name and a valid email address.' });
  }

  db.prepare(`
    INSERT INTO inquiries (name, email, phone, residence, plan, message)
    VALUES (:name, :email, :phone, :residence, :plan, :message)
  `).run(inquiry);
  res.status(201).json({ ok: true });

  // Email alert is best-effort: the request is already saved in the dashboard.
  sendInquiryAlert(inquiry).catch((err) => console.error('Quote request email failed:', err.message));
});

app.use('/api/admin', admin.router);

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

/* ---------- Pages ---------- */

app.get('/admin', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC_DIR, admin.isAdmin(req) ? 'admin.html' : 'admin-login.html'));
});

app.get(['/login.html', '/portal.html', '/admin.html', '/admin-login.html'], (req, res) => res.redirect(301, req.path.replace(/(-login)?\.html$/, '')));

app.get('/login', (req, res) => {
  if (req.client) return res.redirect('/portal');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.get('/portal', (req, res) => {
  if (!req.client) return res.redirect('/login');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC_DIR, 'portal.html'));
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'], index: 'index.html' }));

app.use((_req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`A+ Cleaning Solutions running at http://localhost:${PORT}`);
  });
}

module.exports = app;
