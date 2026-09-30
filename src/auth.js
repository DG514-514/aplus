'use strict';

const crypto = require('node:crypto');
const db = require('./db');

const COOKIE_NAME = 'aplus_sid';
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Used when the email doesn't exist so response time doesn't reveal which accounts are real.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function createSession(clientId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, client_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), clientId, Date.now() + SESSION_TTL_MS);
  return token;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

function destroyOtherSessions(clientId, keepToken) {
  db.prepare('DELETE FROM sessions WHERE client_id = ? AND token_hash != ?')
    .run(clientId, sha256(keepToken));
}

function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1 && part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function getSessionClient(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (!token) return null;
  const row = db.prepare(`
    SELECT c.id, c.email, c.name, c.phone, c.residence, c.room, c.created_at, s.expires_at
    FROM sessions s JOIN clients c ON c.id = s.client_id
    WHERE s.token_hash = ?
  `).get(sha256(token));
  if (!row || row.expires_at < Date.now()) return null;
  delete row.expires_at;
  return { client: row, token };
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// Loads the logged-in client (if any) onto req.
function loadSession(req, _res, next) {
  const session = getSessionClient(req);
  req.client = session ? session.client : null;
  req.sessionToken = session ? session.token : null;
  next();
}

function requireClientApi(req, res, next) {
  if (!req.client) return res.status(401).json({ error: 'Please sign in to continue.' });
  next();
}

// Simple in-memory limiter for login attempts, keyed by IP.
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function loginRateLimited(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

function clearLoginAttempts(key) {
  attempts.delete(key);
}

module.exports = {
  DUMMY_HASH,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  destroyOtherSessions,
  purgeExpiredSessions,
  setSessionCookie,
  clearSessionCookie,
  loadSession,
  requireClientApi,
  loginRateLimited,
  clearLoginAttempts,
};
