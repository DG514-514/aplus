'use strict';

// Supplier jobs: the owner sends job requests to suppliers (cleaners), suppliers accept or reply in a
// thread, then upload before/after photos, record who did the work and mark the job complete.
// The owner tracks which completed jobs have been paid to each supplier.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const db = require('./db');
const auth = require('./auth');
const notify = require('./notify');
const push = require('./push');

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    cleaner_id        INTEGER NOT NULL REFERENCES cleaners(id),
    client_id         INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    client_name       TEXT,
    address           TEXT NOT NULL,
    unit              TEXT,
    bedrooms          TEXT,
    bathrooms         TEXT,
    service           TEXT,
    service_date      TEXT NOT NULL,
    time_start        TEXT,
    time_end          TEXT,
    instructions      TEXT,
    pay_cents         INTEGER NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested', 'accepted', 'completed', 'cancelled')),
    accepted_at       TEXT,
    completed_at      TEXT,
    completed_by      TEXT,
    completion_notes  TEXT,
    supplier_paid_at  TEXT,
    supplier_paid_ref TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_cleaner ON jobs(cleaner_id, status);

  CREATE TABLE IF NOT EXISTS job_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    author     TEXT NOT NULL CHECK (author IN ('owner', 'supplier')),
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS job_photos (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL CHECK (kind IN ('before', 'after')),
    file       TEXT NOT NULL,
    mime       TEXT NOT NULL,
    bytes      INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS supplier_sessions (
    token_hash TEXT PRIMARY KEY,
    cleaner_id INTEGER NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
`);
if (!db.prepare('PRAGMA table_info(cleaners)').all().some((c) => c.name === 'password_hash')) {
  db.exec('ALTER TABLE cleaners ADD COLUMN password_hash TEXT');
}
// One-job cleaner links: the supplier texts a private link to the cleaner, who uploads photos and their name
// without a login. Submitting marks the job "ready for review" until the supplier approves it.
for (const column of ['cleaner_token', 'cleaner_token_at', 'cleaner_submitted_at', 'cleaner_signed_by']) {
  if (!db.prepare('PRAGMA table_info(jobs)').all().some((c) => c.name === column)) db.exec(`ALTER TABLE jobs ADD COLUMN ${column} TEXT`);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_cleaner_token ON jobs(cleaner_token)');
// Private calendar feed (.ics) per supplier, so their jobs show up in Google / Apple / Outlook calendars.
if (!db.prepare('PRAGMA table_info(cleaners)').all().some((c) => c.name === 'calendar_token')) {
  db.exec('ALTER TABLE cleaners ADD COLUMN calendar_token TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_cleaners_calendar_token ON cleaners(calendar_token)');

const PHOTO_DIR = path.join(db.dataDir, 'uploads', 'jobs');
const COOKIE = 'aplus_sup';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PHOTOS_PER_JOB = 30;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const BEDROOMS = ['Studio', '1', '2', '3', '4', '5', '6+'];
const BATHROOMS = ['1', '1.5', '2', '2.5', '3', '3.5', '4+'];

const str = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const jobNumber = (id) => `J-${1000 + id}`;
const siteUrl = () => (process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;
const warn = (label) => (err) => console.error(`${label}:`, err.message);

/* ---------- Reading jobs ---------- */

function decorate(rows) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');
  const messages = db.prepare(`SELECT id, job_id, author, body, created_at FROM job_messages WHERE job_id IN (${marks}) ORDER BY id`).all(...ids);
  const photos = db.prepare(`SELECT id, job_id, kind, created_at FROM job_photos WHERE job_id IN (${marks}) ORDER BY id`).all(...ids);
  return rows.map((j) => {
    const thread = messages.filter((m) => m.job_id === j.id).map(({ job_id, ...m }) => m);
    return {
      ...j,
      job_number: jobNumber(j.id),
      messages: thread,
      photos: photos.filter((p) => p.job_id === j.id).map(({ job_id, ...p }) => p),
      // The supplier wrote last on an open request: the owner should respond.
      awaiting_owner: j.status === 'requested' && thread.length > 0 && thread[thread.length - 1].author === 'supplier',
    };
  });
}

const JOB_COLUMNS = `j.*, c.name AS cleaner_name, c.company AS cleaner_company`;
const getJob = (id) => db.prepare(`SELECT ${JOB_COLUMNS} FROM jobs j JOIN cleaners c ON c.id = j.cleaner_id WHERE j.id = ?`).get(id);

function listJobs(cleanerId) {
  const rows = cleanerId
    ? db.prepare(`SELECT ${JOB_COLUMNS} FROM jobs j JOIN cleaners c ON c.id = j.cleaner_id WHERE j.cleaner_id = ? ORDER BY j.service_date DESC, j.id DESC`).all(cleanerId)
    : db.prepare(`SELECT ${JOB_COLUMNS} FROM jobs j JOIN cleaners c ON c.id = j.cleaner_id ORDER BY j.service_date DESC, j.id DESC`).all();
  return decorate(rows);
}

// What A+ owes each supplier: completed jobs not yet paid, and what's been paid.
function payables(cleanerId) {
  const where = cleanerId ? 'AND j.cleaner_id = ?' : '';
  return db.prepare(`
    SELECT c.id AS cleaner_id, c.name AS cleaner_name, c.company AS cleaner_company,
      SUM(CASE WHEN j.supplier_paid_at IS NULL THEN 1 ELSE 0 END) AS unpaid_jobs,
      COALESCE(SUM(CASE WHEN j.supplier_paid_at IS NULL THEN j.pay_cents END), 0) AS outstanding_cents,
      SUM(CASE WHEN j.supplier_paid_at IS NOT NULL THEN 1 ELSE 0 END) AS paid_jobs,
      COALESCE(SUM(CASE WHEN j.supplier_paid_at IS NOT NULL THEN j.pay_cents END), 0) AS paid_cents
    FROM jobs j JOIN cleaners c ON c.id = j.cleaner_id
    WHERE j.status = 'completed' ${where}
    GROUP BY c.id ORDER BY outstanding_cents DESC, c.name COLLATE NOCASE
  `).all(...(cleanerId ? [cleanerId] : []));
}

function readJob(b) {
  const job = {
    cleaner_id: Number(b.cleanerId),
    client_id: b.clientId ? Number(b.clientId) : null,
    client_name: str(b.clientName, 120) || null,
    address: str(b.address, 200),
    unit: str(b.unit, 40) || null,
    bedrooms: BEDROOMS.includes(b.bedrooms) ? b.bedrooms : null,
    bathrooms: BATHROOMS.includes(b.bathrooms) ? b.bathrooms : null,
    service: str(b.service, 120) || null,
    service_date: str(b.serviceDate, 10),
    time_start: TIME_RE.test(b.timeStart || '') ? b.timeStart : null,
    time_end: TIME_RE.test(b.timeEnd || '') ? b.timeEnd : null,
    instructions: str(b.instructions, 2000) || null,
    pay_cents: Math.round(Number(b.pay) * 100),
  };
  if (!db.prepare('SELECT 1 FROM cleaners WHERE id = ?').get(job.cleaner_id)) return { error: 'Choose a supplier.' };
  if (job.client_id) {
    const client = db.prepare('SELECT name FROM clients WHERE id = ?').get(job.client_id);
    if (!client) return { error: 'That client no longer exists.' };
    job.client_name = job.client_name || client.name;
  }
  if (!job.address) return { error: 'Add the address of the job.' };
  if (!DATE_RE.test(job.service_date)) return { error: 'Choose the requested date.' };
  if (job.time_start && job.time_end && job.time_end <= job.time_start) return { error: 'The end time must be after the start time.' };
  if (!Number.isFinite(job.pay_cents) || job.pay_cents < 0 || job.pay_cents > 10_000_000) return { error: 'Enter what you’ll pay the supplier for this job.' };
  return { job };
}

/* ---------- Photos ---------- */

function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ['image/jpeg', 'jpg'];
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ['image/png', 'png'];
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return ['image/webp', 'webp'];
  return null;
}

function sendPhoto(res, photo) {
  const file = path.join(PHOTO_DIR, path.basename(photo.file));
  if (!fs.existsSync(file)) return res.status(404).end();
  res.set({ 'Content-Type': photo.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  return res.sendFile(file);
}

function deletePhotoFiles(jobId) {
  for (const p of db.prepare('SELECT file FROM job_photos WHERE job_id = ?').all(jobId)) {
    fs.rm(path.join(PHOTO_DIR, path.basename(p.file)), { force: true }, () => {});
  }
}

/* ---------- Supplier sessions ---------- */

function supplierFromRequest(req) {
  const token = auth.readCookie(req, COOKIE);
  if (!token) return null;
  const row = db.prepare(`
    SELECT c.id, c.name, c.company, c.email, c.phone, s.expires_at
    FROM supplier_sessions s JOIN cleaners c ON c.id = s.cleaner_id
    WHERE s.token_hash = ? AND c.active = 1 AND c.password_hash IS NOT NULL
  `).get(auth.sha256(token));
  if (!row || row.expires_at < Date.now()) return null;
  delete row.expires_at;
  return { supplier: row, token };
}

function requireSupplier(req, res, next) {
  const session = supplierFromRequest(req);
  if (!session) return res.status(401).json({ error: 'Please sign in.' });
  req.supplier = session.supplier;
  req.supplierToken = session.token;
  next();
}

const isSupplier = (req) => Boolean(supplierFromRequest(req));

/* ---------- Supplier API (/api/supplier) ---------- */

const supplierRouter = express.Router();

supplierRouter.post('/login', (req, res) => {
  const email = str(req.body?.email, 254).toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (auth.loginRateLimited(`sup:${req.ip}`)) {
    return res.status(429).json({ error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' });
  }
  if (!email || !password) return res.status(400).json({ error: 'Enter your email and password.' });
  const cleaner = db.prepare('SELECT id, password_hash, active FROM cleaners WHERE lower(email) = ? AND password_hash IS NOT NULL').get(email);
  const ok = auth.verifyPassword(password, cleaner ? cleaner.password_hash : auth.DUMMY_HASH);
  if (!cleaner || !ok || !cleaner.active) {
    return res.status(401).json({ error: 'That email and password combination doesn’t match our records.' });
  }
  auth.clearLoginAttempts(`sup:${req.ip}`);
  db.prepare('DELETE FROM supplier_sessions WHERE expires_at < ?').run(Date.now());
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO supplier_sessions (token_hash, cleaner_id, expires_at) VALUES (?, ?, ?)')
    .run(auth.sha256(token), cleaner.id, Date.now() + SESSION_TTL_MS);
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: SESSION_TTL_MS, path: '/',
  });
  res.json({ ok: true });
});

supplierRouter.post('/logout', (req, res) => {
  const token = auth.readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM supplier_sessions WHERE token_hash = ?').run(auth.sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

supplierRouter.use(requireSupplier);

supplierRouter.get('/me', (req, res) => {
  res.json({ supplier: req.supplier, payables: payables(req.supplier.id)[0] || null });
});

// Suppliers see their own jobs (cancelled ones only briefly) — never client contact details beyond the job.
supplierRouter.get('/jobs', (req, res) => {
  const jobs = listJobs(req.supplier.id)
    .filter((j) => j.status !== 'cancelled' || j.created_at >= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10))
    .map(({ client_id, ...j }) => j);
  res.json({ jobs });
});

function ownJob(req, res) {
  const job = getJob(Number(req.params.id));
  if (!job || job.cleaner_id !== req.supplier.id) {
    res.status(404).json({ error: 'Job not found.' });
    return null;
  }
  return job;
}

function tellOwner(job, title, lines, { to } = {}) {
  notify.sendNotice({
    to,
    subject: `${title}: ${jobNumber(job.id)} · ${job.address}`,
    lines,
    link: siteUrl() ? ['Open in dashboard', `${siteUrl()}/admin#jobs`] : null,
  }).catch(warn('Job email failed'));
  push.notifyOwner({ title, body: `${jobNumber(job.id)} · ${job.cleaner_name}`, url: '/admin#jobs', tag: `job-${job.id}` }).catch(warn('Push failed'));
}

