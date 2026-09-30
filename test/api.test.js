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
  const ok = await post('/api/inquiries', {
    name: 'Sam', email: 'sam@example.com', plan: 'Weekly', residence: 'Maple Hall', bedrooms: '2', bathrooms: '1.5',
  });
  assert.equal(ok.status, 201);
  const row = db.prepare('SELECT * FROM inquiries WHERE email = ?').get('sam@example.com');
  assert.equal(row.plan, 'Weekly');
  assert.equal(row.residence, 'Maple Hall');
  assert.equal(row.bedrooms, '2');
  assert.equal(row.bathrooms, '1.5');

  // Values outside the dropdown options are ignored rather than stored.
  await post('/api/inquiries', { name: 'Kim', email: 'kim@example.com', bedrooms: '99', bathrooms: '<b>' });
  const odd = db.prepare('SELECT * FROM inquiries WHERE email = ?').get('kim@example.com');
  assert.equal(odd.bedrooms, null);
  assert.equal(odd.bathrooms, null);
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
      { name: 'Jamie <b>Lee</b>', email: 'jamie@example.com', plan: 'Monthly', bedrooms: '3', bathrooms: '2', message: 'Hi there' });
    assert.equal(res.status, 201);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['info@example.com']);
    assert.equal(sent[0].reply_to, 'jamie@example.com');
    assert.match(sent[0].subject, /Jamie <b>Lee<\/b> \(Monthly\)/);
    assert.ok(sent[0].html.includes('Jamie &lt;b&gt;Lee&lt;/b&gt;'));
    assert.ok(!sent[0].html.includes('<b>Lee</b>'));
    assert.match(sent[0].text, /Bedrooms: 3/);
    assert.match(sent[0].text, /Bathrooms: 2/);
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

