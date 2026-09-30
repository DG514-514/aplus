#!/usr/bin/env node
'use strict';

// Creates a demo client with sample order history so the portal can be previewed.
//   Email:    demo@aplus-cleaning-solutions.com
//   Password: CleanDorm2026

const db = require('../src/db');
const { hashPassword } = require('../src/auth');

const DEMO_EMAIL = 'demo@aplus-cleaning-solutions.com';
const DEMO_PASSWORD = 'CleanDorm2026';

db.prepare('DELETE FROM clients WHERE email = ?').run(DEMO_EMAIL);

const { lastInsertRowid: clientId } = db.prepare(`
  INSERT INTO clients (email, name, password_hash, phone, residence, room)
  VALUES (?, ?, ?, ?, ?, ?)
`).run(DEMO_EMAIL, 'Jordan Taylor', hashPassword(DEMO_PASSWORD), '(555) 555-0142', 'Maple Hall', '214');

const addDays = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const location = 'Maple Hall, Rm 214';
const orders = [
  [21, 'Dorm Room Clean', 'Bi-Weekly', 'scheduled', 4900, null],
  [7, 'Dorm Room Clean', 'Bi-Weekly', 'scheduled', 4900, null],
  [-7, 'Dorm Room Clean', 'Bi-Weekly', 'completed', 4900, 'Desk and window sills wiped; floors vacuumed and mopped.'],
  [-21, 'Dorm Room + Shared Bathroom', 'Bi-Weekly', 'completed', 6900, 'Added shared bathroom at client request.'],
  [-35, 'Dorm Room Clean', 'Bi-Weekly', 'completed', 4900, null],
  [-42, 'Dorm Room Clean', 'Bi-Weekly', 'cancelled', 0, 'Cancelled by client — reading week.'],
  [-49, 'Move-In Deep Clean', 'One-Time', 'completed', 12900, 'Full deep clean before move-in, including mattress vacuum and closet wipe-down.'],
];

const insert = db.prepare(`
  INSERT INTO orders (client_id, order_number, service_date, service_type, plan, location, status, amount_cents, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
orders
  .slice()
  .reverse()
  .forEach(([offset, service, plan, status, cents, notes]) => {
    insert.run(clientId, db.nextOrderNumber(), addDays(offset), service, plan, location, status, cents, notes);
  });

console.log('Demo client ready:');
console.log(`  Email:    ${DEMO_EMAIL}`);
console.log(`  Password: ${DEMO_PASSWORD}`);