supplierRouter.post('/jobs/:id/accept', (req, res) => {
  const job = ownJob(req, res);
  if (!job) return;
  if (job.status !== 'requested') return res.status(409).json({ error: 'This job can no longer be accepted.' });
  db.prepare("UPDATE jobs SET status = 'accepted', accepted_at = datetime('now') WHERE id = ?").run(job.id);
  res.json({ ok: true });
  tellOwner(job, 'Job accepted', [`${job.cleaner_name} accepted job ${jobNumber(job.id)}.`, `${job.address} · ${job.service_date}`]);
});

supplierRouter.post('/jobs/:id/messages', (req, res) => {
  const job = ownJob(req, res);
  if (!job) return;
  const body = str(req.body?.body, 2000);
  if (!body) return res.status(400).json({ error: 'Write a comment first.' });
  if (job.status === 'cancelled') return res.status(409).json({ error: 'This job was cancelled.' });
  db.prepare("INSERT INTO job_messages (job_id, author, body) VALUES (?, 'supplier', ?)").run(job.id, body);
  res.status(201).json({ ok: true });
  tellOwner(job, 'Supplier comment', [`${job.cleaner_name} commented on job ${jobNumber(job.id)} (${job.address}):`, body]);
});

const rawImage = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_PHOTO_BYTES });

