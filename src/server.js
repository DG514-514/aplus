'use strict';

const path = require('node:path');
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const admin = require('./admin');
const notify = require('./notify');
const { sendInquiryAlert } = notify;
const invoices = require('./invoices');
const stripe = require('./stripe');
const push = require('./push');
const terms = require('./terms');
const jobs = require('./jobs');
const termsPages = require('./terms-pages');

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

// Meeting transcripts can be long, so the assistant accepts larger bodies.
app.use('/api/admin/assistant', express.json({ limit: '1mb' }));
app.use(express.json({ limit: '20kb' }));
app.use(auth.loadSession);

// State-changing API calls must be JSON: browsers can't send cross-site JSON
// without a CORS preflight, which (with SameSite cookies) blocks CSRF.
// Supplier job photos are uploaded as raw image bytes; image content types also require a CORS preflight.
const PHOTO_UPLOAD = /^\/(supplier\/jobs\/\d+|cleaner\/[A-Za-z0-9_-]{20,64})\/photos$/;
app.use('/api', (req, res, next) => {
  if (req.method === 'POST' && PHOTO_UPLOAD.test(req.path) && req.is(['image/jpeg', 'image/png', 'image/webp'])) return next();
  if (req.method !== 'GET' && !req.is('application/json')) {
    return res.status(415).json({ error: 'Expected a JSON request.' });
  }
  next();
});

const str = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BEDROOMS = ['1', '2', '3', '4', '5', '6+'];
const BATHROOMS = ['1', '1.5', '2', '2.5', '3', '3.5', '4+'];
const pick = (value, allowed) => (allowed.includes(value) ? value : null);
// A real calendar date (YYYY-MM-DD) or null.
const validDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
};

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

  const client = db.prepare('SELECT id, password_hash, status FROM clients WHERE email = ?').get(email);
  const ok = auth.verifyPassword(password, client ? client.password_hash : auth.DUMMY_HASH);
  if (!client || !ok) {
    return res.status(401).json({ error: 'That email and password combination doesn’t match our records.' });
  }
  if (client.status !== 'active') {
    return res.status(403).json({
      code: 'pending_approval',
      error: 'Thanks for signing up! Your account is waiting for approval. We’ll email you as soon as it’s ready.',
    });
  }

  auth.clearLoginAttempts(limiterKey);
  auth.purgeExpiredSessions();
  auth.setSessionCookie(res, auth.createSession(client.id));
  res.json({ ok: true });
});

// Website sign-up: creates the account as 'pending' until the owner approves it in the dashboard.
const SIGNUP_BEDROOMS = ['Studio', '1', '2', '3', '4', '5', '6+'];
const SIGNUP_BATHROOMS = ['1', '1.5', '2', '2.5', '3', '3.5', '4+'];

