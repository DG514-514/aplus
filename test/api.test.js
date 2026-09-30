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

test('admin area requires owner credentials and can manage clients and orders', async () => {
  process.env.ADMIN_EMAIL = 'owner@example.com';
  process.env.ADMIN_PASSWORD = 'owner-secret-1';

  const denied = await fetch(`${base}/api/admin/overview`);
  assert.equal(denied.status, 401);
  assert.equal((await post('/api/admin/login', { email: 'owner@example.com', password: 'wrong' })).status, 401);

  // A client session must not grant admin access.
  const { cookie: clientCookie } = await login('alice@example.com', 'alicepass1');
  assert.equal((await fetch(`${base}/api/admin/overview`, { headers: { cookie: clientCookie } })).status, 401);

  const res = await post('/api/admin/login', { email: 'Owner@Example.com', password: 'owner-secret-1' });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];

  const created = await post('/api/admin/clients',
    { name: 'Casey New', email: 'casey@example.com', password: 'temp-pass-1', residence: 'Oak Hall', room: '5' }, { cookie });
  assert.equal(created.status, 201);
  const { id } = await created.json();

  const order = await post('/api/admin/orders',
    { clientId: id, date: '2026-11-01', service: 'Dorm Room Clean', plan: 'Weekly', amount: '39.50', status: 'scheduled' }, { cookie });
  assert.equal(order.status, 201);

  const overview = await (await fetch(`${base}/api/admin/overview`, { headers: { cookie } })).json();
  const casey = overview.orders.find((o) => o.client_id === id);
  assert.equal(casey.amount_cents, 3950);
  assert.equal(casey.location, 'Oak Hall, Rm 5');

  const patched = await fetch(`${base}/api/admin/orders/${casey.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ status: 'completed' }),
  });
  assert.equal(patched.status, 200);

  // New client can sign in and sees the order.
  const { cookie: caseyCookie } = await login('casey@example.com', 'temp-pass-1');
  const { orders } = await (await fetch(`${base}/api/orders`, { headers: { cookie: caseyCookie } })).json();
  assert.deepEqual(orders.map((o) => o.status), ['completed']);
});

test('quote requests trigger an email alert when email is configured', async () => {
  const realFetch = global.fetch;
  const sent = [];
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.resend.com')) {
      sent.push(JSON.parse(opts.body));
      return new Response('{"id":"test"}', { status: 200 });
    }
    return realFetch(url, opts);
  };
  process.env.RESEND_API_KEY = 're_test';
  process.env.NOTIFY_EMAIL = 'info@example.com';
  try {
    const res = await post('/api/inquiries',
      { name: 'Jamie <b>Lee</b>', email: 'jamie@example.com', plan: 'Monthly', message: 'Hi there' });
    assert.equal(res.status, 201);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['info@example.com']);
    assert.equal(sent[0].reply_to, 'jamie@example.com');
    assert.match(sent[0].subject, /Jamie <b>Lee<\/b> \(Monthly\)/);
    assert.ok(sent[0].html.includes('Jamie &lt;b&gt;Lee&lt;/b&gt;'));
    assert.ok(!sent[0].html.includes('<b>Lee</b>'));
  } finally {
    global.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.NOTIFY_EMAIL;
  }
});

test('owner can check email setup and gets a plain-English reason when Resend refuses', async () => {
  process.env.ADMIN_EMAIL = 'owner@example.com';
  process.env.ADMIN_PASSWORD = 'owner-secret-1';
  const loginRes = await post('/api/admin/login', { email: 'owner@example.com', password: 'owner-secret-1' });
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];

  const noKey = await post('/api/admin/email-test', {}, { cookie });
  assert.equal(noKey.status, 502);
  assert.match((await noKey.json()).error, /RESEND_API_KEY is not set/);

  const status = await (await fetch(`${base}/api/admin/email-status`, { headers: { cookie } })).json();
  assert.equal(status.keySet, false);
  assert.deepEqual(status.to, ['info@aplus-cleaning-solutions.com']);
  assert.equal(status.last.ok, false);

  const realFetch = global.fetch;
  global.fetch = async (url, opts) => (String(url).startsWith('https://api.resend.com')
    ? new Response('{"statusCode":403,"message":"You can only send testing emails to your own email address (owner@gmail.com)."}', { status: 403 })
    : realFetch(url, opts));
  process.env.RESEND_API_KEY = 're_test';
  try {
    const refused = await post('/api/admin/email-test', {}, { cookie });
    assert.equal(refused.status, 502);
    assert.match((await refused.json()).error, /only deliver to the email address your Resend account was created with/);
  } finally {
    global.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  }

  // Not available without an admin session.
  assert.equal((await post('/api/admin/email-test', {})).status, 401);
});