supplierRouter.post('/jobs/:id/photos', rawImage, (req, res) => {
  const job = ownJob(req, res);
  if (!job) return;
  const kind = req.query.kind;
  if (!['before', 'after'].includes(kind)) return res.status(400).json({ error: 'Say whether this is a before or after photo.' });
  if (job.status !== 'accepted') return res.status(409).json({ error: 'Photos can be added once the job is accepted and before it’s marked complete.' });
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const type = sniffImage(buf);
  if (!type) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP photo.' });
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM job_photos WHERE job_id = ?').get(job.id);
  if (n >= MAX_PHOTOS_PER_JOB) return res.status(400).json({ error: `Up to ${MAX_PHOTOS_PER_JOB} photos per job.` });
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  const file = `${job.id}-${kind}-${crypto.randomBytes(8).toString('hex')}.${type[1]}`;
  fs.writeFileSync(path.join(PHOTO_DIR, file), buf);
  const { lastInsertRowid } = db.prepare('INSERT INTO job_photos (job_id, kind, file, mime, bytes) VALUES (?, ?, ?, ?, ?)')
    .run(job.id, kind, file, type[0], buf.length);
  res.status(201).json({ id: Number(lastInsertRowid), kind });
});

supplierRouter.delete('/jobs/:id/photos/:photoId', (req, res) => {
  const job = ownJob(req, res);
  if (!job) return;
  if (job.status !== 'accepted') return res.status(409).json({ error: 'Photos on a completed job can’t be changed.' });
  const photo = db.prepare('SELECT * FROM job_photos WHERE id = ? AND job_id = ?').get(Number(req.params.photoId), job.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found.' });
  db.prepare('DELETE FROM job_photos WHERE id = ?').run(photo.id);
  fs.rm(path.join(PHOTO_DIR, path.basename(photo.file)), { force: true }, () => {});
  res.json({ ok: true });
});

supplierRouter.post('/jobs/:id/complete', (req, res) => {
  const job = ownJob(req, res);
  if (!job) return;
  if (job.status !== 'accepted') return res.status(409).json({ error: 'Only accepted jobs can be marked complete.' });
  const completedBy = str(req.body?.completedBy, 120).replace(/\s+/g, ' ');
  if (completedBy.split(' ').filter(Boolean).length < 2) return res.status(400).json({ error: 'Enter the full name (first and last) of the employee who completed the job.' });
  const counts = Object.fromEntries(db.prepare('SELECT kind, COUNT(*) AS n FROM job_photos WHERE job_id = ? GROUP BY kind').all(job.id).map((r) => [r.kind, r.n]));
  if (!counts.before || !counts.after) return res.status(400).json({ error: 'Upload at least one before photo and one after photo first.' });
  db.prepare("UPDATE jobs SET status = 'completed', completed_at = datetime('now'), completed_by = ?, completion_notes = ?, cleaner_token = NULL WHERE id = ?")
    .run(completedBy, str(req.body?.notes, 2000) || null, job.id);
  res.json({ ok: true });
  tellOwner(job, 'Job completed', [
    `${job.cleaner_name} marked job ${jobNumber(job.id)} complete.`,
    `${job.address} · completed by ${completedBy}`,
    `${counts.before} before / ${counts.after} after photos uploaded. Amount owed to supplier: ${dollars(job.pay_cents)}.`,
  ], { to: notify.ownerInbox() });
});

// Cleaner link for an accepted job: create (or replace with ?new=1), turn off, or send a submission back.
const cleanerUrl = (token) => `${siteUrl() || ''}/c/${token}`;

supplierRouter.post('/jobs/:id/cleaner-link', (req, res) => {
  const job = ownJob(req, res);
  if (!job) return;
  if (job.status !== 'accepted') return res.status(409).json({ error: 'Accept the job first — the cleaner link works until the job is completed.' });
  let token = job.cleaner_token;
  if (!token || req.query.new === '1') {
    token = crypto.randomBytes(18).toString('base64url');
    db.prepare("UPDATE jobs SET cleaner_token = ?, cleaner_token_at = datetime('now') WHERE id = ?").run(token, job.id);
  }
  res.json({ url: cleanerUrl(token), path: `/c/${token}` });
});

supplierRouter.delete('/jobs/:id/cleaner-link', (req, res) => {
  const job = ownJob(req, res);
  if (!job) return;
  db.prepare('UPDATE jobs SET cleaner_token = NULL WHERE id = ?').run(job.id);
  res.json({ ok: true });
});

supplierRouter.post('/jobs/:id/send-back', (req, res) => {
  const job = ownJob(req, res);
  if (!job) return;
  if (job.status !== 'accepted' || !job.cleaner_submitted_at) return res.status(409).json({ error: 'There’s no cleaner submission to send back.' });
  db.prepare('UPDATE jobs SET cleaner_submitted_at = NULL WHERE id = ?').run(job.id);
  res.json({ ok: true });
});

supplierRouter.get('/photos/:id', (req, res) => {
  const photo = db.prepare('SELECT p.* FROM job_photos p JOIN jobs j ON j.id = p.job_id WHERE p.id = ? AND j.cleaner_id = ?')
    .get(Number(req.params.id), req.supplier.id);
  if (!photo) return res.status(404).end();
  return sendPhoto(res, photo);
});

/* ---------- Owner API (mounted on the admin router, so owner-only) ---------- */

function tellSupplier(job, subject, lines) {
  const cleaner = db.prepare('SELECT email FROM cleaners WHERE id = ?').get(job.cleaner_id);
  if (!cleaner?.email) return;
  notify.sendNotice({
    to: [cleaner.email],
    subject: `${subject}: ${jobNumber(job.id)} · ${job.address}`,
    lines,
    link: siteUrl() ? ['Open your jobs', `${siteUrl()}/supplier`] : null,
  }).catch(warn('Supplier email failed'));
}

function describe(job) {
  const when = [job.service_date, job.time_start && `${job.time_start}${job.time_end ? `–${job.time_end}` : ''}`].filter(Boolean).join(' ');
  const size = [job.bedrooms && (job.bedrooms === 'Studio' ? 'Studio' : `${job.bedrooms} bed`), job.bathrooms && `${job.bathrooms} bath`].filter(Boolean).join(' / ');
  return [`${job.address}${job.unit ? `, Unit ${job.unit}` : ''}`, [size, job.service].filter(Boolean).join(' · '), `When: ${when}`, `Pay: ${dollars(job.pay_cents)}`];
}

/* ---------- Calendar feeds (.ics) ---------- */

const FEED_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
const newFeedToken = () => crypto.randomBytes(18).toString('base64url');
const OWNER_FEED_KEY = 'owner_calendar_token';

function feedLinks(req, token) {
  const url = `${siteUrl() || `${req.protocol}://${req.get('host')}`}/cal/${token}.ics`;
  const webcal = url.replace(/^https?:/, 'webcal:');
  return { url, webcal, google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}` };
}

function supplierFeedToken(cleanerId, reset) {
  const row = db.prepare('SELECT calendar_token FROM cleaners WHERE id = ?').get(cleanerId);
  if (row?.calendar_token && !reset) return row.calendar_token;
  const token = newFeedToken();
  db.prepare('UPDATE cleaners SET calendar_token = ? WHERE id = ?').run(token, cleanerId);
  return token;
}

function ownerFeedToken(reset) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(OWNER_FEED_KEY);
  if (row && !reset) return row.value;
  const token = newFeedToken();
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(OWNER_FEED_KEY, token);
  return token;
}

const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
// Lines longer than 75 bytes are folded (RFC 5545), without splitting a multi-byte character.
function icsFold(line) {
  const parts = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; }
    cur += ch;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}
const icsDay = (iso) => iso.replace(/-/g, '');
const icsLocal = (iso, hhmm) => `${icsDay(iso)}T${hhmm.replace(':', '')}00`;
function shiftDay(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const FEED_LABEL = { requested: 'New request: ', accepted: '', completed: '✓ ', cancelled: 'Cancelled: ' };

// Times are written without a time zone ("floating"), so they show at the local time on any device.
function buildCalendar(name, jobs, { owner }) {
  const stamp = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const host = (siteUrl() || 'aplus-cleaning-solutions.com').replace(/^https?:\/\//, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//A+ Cleaning Solutions//Jobs//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(name)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const j of jobs) {
    const size = [j.bedrooms && (j.bedrooms === 'Studio' ? 'Studio' : `${j.bedrooms} bed`), j.bathrooms && `${j.bathrooms} bath`].filter(Boolean).join(' / ');
    const street = j.address.split(',')[0];
    let start;
    let end;
    if (j.time_start) {
      start = `DTSTART:${icsLocal(j.service_date, j.time_start)}`;
      if (j.time_end) end = `DTEND:${icsLocal(j.service_date, j.time_end)}`;
      else {
        const [h, m] = j.time_start.split(':').map(Number);
        const later = Math.min(h + 3, 23);
        end = `DTEND:${icsLocal(j.service_date, `${String(later).padStart(2, '0')}:${String(later === 23 ? 59 : m).padStart(2, '0')}`)}`;
      }
    } else {
      start = `DTSTART;VALUE=DATE:${icsDay(j.service_date)}`;
      end = `DTEND;VALUE=DATE:${icsDay(shiftDay(j.service_date, 1))}`;
    }
    const description = [
      [size, j.service].filter(Boolean).join(' · '),
      owner ? `Supplier: ${j.cleaner_company ? `${j.cleaner_name} (${j.cleaner_company})` : j.cleaner_name}` : null,
      owner && j.client_name ? `Client: ${j.client_name}` : null,
      j.instructions ? `Notes: ${j.instructions}` : null,
      j.status === 'completed' && j.completed_by ? `Completed by ${j.completed_by}` : null,
      `${owner ? 'Dashboard' : 'Supplier portal'}: ${siteUrl() || ''}${owner ? '/admin#jobs' : '/supplier'}`,
    ].filter(Boolean).join('\n');
    lines.push('BEGIN:VEVENT', `UID:job-${j.id}@${host}`, `DTSTAMP:${stamp}`, start, end,
      `SUMMARY:${icsText(`${FEED_LABEL[j.status] || ''}${jobNumber(j.id)} · ${street}${owner ? ` · ${j.cleaner_company || j.cleaner_name}` : ''}`)}`,
      `LOCATION:${icsText(`${j.address}${j.unit ? `, Unit ${j.unit}` : ''}`)}`,
      `DESCRIPTION:${icsText(description)}`,
      `STATUS:${{ requested: 'TENTATIVE', cancelled: 'CANCELLED' }[j.status] || 'CONFIRMED'}`,
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(icsFold).join('\r\n')}\r\n`;
}

// The .ics for a feed token, or null if the token doesn't match a supplier or the owner.
function calendarFeed(token) {
  if (!FEED_TOKEN_RE.test(token || '')) return null;
  const recent = (j) => j.service_date >= shiftDay(new Date().toISOString().slice(0, 10), -90);
  const owner = db.prepare('SELECT value FROM settings WHERE key = ?').get(OWNER_FEED_KEY);
  if (owner && owner.value === token) return buildCalendar('A+ Cleaning — All jobs', listJobs().filter(recent), { owner: true });
  const cleaner = db.prepare('SELECT id, name, company FROM cleaners WHERE calendar_token = ? AND active = 1 AND password_hash IS NOT NULL').get(token);
  if (!cleaner) return null;
  return buildCalendar(`A+ Cleaning jobs — ${cleaner.company || cleaner.name}`, listJobs(cleaner.id).filter(recent), { owner: false });
}

supplierRouter.post('/calendar-link', (req, res) => {
  res.json(feedLinks(req, supplierFeedToken(req.supplier.id, req.body?.reset === true)));
});

function registerAdminRoutes(router) {
  const jobsRouter = express.Router();

  jobsRouter.get('/', (_req, res) => res.json({ jobs: listJobs(), payables: payables() }));
  jobsRouter.post('/calendar-link', (req, res) => res.json(feedLinks(req, ownerFeedToken(req.body?.reset === true))));

  jobsRouter.post('/', (req, res) => {
    const { job, error } = readJob(req.body || {});
    if (error) return res.status(400).json({ error });
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO jobs (cleaner_id, client_id, client_name, address, unit, bedrooms, bathrooms, service, service_date, time_start, time_end, instructions, pay_cents)
      VALUES (:cleaner_id, :client_id, :client_name, :address, :unit, :bedrooms, :bathrooms, :service, :service_date, :time_start, :time_end, :instructions, :pay_cents)
    `).run(job);
    const saved = getJob(Number(lastInsertRowid));
    res.status(201).json({ id: saved.id, job_number: jobNumber(saved.id) });
    tellSupplier(saved, 'New job request', ['You have a new job request from A+ Cleaning Solutions:', ...describe(saved),
      ...(saved.instructions ? ['', saved.instructions] : []), '', 'Sign in to accept it or reply with any questions.']);
  });

  jobsRouter.patch('/:id', (req, res) => {
    const existing = getJob(Number(req.params.id));
    if (!existing) return res.status(404).json({ error: 'Job not found.' });
    if (['completed', 'cancelled'].includes(existing.status)) return res.status(409).json({ error: 'Completed or cancelled jobs can’t be edited.' });
    const { job, error } = readJob(req.body || {});
    if (error) return res.status(400).json({ error });
    // Re-assigning to another supplier sends it back to them as a new request.
    const reassigned = job.cleaner_id !== existing.cleaner_id;
    db.prepare(`
      UPDATE jobs SET cleaner_id = :cleaner_id, client_id = :client_id, client_name = :client_name, address = :address, unit = :unit,
        bedrooms = :bedrooms, bathrooms = :bathrooms, service = :service, service_date = :service_date, time_start = :time_start,
        time_end = :time_end, instructions = :instructions, pay_cents = :pay_cents
        ${reassigned ? ", status = 'requested', accepted_at = NULL, cleaner_token = NULL, cleaner_submitted_at = NULL" : ''}
      WHERE id = :id
    `).run({ ...job, id: existing.id });
    const saved = getJob(existing.id);
    res.json({ ok: true, reassigned });
    tellSupplier(saved, reassigned ? 'New job request' : 'Job updated', [
      reassigned ? 'You have a new job request from A+ Cleaning Solutions:' : `Job ${jobNumber(saved.id)} has been updated:`,
      ...describe(saved), ...(saved.instructions ? ['', saved.instructions] : [])]);
  });

  jobsRouter.post('/:id/messages', (req, res) => {
    const job = getJob(Number(req.params.id));
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    const body = str(req.body?.body, 2000);
    if (!body) return res.status(400).json({ error: 'Write a reply first.' });
    db.prepare("INSERT INTO job_messages (job_id, author, body) VALUES (?, 'owner', ?)").run(job.id, body);
    res.status(201).json({ ok: true });
    tellSupplier(job, 'New message from A+', [`A+ Cleaning Solutions replied about job ${jobNumber(job.id)} (${job.address}):`, body]);
  });

  jobsRouter.post('/:id/cancel', (req, res) => {
    const job = getJob(Number(req.params.id));
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    if (job.status === 'completed') return res.status(409).json({ error: 'Completed jobs can’t be cancelled.' });
    db.prepare("UPDATE jobs SET status = 'cancelled', cleaner_token = NULL WHERE id = ?").run(job.id);
    res.json({ ok: true });
    if (job.status !== 'cancelled') tellSupplier(job, 'Job cancelled', [`Job ${jobNumber(job.id)} on ${job.service_date} at ${job.address} has been cancelled. Sorry for any inconvenience.`]);
  });

  jobsRouter.delete('/:id', (req, res) => {
    const job = getJob(Number(req.params.id));
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    if (job.status !== 'cancelled') return res.status(409).json({ error: 'Cancel the job before deleting it.' });
    deletePhotoFiles(job.id);
    db.prepare('DELETE FROM jobs WHERE id = ?').run(job.id);
    res.json({ ok: true });
  });

  // Supplier payment tracking.
  jobsRouter.post('/:id/paid', (req, res) => {
    const job = getJob(Number(req.params.id));
    if (!job) return res.status(404).json({ error: 'Job not found.' });
    if (job.status !== 'completed') return res.status(409).json({ error: 'Only completed jobs can be marked paid.' });
    if (req.body?.paid === false) {
      db.prepare('UPDATE jobs SET supplier_paid_at = NULL, supplier_paid_ref = NULL WHERE id = ?').run(job.id);
    } else {
      db.prepare("UPDATE jobs SET supplier_paid_at = datetime('now'), supplier_paid_ref = ? WHERE id = ?").run(str(req.body?.ref, 120) || null, job.id);
    }
    res.json({ ok: true });
  });

  jobsRouter.post('/pay-all', (req, res) => {
    const cleanerId = Number(req.body?.cleanerId);
    const result = db.prepare(`
      UPDATE jobs SET supplier_paid_at = datetime('now'), supplier_paid_ref = ?
      WHERE cleaner_id = ? AND status = 'completed' AND supplier_paid_at IS NULL
    `).run(str(req.body?.ref, 120) || null, cleanerId);
    res.json({ ok: true, updated: result.changes });
  });

  jobsRouter.get('/photos/:id', (req, res) => {
    const photo = db.prepare('SELECT * FROM job_photos WHERE id = ?').get(Number(req.params.id));
    if (!photo) return res.status(404).end();
    return sendPhoto(res, photo);
  });

  router.use('/jobs', jobsRouter);

  // Supplier portal logins, managed from the Suppliers / Cleaners tab.
  router.post('/cleaners/:id/portal', (req, res) => {
    const cleaner = db.prepare('SELECT id, email FROM cleaners WHERE id = ?').get(Number(req.params.id));
    if (!cleaner) return res.status(404).json({ error: 'Cleaner not found.' });
    if (!cleaner.email) return res.status(400).json({ error: 'Add an email for this supplier first — it’s their username.' });
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    const clash = db.prepare('SELECT 1 FROM cleaners WHERE lower(email) = lower(?) AND id != ? AND password_hash IS NOT NULL').get(cleaner.email, cleaner.id);
    if (clash) return res.status(409).json({ error: 'Another supplier already signs in with that email.' });
    db.prepare('UPDATE cleaners SET password_hash = ? WHERE id = ?').run(auth.hashPassword(password), cleaner.id);
    db.prepare('DELETE FROM supplier_sessions WHERE cleaner_id = ?').run(cleaner.id);
    res.json({ ok: true, email: cleaner.email });
  });

  router.delete('/cleaners/:id/portal', (req, res) => {
    db.prepare('UPDATE cleaners SET password_hash = NULL WHERE id = ?').run(Number(req.params.id));
    db.prepare('DELETE FROM supplier_sessions WHERE cleaner_id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  });
}

/* ---------- Cleaner API (/api/cleaner/:token) — no login, one job only ---------- */

const cleanerRouter = express.Router();
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

// The link only works while the job is accepted and not long past its date.
function jobForToken(req, res) {
  const token = req.params.token;
  const job = TOKEN_RE.test(token || '')
    ? db.prepare(`SELECT ${JOB_COLUMNS} FROM jobs j JOIN cleaners c ON c.id = j.cleaner_id
        WHERE j.cleaner_token = ? AND j.status = 'accepted' AND j.service_date >= date('now', '-3 days')`).get(token)
    : null;
  if (!job) {
    res.status(404).json({ error: 'This link has expired or been turned off. Ask your supervisor for a new one.' });
    return null;
  }
  return job;
}

cleanerRouter.get('/:token', (req, res) => {
  const job = jobForToken(req, res);
  if (!job) return;
  const photos = db.prepare('SELECT id, kind FROM job_photos WHERE job_id = ? ORDER BY id').all(job.id);
  // Only what the cleaner needs on site: no pay, client contact, messages or other jobs.
  res.json({
    job: {
      job_number: jobNumber(job.id), company: job.cleaner_company || job.cleaner_name,
      address: job.address, unit: job.unit, bedrooms: job.bedrooms, bathrooms: job.bathrooms, service: job.service,
      service_date: job.service_date, time_start: job.time_start, time_end: job.time_end, instructions: job.instructions,
      submitted_at: job.cleaner_submitted_at, submitted_by: job.cleaner_signed_by, photos,
    },
  });
});

cleanerRouter.post('/:token/photos', rawImage, (req, res) => {
  const job = jobForToken(req, res);
  if (!job) return;
  if (job.cleaner_submitted_at) return res.status(409).json({ error: 'Already submitted — ask your supervisor to send it back if you need to change photos.' });
  const kind = req.query.kind;
  if (!['before', 'after'].includes(kind)) return res.status(400).json({ error: 'Say whether this is a before or after photo.' });
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const type = sniffImage(buf);
  if (!type) return res.status(400).json({ error: 'Upload a JPG, PNG or WebP photo.' });
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM job_photos WHERE job_id = ?').get(job.id);
  if (n >= MAX_PHOTOS_PER_JOB) return res.status(400).json({ error: `Up to ${MAX_PHOTOS_PER_JOB} photos per job.` });
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  const file = `${job.id}-${kind}-${crypto.randomBytes(8).toString('hex')}.${type[1]}`;
  fs.writeFileSync(path.join(PHOTO_DIR, file), buf);
  const { lastInsertRowid } = db.prepare('INSERT INTO job_photos (job_id, kind, file, mime, bytes) VALUES (?, ?, ?, ?, ?)')
    .run(job.id, kind, file, type[0], buf.length);
  res.status(201).json({ id: Number(lastInsertRowid), kind });
});

cleanerRouter.delete('/:token/photos/:photoId', (req, res) => {
  const job = jobForToken(req, res);
  if (!job) return;
  if (job.cleaner_submitted_at) return res.status(409).json({ error: 'Already submitted.' });
  const photo = db.prepare('SELECT * FROM job_photos WHERE id = ? AND job_id = ?').get(Number(req.params.photoId), job.id);
  if (!photo) return res.status(404).json({ error: 'Photo not found.' });
  db.prepare('DELETE FROM job_photos WHERE id = ?').run(photo.id);
  fs.rm(path.join(PHOTO_DIR, path.basename(photo.file)), { force: true }, () => {});
  res.json({ ok: true });
});

cleanerRouter.get('/:token/photos/:photoId', (req, res) => {
  const job = jobForToken(req, res);
  if (!job) return;
  const photo = db.prepare('SELECT * FROM job_photos WHERE id = ? AND job_id = ?').get(Number(req.params.photoId), job.id);
  if (!photo) return res.status(404).end();
  return sendPhoto(res, photo);
});

cleanerRouter.post('/:token/submit', (req, res) => {
  const job = jobForToken(req, res);
  if (!job) return;
  if (job.cleaner_submitted_at) return res.status(409).json({ error: 'Already submitted. Thank you!' });
  const name = str(req.body?.name, 120).replace(/\s+/g, ' ');
  if (name.split(' ').filter(Boolean).length < 2) return res.status(400).json({ error: 'Enter your full name (first and last).' });
  const counts = Object.fromEntries(db.prepare('SELECT kind, COUNT(*) AS n FROM job_photos WHERE job_id = ? GROUP BY kind').all(job.id).map((r) => [r.kind, r.n]));
  if (!counts.before || !counts.after) return res.status(400).json({ error: 'Add at least one before photo and one after photo.' });
  db.prepare("UPDATE jobs SET cleaner_submitted_at = datetime('now'), cleaner_signed_by = ? WHERE id = ?").run(name, job.id);
  res.json({ ok: true });
  tellOwner(job, 'Cleaner photos in', [`${name} uploaded photos for job ${jobNumber(job.id)} (${job.address}) — waiting for ${job.cleaner_company || job.cleaner_name} to approve.`]);
  // The supplier reviews and approves it in their portal.
  const supplier = db.prepare('SELECT email FROM cleaners WHERE id = ?').get(job.cleaner_id);
  if (supplier?.email) {
    notify.sendNotice({
      to: [supplier.email],
      subject: `Ready for review: ${jobNumber(job.id)} · ${job.address}`,
      lines: [`${name} submitted job ${jobNumber(job.id)} (${job.address}) with ${counts.before} before and ${counts.after} after photos.`, 'Review the photos and tap Approve & Complete.'],
      link: siteUrl() ? ['Review job', `${siteUrl()}/supplier`] : null,
    }).catch(warn('Cleaner submission email failed'));
  }
});

const jobCountForCleaner = (cleanerId) => db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE cleaner_id = ?').get(cleanerId).n;

module.exports = { supplierRouter, cleanerRouter, registerAdminRoutes, isSupplier, jobCountForCleaner, rawImage, calendarFeed };