app.post('/api/signup', (req, res) => {
  if (auth.loginRateLimited(`signup:${req.ip}`)) {
    return res.status(429).json({ error: 'Too many sign-up attempts. Please wait 15 minutes and try again.' });
  }
  const b = req.body || {};
  const client = {
    name: str(b.name, 120).replace(/\s+/g, ' '),
    email: str(b.email, 254).toLowerCase(),
    phone: str(b.phone, 40),
    residence: str(b.residence, 160),
    room: str(b.room, 40) || null,
    bedrooms: SIGNUP_BEDROOMS.includes(b.bedrooms) ? b.bedrooms : null,
    bathrooms: SIGNUP_BATHROOMS.includes(b.bathrooms) ? b.bathrooms : null,
    note: str(b.note, 1000) || null,
  };
  const password = typeof b.password === 'string' ? b.password : '';
  if (client.name.length < 2) return res.status(400).json({ error: 'Enter your full name.' });
  if (!EMAIL_RE.test(client.email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (client.phone.replace(/\D/g, '').length < 7) return res.status(400).json({ error: 'Enter a phone number we can reach you at.' });
  if (!client.residence) return res.status(400).json({ error: 'Enter your residence or street address.' });
  if (!client.bedrooms || !client.bathrooms) return res.status(400).json({ error: 'Choose the number of bedrooms and bathrooms.' });
  if (password.length < 8) return res.status(400).json({ error: 'Choose a password of at least 8 characters.' });
  if (db.prepare('SELECT 1 FROM clients WHERE email = ?').get(client.email)) {
    return res.status(409).json({ error: 'An account with that email already exists. Try signing in, or email us if you need help.' });
  }

  const { lastInsertRowid } = db.prepare(`
    INSERT INTO clients (email, name, password_hash, phone, residence, room, bedrooms, bathrooms, signup_note, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(client.email, client.name, auth.hashPassword(password), client.phone, client.residence, client.room,
    client.bedrooms, client.bathrooms, client.note);
  res.status(201).json({ ok: true, status: 'pending' });

  // Alerts are best-effort: the request is already waiting in the dashboard.
  const saved = { ...client, id: Number(lastInsertRowid) };
  notify.sendSignupAlert(saved).catch((err) => console.error('Sign-up email failed:', err.message));
  push.notifyOwner({
    title: 'New account request',
    body: [client.name, client.residence].filter(Boolean).join(' · '),
    url: '/admin#clients', tag: 'signup',
  }).catch((err) => console.error('Push failed:', err.message));
});

app.post('/api/logout', (req, res) => {
  auth.destroySession(req.sessionToken);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', auth.requireClientApi, (req, res) => {
  res.json({ client: req.client, terms: { accepted: terms.hasAccepted(req.client.id), version: terms.version } });
});

/* ---------- Terms & Conditions ---------- */

app.get('/api/terms', (_req, res) => res.json(terms.current()));

app.post('/api/terms/accept', auth.requireClientApi, (req, res) => {
  const signedName = str(req.body?.signedName, 120).replace(/\s+/g, ' ');
  if (signedName.length < 2) return res.status(400).json({ error: 'Type your full name to sign.' });
  if (req.body?.agree !== true) return res.status(400).json({ error: 'Tick the box to confirm you agree.' });
  if (req.body?.version !== terms.version) {
    return res.status(409).json({ error: 'The terms were just updated. Please review the latest version.' });
  }
  if (!terms.hasAccepted(req.client.id)) {
    terms.accept(req.client, signedName, { ip: req.ip, userAgent: req.get('user-agent') });
  }
  res.json({ ok: true });
});

// Client data stays locked until the current Terms & Conditions are accepted.
function requireTerms(req, res, next) {
  if (!terms.hasAccepted(req.client.id)) {
    return res.status(403).json({ error: 'Please review and accept the Terms & Conditions first.', code: 'terms_required' });
  }
  next();
}

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

app.get('/api/orders', auth.requireClientApi, requireTerms, (req, res) => {
  const orders = db.prepare(`
    SELECT order_number, service_date, service_time, service_type, plan, location, status, amount_cents, notes
    FROM orders WHERE client_id = ?
    ORDER BY service_date DESC, id DESC
  `).all(req.client.id);
  res.json({ orders });
});

/* ---------- Push notifications (client devices) ---------- */

app.get('/api/push/key', auth.requireClientApi, (_req, res) => res.json({ publicKey: push.publicKey() }));

app.post('/api/push/subscribe', auth.requireClientApi, (req, res) => {
  const sub = push.readSubscription(req.body);
  if (!sub) return res.status(400).json({ error: 'Invalid notification subscription.' });
  push.save(sub, 'client', req.client.id);
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', auth.requireClientApi, (req, res) => {
  push.remove(req.body?.endpoint);
  res.json({ ok: true });
});

/* ---------- Invoices ---------- */

app.get('/api/invoices', auth.requireClientApi, requireTerms, (req, res) => {
  res.json({ invoices: invoices.listForClient(req.client.id), payments: stripe.status().configured });
});

app.post('/api/invoices/:number/pay', auth.requireClientApi, requireTerms, async (req, res) => {
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
app.post('/api/invoices/confirm', auth.requireClientApi, requireTerms, async (req, res) => {
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
    bedrooms: pick(str(body.bedrooms, 3), BEDROOMS),
    bathrooms: pick(str(body.bathrooms, 3), BATHROOMS),
    plan: str(body.plan, 40),
    message: str(body.message, 2000),
    requested_date: validDate(str(body.requestedDate, 10)),
    requested_time: /^([01]\d|2[0-3]):[0-5]\d$/.test(str(body.requestedTime, 5)) ? str(body.requestedTime, 5) : null,
  };
  if (!inquiry.name || !EMAIL_RE.test(inquiry.email)) {
    return res.status(400).json({ error: 'Please include your name and a valid email address.' });
  }

  db.prepare(`
    INSERT INTO inquiries (name, email, phone, residence, bedrooms, bathrooms, plan, message, requested_date, requested_time)
    VALUES (:name, :email, :phone, :residence, :bedrooms, :bathrooms, :plan, :message, :requested_date, :requested_time)
  `).run(inquiry);
  res.status(201).json({ ok: true });

  // Email alert is best-effort: the request is already saved in the dashboard.
  sendInquiryAlert(inquiry).catch((err) => console.error('Quote request email failed:', err.message));
  push.notifyOwner({
    title: 'New quote request',
    body: [inquiry.name, inquiry.plan, inquiry.residence, inquiry.requested_date].filter(Boolean).join(' · '),
    url: '/admin#inquiries', tag: 'inquiry',
  }).catch((err) => console.error('Push failed:', err.message));
});

app.use('/api/admin', admin.router);
app.use('/api/supplier', jobs.supplierRouter);
app.use('/api/cleaner', jobs.cleanerRouter);

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

/* ---------- Pages ---------- */

app.get('/admin', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC_DIR, admin.isAdmin(req) ? 'admin.html' : 'admin-login.html'));
});

app.get(['/login.html', '/signup.html', '/portal.html', '/admin.html', '/admin-login.html'], (req, res) => res.redirect(301, req.path.replace(/(-login)?\.html$/, '')));

// Ace, the owner's voice assistant, as its own page (and installable app).
app.get('/ace', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!admin.isAdmin(req)) return res.redirect('/admin?next=/ace');
  res.sendFile(path.join(PUBLIC_DIR, 'ace.html'));
});

app.get('/terms', (_req, res) => res.type('html').send(termsPages.publicPage()));

// Printable copy of a client's signed Terms & Conditions — owner only.
app.get('/admin/agreements/:id', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!admin.isAdmin(req)) return res.redirect('/admin');
  const record = terms.getRecord(Number(req.params.id));
  if (!record) return res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
  res.type('html').send(termsPages.recordPage(record));
});

// Cleaner's one-job page (no login); the page checks the link with /api/cleaner/:token.
app.get('/c/:token', (_req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' });
  res.sendFile(path.join(PUBLIC_DIR, 'cleaner.html'));
});

// Supplier portal: job requests, photos and completion.
app.get('/supplier', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC_DIR, jobs.isSupplier(req) ? 'supplier.html' : 'supplier-login.html'));
});

app.get('/signup', (req, res) => {
  if (req.client) return res.redirect('/portal');
  res.sendFile(path.join(PUBLIC_DIR, 'signup.html'));
});

app.get('/login', (req, res) => {
  if (req.client) return res.redirect('/portal');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

// App home-screen entry: signed-in clients go to their portal, everyone else to the website.
app.get('/app', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.redirect(req.client ? '/portal' : '/');
});

app.get('/portal', (req, res) => {
  if (!req.client) return res.redirect('/login');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(PUBLIC_DIR, 'portal.html'));
});

// Site settings the browser needs (currency for displaying prices).
app.get('/js/config.js', (_req, res) => {
  res.set({ 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.send(`window.APLUS = ${JSON.stringify({ currency: stripe.currency() })};\n`);
});

// The service worker must always be re-checked so app updates reach phones quickly.
app.get('/sw.js', (_req, res) => {
  res.set({ 'Cache-Control': 'no-cache', 'Content-Type': 'text/javascript; charset=utf-8' });
  res.sendFile(path.join(PUBLIC_DIR, 'sw.js'));
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'], index: 'index.html' }));

app.use((_req, res) => res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html')));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`A+ Cleaning Solutions running at http://localhost:${PORT}`);
  });
}

module.exports = app;
