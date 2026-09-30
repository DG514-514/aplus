'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aplus-test-'));
process.env.DB_PATH = path.join(tmp, 'test.db');

const db = require('../src/db');
const { hashPassword } = require('../src/auth');
const app = require('../src/server');

let server;
let base;

function addClient(email, password, name) {
  return db.prepare('INSERT INTO clients (email, name, password_hash) VALUES (?, ?, ?)')
    .run(email, name, hashPassword(password)).lastInsertRowid;
}
function addOrder(clientId, date, status = 'completed') {
  db.prepare(`INSERT INTO orders (client_id, order_number, service_date, service_type, plan, status, amount_cents)
              VALUES (?, ?, ?, 'Dorm Room Clean', 'Weekly', ?, 4900)`)
    .run(clientId, db.nextOrderNumber(), date, status);
}

const post = (url, body, headers = {}) => fetch(base + url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
  redirect: 'manual',
});

async function login(email, password) {
  const res = await post('/api/login', { email, password });
  const cookie = res.headers.get('set-cookie');
  return { res, cookie: cookie && cookie.split(';')[0] };
}

test.before(async () => {
  const alice = addClient('alice@example.com', 'alicepass1', 'Alice Adams');
  const bob = addClient('bob@example.com', 'bobpass123', 'Bob Brown');
  addOrder(alice, '2026-01-10');
  addOrder(alice, '2026-02-10', 'scheduled');
  addOrder(bob, '2026-01-15');
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('rejects wrong password and unknown email with the same message', async () => {
  const wrong = await login('alice@example.com', 'nope-nope');
  const unknown = await login('nobody@example.com', 'whatever1');
  assert.equal(wrong.res.status, 401);
  assert.equal(unknown.res.status, 401);
  assert.deepEqual(await wrong.res.json(), await unknown.res.json());
});

test('orders require a session', async () => {
  const res = await fetch(`${base}/api/orders`);
  assert.equal(res.status, 401);
});

test('portal redirects anonymous visitors to login', async () => {
  const res = await fetch(`${base}/portal`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
});

test('client only sees their own orders, newest first', async () => {
  const { res, cookie } = await login('ALICE@example.com', 'alicepass1');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /HttpOnly/i);

  const orders = await (await fetch(`${base}/api/orders`, { headers: { cookie } })).json();
  assert.equal(orders.orders.length, 2);
  assert.deepEqual(orders.orders.map((o) => o.service_date), ['2026-02-10', '2026-01-10']);

  const me = await (await fetch(`${base}/api/me`, { headers: { cookie } })).json();
  assert.equal(me.client.email, 'alice@example.com');
  assert.equal(me.client.password_hash, undefined);

  const portal = await fetch(`${base}/portal`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(portal.status, 200);
});

test('logout ends the session', async () => {
  const { cookie } = await login('bob@example.com', 'bobpass123');
  await post('/api/logout', {}, { cookie });
  const res = await fetch(`${base}/api/orders`, { headers: { cookie } });
  assert.equal(res.status, 401);
});

test('password change requires the current password', async () => {
  const { cookie } = await login('bob@example.com', 'bobpass123');
  const bad = await post('/api/password', { currentPassword: 'wrong', newPassword: 'newpass123' }, { cookie });
  assert.equal(bad.status, 400);
  const ok = await post('/api/password', { currentPassword: 'bobpass123', newPassword: 'newpass123' }, { cookie });
  assert.equal(ok.status, 200);
  assert.equal((await login('bob@example.com', 'newpass123')).res.status, 200);
});

test('non-JSON POSTs are rejected (CSRF guard)', async () => {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'email=alice@example.com&password=alicepass1',
  });
  assert.equal(res.status, 415);
});

test('inquiry form stores valid leads and validates email', async () => {
  const bad = await post('/api/inquiries', { name: 'Sam', email: 'not-an-email' });
  assert.equal(bad.status, 400);
  const ok = await post('/api/inquiries', { name: 'Sam', email: 'sam@example.com', plan: 'Weekly' });
  assert.equal(ok.status, 201);
  const row = db.prepare('SELECT * FROM inquiries WHERE email = ?').get('sam@example.com');
  assert.equal(row.plan, 'Weekly');
});
