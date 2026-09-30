#!/usr/bin/env node
'use strict';

// Admin CLI for managing client accounts, orders and website inquiries.
// Run `npm run manage -- help` for usage.

const { parseArgs } = require('node:util');
const db = require('../src/db');
const { hashPassword } = require('../src/auth');

const STATUSES = ['scheduled', 'completed', 'cancelled'];

const USAGE = `
A+ Cleaning Solutions — admin CLI

  npm run manage -- <command> [options]

Clients
  add-client      --email --name --password [--phone --residence --room]
  reset-password  --email --password
  list-clients

Orders
  add-order       --email --date YYYY-MM-DD --service "Dorm Deep Clean" --plan Weekly
                  --amount 49.00 [--status scheduled|completed|cancelled]
                  [--location "Maple Hall, Rm 214"] [--notes "..."]
  set-status      --order AP-10001 --status completed
  list-orders     [--email]

Leads
  inquiries       Show booking / quote requests submitted from the website
`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    password: { type: 'string' },
    phone: { type: 'string' },
    residence: { type: 'string' },
    room: { type: 'string' },
    date: { type: 'string' },
    service: { type: 'string' },
    plan: { type: 'string' },
    amount: { type: 'string' },
    status: { type: 'string' },
    location: { type: 'string' },
    notes: { type: 'string' },
    order: { type: 'string' },
  },
});

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function need(...keys) {
  const missing = keys.filter((k) => !values[k]);
  if (missing.length) fail(`missing ${missing.map((k) => `--${k}`).join(', ')}`);
}

function findClient(email) {
  const client = db.prepare('SELECT * FROM clients WHERE email = ?').get(email);
  if (!client) fail(`no client with email ${email}`);
  return client;
}

const commands = {
  'add-client'() {
    need('email', 'name', 'password');
    if (values.password.length < 8) fail('password must be at least 8 characters');
    const result = db.prepare(`
      INSERT INTO clients (email, name, password_hash, phone, residence, room)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(values.email.toLowerCase(), values.name, hashPassword(values.password),
      values.phone ?? null, values.residence ?? null, values.room ?? null);
    console.log(`Created client #${result.lastInsertRowid} (${values.email})`);
  },

  'reset-password'() {
    need('email', 'password');
    if (values.password.length < 8) fail('password must be at least 8 characters');
    const client = findClient(values.email);
    db.prepare('UPDATE clients SET password_hash = ? WHERE id = ?').run(hashPassword(values.password), client.id);
    db.prepare('DELETE FROM sessions WHERE client_id = ?').run(client.id);
    console.log(`Password reset for ${client.email}; existing sessions signed out.`);
  },

  'list-clients'() {
    console.table(db.prepare(`
      SELECT c.id, c.email, c.name, c.residence, c.room,
             (SELECT COUNT(*) FROM orders o WHERE o.client_id = c.id) AS orders
      FROM clients c ORDER BY c.id
    `).all());
  },

  'add-order'() {
    need('email', 'date', 'service', 'plan', 'amount');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) fail('--date must be YYYY-MM-DD');
    const status = values.status || 'scheduled';
    if (!STATUSES.includes(status)) fail(`--status must be one of ${STATUSES.join(', ')}`);
    const amount = Number(values.amount);
    if (!Number.isFinite(amount) || amount < 0) fail('--amount must be a positive number');

    const client = findClient(values.email);
    const orderNumber = db.nextOrderNumber();
    const location = values.location
      ?? ([client.residence, client.room && `Rm ${client.room}`].filter(Boolean).join(', ') || null);
    db.prepare(`
      INSERT INTO orders (client_id, order_number, service_date, service_type, plan, location, status, amount_cents, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(client.id, orderNumber, values.date, values.service, values.plan, location,
      status, Math.round(amount * 100), values.notes ?? null);
    console.log(`Added order ${orderNumber} for ${client.email}`);
  },

  'set-status'() {
    need('order', 'status');
    if (!STATUSES.includes(values.status)) fail(`--status must be one of ${STATUSES.join(', ')}`);
    const result = db.prepare('UPDATE orders SET status = ? WHERE order_number = ?').run(values.status, values.order);
    if (!result.changes) fail(`no order ${values.order}`);
    console.log(`Order ${values.order} marked ${values.status}`);
  },

  'list-orders'() {
    const rows = values.email
      ? db.prepare(`
          SELECT o.order_number, o.service_date, o.service_type, o.plan, o.status, o.amount_cents / 100.0 AS amount
          FROM orders o WHERE o.client_id = ? ORDER BY o.service_date DESC
        `).all(findClient(values.email).id)
      : db.prepare(`
          SELECT o.order_number, c.email, o.service_date, o.service_type, o.plan, o.status, o.amount_cents / 100.0 AS amount
          FROM orders o JOIN clients c ON c.id = o.client_id ORDER BY o.service_date DESC
        `).all();
    console.table(rows);
  },

  inquiries() {
    console.table(db.prepare('SELECT * FROM inquiries ORDER BY id DESC').all());
  },

  help() {
    console.log(USAGE);
  },
};

const command = commands[positionals[0] || 'help'];
if (!command) {
  console.log(USAGE);
  process.exit(1);
}
try {
  command();
} catch (err) {
  if (String(err.message).includes('UNIQUE constraint failed: clients.email')) fail('a client with that email already exists');
  fail(err.message);
}
