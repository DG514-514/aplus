'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'aplus.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS clients (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    phone         TEXT,
    residence     TEXT,
    room          TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id    INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    order_number TEXT NOT NULL UNIQUE,
    service_date TEXT NOT NULL,
    service_type TEXT NOT NULL,
    plan         TEXT NOT NULL,
    location     TEXT,
    status       TEXT NOT NULL DEFAULT 'scheduled'
                 CHECK (status IN ('scheduled', 'completed', 'cancelled')),
    amount_cents INTEGER NOT NULL DEFAULT 0,
    notes        TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id, service_date);

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inquiries (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    phone      TEXT,
    residence  TEXT,
    plan       TEXT,
    message    TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number        TEXT NOT NULL UNIQUE,
    client_id             INTEGER NOT NULL REFERENCES clients(id),
    status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'void')),
    amount_cents          INTEGER NOT NULL,
    due_date              TEXT,
    notes                 TEXT,
    inquiry_id            INTEGER,
    stripe_session_id     TEXT,
    stripe_payment_intent TEXT,
    receipt_url           TEXT,
    paid_method           TEXT,
    paid_at               TEXT,
    created_at            TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id, created_at);

  CREATE TABLE IF NOT EXISTS invoice_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id   INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description  TEXT NOT NULL,
    amount_cents INTEGER NOT NULL
  );
`);

// Columns added after launch: add them to existing databases.
const hasColumn = (table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
if (!hasColumn('inquiries', 'invoice_number')) db.exec('ALTER TABLE inquiries ADD COLUMN invoice_number TEXT');
if (!hasColumn('inquiries', 'bedrooms')) db.exec('ALTER TABLE inquiries ADD COLUMN bedrooms TEXT');
if (!hasColumn('inquiries', 'bathrooms')) db.exec('ALTER TABLE inquiries ADD COLUMN bathrooms TEXT');
if (!hasColumn('invoices', 'service_date')) db.exec('ALTER TABLE invoices ADD COLUMN service_date TEXT');
if (!hasColumn('invoices', 'service_time')) db.exec('ALTER TABLE invoices ADD COLUMN service_time TEXT');

// Order numbers follow the autoincrement sequence, so they are never reused even after deletes.
db.nextOrderNumber = () => {
  const row = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'orders'").get();
  return `AP-${10001 + (row ? row.seq : 0)}`;
};

db.nextInvoiceNumber = () => {
  const row = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'invoices'").get();
  return `INV-${1001 + (row ? row.seq : 0)}`;
};

module.exports = db;