test('invoices: owner sends, client pays through Stripe, others cannot see or pay', async () => {
  const crypto = require('node:crypto');
  process.env.ADMIN_EMAIL = 'owner@example.com';
  process.env.ADMIN_PASSWORD = 'owner-secret-1';
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

  const realFetch = global.fetch;
  const stripeCalls = [];
  const sessions = {};
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (!u.startsWith('https://api.stripe.com')) return realFetch(url, opts);
    stripeCalls.push({ url: u, method: opts.method, body: opts.body ? new URLSearchParams(opts.body) : null });
    if (opts.method === 'POST' && u.endsWith('/checkout/sessions')) {
      const body = new URLSearchParams(opts.body);
      const id = `cs_test_${Object.keys(sessions).length + 1}`;
      sessions[id] = {
        id, status: 'open', payment_status: 'unpaid', url: `https://checkout.stripe.com/c/pay/${id}`,
        amount_total: Number(body.get('line_items[0][price_data][unit_amount]')) + Number(body.get('line_items[1][price_data][unit_amount]') || 0),
        metadata: { invoice_number: body.get('metadata[invoice_number]') },
      };
      return new Response(JSON.stringify(sessions[id]), { status: 200 });
    }
    const id = decodeURIComponent(u.split('/checkout/sessions/')[1].split('?')[0]);
    return new Response(JSON.stringify(sessions[id]), { status: sessions[id] ? 200 : 404 });
  };

  try {
    const adminLogin = await post('/api/admin/login', { email: 'owner@example.com', password: 'owner-secret-1' });
    const admin = adminLogin.headers.get('set-cookie').split(';')[0];
    const aliceId = db.prepare("SELECT id FROM clients WHERE email = 'alice@example.com'").get().id;

    // Validation
    assert.equal((await post('/api/admin/invoices', { clientId: aliceId, items: [] }, { cookie: admin })).status, 400);
    assert.equal((await post('/api/admin/invoices', { clientId: aliceId, items: [{ description: 'X', amount: '0.20' }] }, { cookie: admin })).status, 400);
    const oneItem = [{ description: 'Clean', amount: '50' }];
    assert.equal((await post('/api/admin/invoices', { clientId: aliceId, items: oneItem, serviceDate: '2026-10-12', serviceTime: '25:00' }, { cookie: admin })).status, 400);
    assert.equal((await post('/api/admin/invoices', { clientId: aliceId, items: oneItem, serviceTime: '10:00' }, { cookie: admin })).status, 400);

    const created = await post('/api/admin/invoices', {
      clientId: aliceId, dueDate: '2026-10-15', serviceDate: '2026-10-12', serviceTime: '14:30', notes: 'Thanks!', sendEmail: false,
      items: [{ description: 'Bi-Weekly cleaning (October)', amount: '98' }, { description: 'Shared bathroom add-on', amount: '20.50' }],
    }, { cookie: admin });
    assert.equal(created.status, 201);
    const { invoiceNumber } = await created.json();

    const { cookie: alice } = await login('alice@example.com', 'alicepass1');
    const { cookie: bob } = await login('bob@example.com', 'newpass123');

    const list = await (await fetch(`${base}/api/invoices`, { headers: { cookie: alice } })).json();
    const inv = list.invoices.find((i) => i.invoice_number === invoiceNumber);
    assert.equal(inv.amount_cents, 11850);
    assert.equal(inv.service_date, '2026-10-12');
    assert.equal(inv.service_time, '14:30');
    assert.equal(inv.items.length, 2);
    assert.equal(list.payments, true);

    // Bob can't see or pay Alice's invoice.
    const bobList = await (await fetch(`${base}/api/invoices`, { headers: { cookie: bob } })).json();
    assert.ok(!bobList.invoices.some((i) => i.invoice_number === invoiceNumber));
    assert.equal((await post(`/api/invoices/${invoiceNumber}/pay`, {}, { cookie: bob })).status, 404);

    // Alice starts checkout: amounts come from the server, not the browser.
    const pay = await post(`/api/invoices/${invoiceNumber}/pay`, {}, { cookie: alice });
    assert.equal(pay.status, 200);
    const { url } = await pay.json();
    assert.match(url, /^https:\/\/checkout\.stripe\.com\//);
    const createCall = stripeCalls.find((c) => c.method === 'POST');
    assert.equal(createCall.body.get('line_items[0][price_data][unit_amount]'), '9800');
    assert.equal(createCall.body.get('line_items[1][price_data][unit_amount]'), '2050');
    assert.equal(createCall.body.get('line_items[0][price_data][currency]'), 'cad');
    assert.equal(createCall.body.get('customer_email'), 'alice@example.com');
    assert.match(createCall.body.get('success_url'), /\/portal\?paid=\{CHECKOUT_SESSION_ID\}$/);

    // Clicking Pay again reuses the same open checkout instead of creating another.
    const again = await (await post(`/api/invoices/${invoiceNumber}/pay`, {}, { cookie: alice })).json();
    assert.equal(again.url, url);
    assert.equal(stripeCalls.filter((c) => c.method === 'POST').length, 1);

    // Unpaid session doesn't mark it paid.
    const sessionId = Object.keys(sessions)[0];
    const early = await (await post('/api/invoices/confirm', { sessionId }, { cookie: alice })).json();
    assert.equal(early.paid, false);

    // Stripe webhook with a bad signature is rejected.
    sessions[sessionId] = { ...sessions[sessionId], status: 'complete', payment_status: 'paid', payment_intent: 'pi_123' };
    const event = JSON.stringify({ type: 'checkout.session.completed', data: { object: sessions[sessionId] } });
    const bad = await fetch(`${base}/api/stripe/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${Math.floor(Date.now() / 1000)},v1=deadbeef` }, body: event,
    });
    assert.equal(bad.status, 400);

    // Valid signed webhook marks the invoice paid.
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', 'whsec_test').update(`${t}.${event}`).digest('hex');
    const good = await fetch(`${base}/api/stripe/webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${t},v1=${sig}` }, body: event,
    });
    assert.equal(good.status, 200);
    const paidRow = db.prepare('SELECT * FROM invoices WHERE invoice_number = ?').get(invoiceNumber);
    assert.equal(paidRow.status, 'paid');
    assert.equal(paidRow.paid_method, 'stripe');
    assert.equal(paidRow.stripe_payment_intent, 'pi_123');

    // Confirm after the webhook is harmless, and paying again is refused.
    const confirmed = await (await post('/api/invoices/confirm', { sessionId }, { cookie: alice })).json();
    assert.equal(confirmed.status, 'paid');
    assert.equal((await post(`/api/invoices/${invoiceNumber}/pay`, {}, { cookie: alice })).status, 409);

    // Manual payment + void.
    const second = await (await post('/api/admin/invoices', {
      clientId: aliceId, sendEmail: false, items: [{ description: 'Move-out clean', amount: '129' }],
    }, { cookie: admin })).json();
    const secondId = db.prepare('SELECT id FROM invoices WHERE invoice_number = ?').get(second.invoiceNumber).id;
    assert.equal((await post(`/api/admin/invoices/${secondId}/void`, {}, { cookie: admin })).status, 200);
    assert.equal((await post(`/api/invoices/${second.invoiceNumber}/pay`, {}, { cookie: alice })).status, 404);
    assert.equal((await post(`/api/admin/invoices/${secondId}/mark-paid`, {}, { cookie: admin })).status, 409);

    const third = await (await post('/api/admin/invoices', {
      clientId: aliceId, sendEmail: false, items: [{ description: 'Deep clean', amount: '75' }],
    }, { cookie: admin })).json();
    const thirdId = db.prepare('SELECT id FROM invoices WHERE invoice_number = ?').get(third.invoiceNumber).id;
    assert.equal((await post(`/api/admin/invoices/${thirdId}/mark-paid`, { method: 'e-transfer' }, { cookie: admin })).status, 200);
    assert.equal(db.prepare('SELECT paid_method FROM invoices WHERE id = ?').get(thirdId).paid_method, 'e-transfer');

    // Clients with invoices can't be deleted (financial records are kept).
    assert.equal((await fetch(`${base}/api/admin/clients/${aliceId}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json', cookie: admin }, body: '{}',
    })).status, 409);
  } finally {
    global.fetch = realFetch;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  }
});

test('owner can decline a quote request and the customer is emailed the reason', async () => {
  process.env.ADMIN_EMAIL = 'owner@example.com';
  process.env.ADMIN_PASSWORD = 'owner-secret-1';
  const adminLogin = await post('/api/admin/login', { email: 'owner@example.com', password: 'owner-secret-1' });
  const cookie = adminLogin.headers.get('set-cookie').split(';')[0];

  await post('/api/inquiries', { name: 'Pat Doe', email: 'pat@example.com', plan: 'Weekly' });
  const { id } = db.prepare("SELECT id FROM inquiries WHERE email = 'pat@example.com'").get();

  // A reason is required when emailing.
  assert.equal((await post(`/api/admin/inquiries/${id}/decline`, { reason: '' }, { cookie })).status, 400);

  const realFetch = global.fetch;
  const sent = [];
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.resend.com')) {
      sent.push(JSON.parse(opts.body));
      return new Response('{"id":"x"}', { status: 200 });
    }
    return realFetch(url, opts);
  };
  process.env.RESEND_API_KEY = 're_test';
  try {
    const res = await post(`/api/admin/inquiries/${id}/decline`, { reason: 'Fully booked <that week>.' }, { cookie });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).email, 'sent');
    assert.deepEqual(sent[0].to, ['pat@example.com']);
    assert.match(sent[0].text, /Fully booked <that week>\./);
    assert.ok(sent[0].html.includes('Fully booked &lt;that week&gt;.'));
  } finally {
    global.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  }

  const row = db.prepare('SELECT declined_at, decline_reason FROM inquiries WHERE id = ?').get(id);
  assert.ok(row.declined_at);
  assert.equal(row.decline_reason, 'Fully booked <that week>.');
  // Can't decline twice, and not without an admin session.
  assert.equal((await post(`/api/admin/inquiries/${id}/decline`, { reason: 'x' }, { cookie })).status, 409);
  assert.equal((await post(`/api/admin/inquiries/${id}/decline`, { reason: 'x' })).status, 401);
});

test('owner can add, edit and delete cleaners with their services and costs', async () => {
  process.env.ADMIN_EMAIL = 'owner@example.com';
  process.env.ADMIN_PASSWORD = 'owner-secret-1';
  const adminLogin = await post('/api/admin/login', { email: 'owner@example.com', password: 'owner-secret-1' });
  const cookie = adminLogin.headers.get('set-cookie').split(';')[0];
  const put = (url, body) => fetch(base + url, { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });

  assert.equal((await post('/api/admin/cleaners', { name: '' }, { cookie })).status, 400);
  assert.equal((await post('/api/admin/cleaners', { name: 'X', services: [{ service: 'Studio', cost: '' }] }, { cookie })).status, 400);
  assert.equal((await post('/api/admin/cleaners', { name: 'X', email: 'nope' }, { cookie })).status, 400);

  const created = await post('/api/admin/cleaners', {
    name: 'Maria Lopez', company: 'Sparkle Crew', phone: '305-555-0101', email: 'Maria@Example.com', area: 'Miami',
    services: [{ service: 'Studio Standard Clean', cost: '70' }, { service: 'Deep clean', cost: '35', unit: 'hour' }],
  }, { cookie });
  assert.equal(created.status, 201);
  const { id } = await created.json();

  let { cleaners } = await (await fetch(`${base}/api/admin/overview`, { headers: { cookie } })).json();
  let maria = cleaners.find((c) => c.id === id);
  assert.equal(maria.email, 'maria@example.com');
  assert.equal(maria.active, true);
  assert.deepEqual(maria.services, [
    { service: 'Studio Standard Clean', cost_cents: 7000, unit: 'clean' },
    { service: 'Deep clean', cost_cents: 3500, unit: 'hour' },
  ]);

  const edited = await put(`/api/admin/cleaners/${id}`, {
    name: 'Maria Lopez', active: false, services: [{ service: '1 Bedroom / 1 Bathroom Standard Clean', cost: '90.50' }],
  });
  assert.equal(edited.status, 200);
  ({ cleaners } = await (await fetch(`${base}/api/admin/overview`, { headers: { cookie } })).json());
  maria = cleaners.find((c) => c.id === id);
  assert.equal(maria.active, false);
  assert.equal(maria.company, null);
  assert.deepEqual(maria.services, [{ service: '1 Bedroom / 1 Bathroom Standard Clean', cost_cents: 9050, unit: 'clean' }]);

  // Clients can't see or manage cleaners.
  const { cookie: clientCookie } = await login('alice@example.com', 'alicepass1');
  assert.equal((await post('/api/admin/cleaners', { name: 'Y' }, { cookie: clientCookie })).status, 401);

  const del = await fetch(`${base}/api/admin/cleaners/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', cookie }, body: '{}' });
  assert.equal(del.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cleaner_services WHERE cleaner_id = ?').get(id).n, 0);
});
