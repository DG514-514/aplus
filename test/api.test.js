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

// Signs a client in and (like a real first sign-in) agrees to the Terms & Conditions.
async function login(email, password, { acceptTerms = true } = {}) {
  const res = await post('/api/login', { email, password });
  const raw = res.headers.get('set-cookie');
  const cookie = raw && raw.split(';')[0];
  if (cookie && acceptTerms) {
    const { terms } = await (await fetch(`${base}/api/me`, { headers: { cookie } })).json();
    if (!terms.accepted) {
      const { version } = await (await fetch(`${base}/api/terms`)).json();
      await post('/api/terms/accept', { signedName: email, agree: true, version }, { cookie });
    }
  }
  return { res, cookie };
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
    requestedDate: '2026-11-20', requestedTime: '14:30',
  });
  assert.equal(ok.status, 201);
  const row = db.prepare('SELECT * FROM inquiries WHERE email = ?').get('sam@example.com');
  assert.equal(row.plan, 'Weekly');
  assert.equal(row.residence, 'Maple Hall');
  assert.equal(row.bedrooms, '2');
  assert.equal(row.bathrooms, '1.5');
  assert.equal(row.requested_date, '2026-11-20');
  assert.equal(row.requested_time, '14:30');

  // Values outside the dropdown options are ignored rather than stored.
  await post('/api/inquiries', { name: 'Kim', email: 'kim@example.com', bedrooms: '99', bathrooms: '<b>', requestedDate: '2026-02-31', requestedTime: '25:00' });
  const odd = db.prepare('SELECT * FROM inquiries WHERE email = ?').get('kim@example.com');
  assert.equal(odd.bedrooms, null);
  assert.equal(odd.bathrooms, null);
  assert.equal(odd.requested_date, null);
  assert.equal(odd.requested_time, null);
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
      { name: 'Jamie <b>Lee</b>', email: 'jamie@example.com', plan: 'Monthly', bedrooms: '3', bathrooms: '2', message: 'Hi there', requestedDate: '2026-10-16', requestedTime: '09:00' });
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
    assert.match(sent[0].text, /Requested date: Friday, Oct 16, 2026/);
    assert.match(sent[0].text, /Requested time: 9:00 AM/);
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
    assert.equal(createCall.body.get('line_items[0][price_data][currency]'), 'usd');
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

test('push notifications: owner and client devices subscribe and get the right alerts', async () => {
  const push = require('../src/push');
  const sent = [];
  push.setSender(async (subscription, payload) => {
    if (subscription.endpoint.includes('gone')) { const e = new Error('gone'); e.statusCode = 410; throw e; }
    sent.push({ endpoint: subscription.endpoint, ...JSON.parse(payload) });
  });
  process.env.ADMIN_EMAIL = 'owner@example.com';
  process.env.ADMIN_PASSWORD = 'owner-secret-1';
  const adminLogin = await post('/api/admin/login', { email: 'owner@example.com', password: 'owner-secret-1' });
  const admin = adminLogin.headers.get('set-cookie').split(';')[0];
  const sub = (endpoint) => ({ subscription: { endpoint, keys: { p256dh: 'BPk', auth: 'au' } } });

  const { publicKey } = await (await fetch(`${base}/api/admin/push/key`, { headers: { cookie: admin } })).json();
  assert.match(publicKey, /^[A-Za-z0-9_-]{80,}$/);
  assert.equal((await fetch(`${base}/api/admin/push/key`)).status, 401);
  assert.equal((await post('/api/admin/push/subscribe', { subscription: { endpoint: 'http://insecure' } }, { cookie: admin })).status, 400);
  assert.equal((await post('/api/admin/push/subscribe', sub('https://push.example/owner-phone'), { cookie: admin })).status, 200);
  assert.equal((await post('/api/admin/push/subscribe', sub('https://push.example/gone-phone'), { cookie: admin })).status, 200);

  // Client device
  const { cookie: alice } = await login('alice@example.com', 'alicepass1');
  assert.equal((await post('/api/push/subscribe', sub('https://push.example/alice-phone'), { cookie: alice })).status, 200);
  assert.equal((await post('/api/push/subscribe', sub('https://push.example/x'))).status, 401);

  // New quote request → owner alerted; dead device cleaned up.
  await post('/api/inquiries', { name: 'Robin', email: 'robin@example.com', plan: 'Monthly' });
  await new Promise((r) => setTimeout(r, 50));
  const quoteAlert = sent.find((m) => m.title === 'New quote request');
  assert.equal(quoteAlert.endpoint, 'https://push.example/owner-phone');
  assert.match(quoteAlert.body, /Robin · Monthly/);
  assert.equal(quoteAlert.url, '/admin#inquiries');
  assert.ok(!sent.some((m) => m.endpoint.includes('alice')));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE endpoint LIKE '%gone%'").get().n, 0);

  // New invoice → only that client's device alerted.
  const aliceId = db.prepare("SELECT id FROM clients WHERE email = 'alice@example.com'").get().id;
  sent.length = 0;
  await post('/api/admin/invoices', { clientId: aliceId, sendEmail: false, items: [{ description: 'Clean', amount: '60' }] }, { cookie: admin });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].endpoint, 'https://push.example/alice-phone');
  assert.match(sent[0].body, /\$60\.00/);

  // Manual payment → owner alerted.
  sent.length = 0;
  const inv = db.prepare("SELECT id FROM invoices WHERE client_id = ? AND status = 'open' ORDER BY id DESC").get(aliceId);
  await post(`/api/admin/invoices/${inv.id}/mark-paid`, { method: 'cash' }, { cookie: admin });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(sent.some((m) => m.title.startsWith('Payment received') && m.endpoint.includes('owner-phone')));

  // Service worker and manifests are served for the app.
  const sw = await fetch(`${base}/sw.js`);
  assert.equal(sw.status, 200);
  assert.equal(sw.headers.get('cache-control'), 'no-cache');
  const manifest = await (await fetch(`${base}/manifest.webmanifest`)).json();
  assert.equal(manifest.start_url, '/app');
  // The client app opens the portal for signed-in clients and the website for everyone else.
  const visitor = await fetch(`${base}/app`, { redirect: 'manual' });
  assert.equal(visitor.headers.get('location'), '/');
  const member = await fetch(`${base}/app`, { redirect: 'manual', headers: { cookie: alice } });
  assert.equal(member.headers.get('location'), '/portal');
  const ownerManifest = await (await fetch(`${base}/admin.webmanifest`)).json();
  assert.equal(ownerManifest.start_url, '/admin?source=app');
});

test('terms & conditions: client must sign once before their account opens', async () => {
  const { hashPassword } = require('../src/auth');
  db.prepare('INSERT INTO clients (email, name, password_hash) VALUES (?, ?, ?)')
    .run('terry@example.com', 'Terry Nguyen', hashPassword('terrypass1'));
  const { cookie } = await login('terry@example.com', 'terrypass1', { acceptTerms: false });

  let me = await (await fetch(`${base}/api/me`, { headers: { cookie } })).json();
  assert.equal(me.terms.accepted, false);
  // Account data is locked until signed.
  const locked = await fetch(`${base}/api/orders`, { headers: { cookie } });
  assert.equal(locked.status, 403);
  assert.equal((await locked.json()).code, 'terms_required');
  assert.equal((await fetch(`${base}/api/invoices`, { headers: { cookie } })).status, 403);

  const t = await (await fetch(`${base}/api/terms`)).json();
  assert.equal(t.sections.length, 16);
  assert.equal(t.sections[0].heading, '1. Scope of Services');

  // Name and agreement are required; stale versions are refused.
  assert.equal((await post('/api/terms/accept', { signedName: '', agree: true, version: t.version }, { cookie })).status, 400);
  assert.equal((await post('/api/terms/accept', { signedName: 'Terry Nguyen', agree: false, version: t.version }, { cookie })).status, 400);
  assert.equal((await post('/api/terms/accept', { signedName: 'Terry Nguyen', agree: true, version: 'old' }, { cookie })).status, 409);
  assert.equal((await post('/api/terms/accept', { signedName: 'Terry Nguyen', agree: true, version: t.version })).status, 401);

  const ok = await post('/api/terms/accept', { signedName: '  Terry   Nguyen ', agree: true, version: t.version }, { cookie, 'User-Agent': 'TestPhone/1.0' });
  assert.equal(ok.status, 200);
  me = await (await fetch(`${base}/api/me`, { headers: { cookie } })).json();
  assert.equal(me.terms.accepted, true);
  assert.equal((await fetch(`${base}/api/orders`, { headers: { cookie } })).status, 200);

  // One time only: agreeing again (e.g. from another device) doesn't create a second record.
  await post('/api/terms/accept', { signedName: 'Terry Nguyen', agree: true, version: t.version }, { cookie });
  const rows = db.prepare("SELECT * FROM terms_acceptances WHERE client_email = 'terry@example.com'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].signed_name, 'Terry Nguyen');
  assert.equal(rows[0].user_agent, 'TestPhone/1.0');
  assert.match(rows[0].terms_text, /1\. Scope of Services/);
  assert.match(rows[0].terms_text, /16\. Acceptance of Terms/);
  assert.match(rows[0].terms_hash, /^[0-9a-f]{64}$/);

  // A later sign-in is not asked again.
  const { cookie: again } = await login('terry@example.com', 'terrypass1', { acceptTerms: false });
  me = await (await fetch(`${base}/api/me`, { headers: { cookie: again } })).json();
  assert.equal(me.terms.accepted, true);

  // Public copy of the terms.
  const pub = await fetch(`${base}/terms`);
  assert.equal(pub.status, 200);
  assert.match(await pub.text(), /16\. Acceptance of Terms/);

  // Owner can see who signed and open the signed copy; nobody else can.
  const recordUrl = `${base}/admin/agreements/${rows[0].id}`;
  const anon = await fetch(recordUrl, { redirect: 'manual' });
  assert.equal(anon.status, 302);
  assert.equal((await fetch(recordUrl, { redirect: 'manual', headers: { cookie } })).status, 302);

  const adminLogin = await post('/api/admin/login', { email: 'owner@example.com', password: 'owner-secret-1' });
  const admin = adminLogin.headers.get('set-cookie').split(';')[0];
  const { clients } = await (await fetch(`${base}/api/admin/overview`, { headers: { cookie: admin } })).json();
  const terry = clients.find((c) => c.email === 'terry@example.com');
  assert.equal(terry.terms_id, rows[0].id);
  assert.equal(terry.terms_signed_name, 'Terry Nguyen');
  assert.equal(terry.terms_current, 1);

  const { agreements } = await (await fetch(`${base}/api/admin/agreements`, { headers: { cookie: admin } })).json();
  assert.ok(agreements.some((a) => a.id === rows[0].id && a.signed_name === 'Terry Nguyen'));
  assert.equal((await fetch(`${base}/api/admin/agreements`, { headers: { cookie } })).status, 401);

  const record = await fetch(recordUrl, { headers: { cookie: admin } });
  assert.equal(record.status, 200);
  const html = await record.text();
  assert.match(html, /Terry Nguyen/);
  assert.match(html, /TestPhone\/1\.0/);
  assert.match(html, /16\. Acceptance of Terms/);
  assert.equal((await fetch(`${base}/admin/agreements/999999`, { headers: { cookie: admin } })).status, 404);
});

test('terms record page escapes what the client typed', async () => {
  const terms = require('../src/terms');
  const id = terms.accept({ id: 999, name: 'X', email: 'x@example.com' }, '<script>alert(1)</script>', { ip: '1.2.3.4', userAgent: '<b>' });
  const adminLogin = await post('/api/admin/login', { email: 'owner@example.com', password: 'owner-secret-1' });
  const admin = adminLogin.headers.get('set-cookie').split(';')[0];
  const html = await (await fetch(`${base}/admin/agreements/${id}`, { headers: { cookie: admin } })).text();
  assert.ok(!html.includes('<script>alert'));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('Ace assistant: owner-only, talks via Claude, saves notes and meeting summaries', async () => {
  const anon = await post('/api/admin/assistant/chat', { text: 'hi' });
  assert.equal(anon.status, 401);
  const page = await fetch(`${base}/ace`, { redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/admin?next=/ace');

  const adminLogin = await post('/api/admin/login', { email: 'owner@example.com', password: 'owner-secret-1' });
  const cookie = adminLogin.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${base}/ace`, { headers: { cookie } })).status, 200);

  // Without an API key the assistant reports it's off, but notes still work.
  delete process.env.ANTHROPIC_API_KEY;
  assert.deepEqual(await (await fetch(`${base}/api/admin/assistant/status`, { headers: { cookie } })).json(), { configured: false });
  assert.equal((await post('/api/admin/assistant/chat', { text: 'hi' }, { cookie })).status, 503);

  process.env.ANTHROPIC_API_KEY = 'test-key';
  const calls = [];
  const realFetch = global.fetch;
  const reply = (body) => new Response(JSON.stringify({
    id: `msg_${calls.length}`, type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    stop_details: null, usage: { input_tokens: 10, output_tokens: 10 }, ...body,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  global.fetch = async (url, opts = {}) => {
    if (!String(url).startsWith('https://api.anthropic.com')) return realFetch(url, opts);
    const body = JSON.parse(opts.body);
    calls.push({ body, headers: opts.headers });
    const last = body.messages[body.messages.length - 1];
    if (body.tools && typeof last.content === 'string' && /take a note/i.test(last.content)) {
      return reply({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name: 'save_note', input: { title: 'Call Casa Nuova', body: 'Confirm insurance certificates by Friday.' } }] });
    }
    if (Array.isArray(last.content) && last.content[0].type === 'tool_result') {
      return reply({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Got it, noted.' }] });
    }
    if (!body.tools) {
      return reply({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Summary:\n- Agreed to onboard Casa Nuova.\nAction items:\n- Owner sends agreement.' }] });
    }
    return reply({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'We made about $440 this month.' }] });
  };
  try {
    let res = await post('/api/admin/assistant/chat', { text: 'How are we doing this month?' }, { cookie });
    assert.equal(res.status, 200);
    const first = await res.json();
    assert.equal(first.reply, 'We made about $440 this month.');
    assert.ok(first.conversationId);
    const req = calls[0].body;
    assert.equal(req.model, 'claude-opus-5-5');
    assert.equal(req.fallbacks, 'default');
    assert.match(req.system[0].text, /You are Ace/);
    assert.deepEqual(req.cache_control, { type: 'ephemeral' });
    assert.match(req.messages[0].content, /<business_snapshot>[\s\S]*Studio Standard Clean: \$110[\s\S]*How are we doing this month\?$/);

    // Same conversation continues, appending to the history; asking for a note runs the save_note tool.
    res = await post('/api/admin/assistant/chat', { conversationId: first.conversationId, text: 'Take a note to call Casa Nuova' }, { cookie });
    const second = await res.json();
    assert.equal(second.reply, 'Got it, noted.');
    assert.equal(second.notes[0].title, 'Call Casa Nuova');
    const followUp = calls[calls.length - 1].body.messages;
    assert.equal(followUp[0].content, req.messages[0].content); // history re-sent unchanged (cache-friendly)
    // The snapshot isn't repeated when nothing changed.
    assert.equal(followUp[2].content, 'Take a note to call Casa Nuova');
    assert.equal(followUp[followUp.length - 1].content[0].type, 'tool_result');

    // Meeting mode sends the live transcript along with the question.
    await post('/api/admin/assistant/chat', { text: 'what did we decide?', meetingTranscript: '[0:05] we should onboard Casa Nuova' }, { cookie });
    assert.match(calls[calls.length - 1].body.messages[0].content, /Meeting mode[\s\S]*onboard Casa Nuova[\s\S]*what did we decide/);

    // End of meeting: summary saved as a meeting note with the transcript.
    res = await post('/api/admin/assistant/meeting/summary', { title: 'Casa Nuova kickoff', transcript: '[0:05] we should onboard Casa Nuova and send the agreement' }, { cookie });
    assert.equal(res.status, 200);
    const { note } = await res.json();
    assert.equal(note.kind, 'meeting');
    assert.match(note.body, /Agreed to onboard/);
    assert.equal((await post('/api/admin/assistant/meeting/summary', { transcript: '' }, { cookie })).status, 400);

    const { notes } = await (await fetch(`${base}/api/admin/assistant/notes`, { headers: { cookie } })).json();
    assert.deepEqual(notes.map((n) => n.title).slice(0, 2), ['Casa Nuova kickoff', 'Call Casa Nuova']);
    const { transcript } = await (await fetch(`${base}/api/admin/assistant/notes/${note.id}/transcript`, { headers: { cookie } })).json();
    assert.match(transcript, /send the agreement/);

    // Manual notes and deleting.
    res = await post('/api/admin/assistant/notes', { body: 'Order more microfiber cloths' }, { cookie });
    assert.equal(res.status, 201);
    const manual = (await res.json()).note;
    const del = await fetch(`${base}/api/admin/assistant/notes/${manual.id}`, { method: 'DELETE', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(del.status, 200);
  } finally {
    global.fetch = realFetch;
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('website sign-up: account waits for owner approval before the client can sign in', async () => {
  const sent = [];
  const realFetch = global.fetch;
  process.env.RESEND_API_KEY = 'test-resend';
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.resend.com')) {
      sent.push(JSON.parse(opts.body));
      return new Response(JSON.stringify({ id: 'em_1' }), { status: 200 });
    }
    return realFetch(url, opts);
  };
  try {
    const good = { name: 'Maya  Lopez', email: 'Maya@Example.com', phone: '(305) 555-0101', residence: 'Brickell Lofts',
      room: '12B', bedrooms: '2', bathrooms: '2', password: 'mayapass1', note: 'Prefer Fridays' };

    // Validation
    assert.equal((await post('/api/signup', { ...good, phone: '12' })).status, 400);
    assert.equal((await post('/api/signup', { ...good, bedrooms: '9' })).status, 400);
    assert.equal((await post('/api/signup', { ...good, password: 'short' })).status, 400);
    assert.equal((await post('/api/signup', { ...good, residence: '' })).status, 400);

    const res = await post('/api/signup', good);
    assert.equal(res.status, 201);
    assert.equal((await res.json()).status, 'pending');
    const row = db.prepare("SELECT * FROM clients WHERE email = 'maya@example.com'").get();
    assert.equal(row.status, 'pending');
    assert.equal(row.name, 'Maya Lopez');
    assert.equal(row.bedrooms, '2');
    assert.equal(row.signup_note, 'Prefer Fridays');
    assert.equal((await post('/api/signup', good)).status, 409);

    // Owner was emailed about the request.
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(sent.some((m) => /New account request: Maya Lopez/.test(m.subject)));

    // Can't sign in yet — right password gets a friendly "pending" notice, wrong password the usual error.
    let login = await post('/api/login', { email: 'maya@example.com', password: 'mayapass1' });
    assert.equal(login.status, 403);
    assert.equal((await login.json()).code, 'pending_approval');
    assert.equal(login.headers.get('set-cookie'), null);
    assert.equal((await post('/api/login', { email: 'maya@example.com', password: 'wrongpass1' })).status, 401);

    // Owner sees it in the dashboard and approves → client is emailed and can sign in.
    const adminLogin = await post('/api/admin/login', { email: 'owner@example.com', password: 'owner-secret-1' });
    const admin = adminLogin.headers.get('set-cookie').split(';')[0];
    const { clients } = await (await fetch(`${base}/api/admin/overview`, { headers: { cookie: admin } })).json();
    const pending = clients.find((c) => c.email === 'maya@example.com');
    assert.equal(pending.status, 'pending');
    assert.equal(pending.bathrooms, '2');
    assert.equal((await post(`/api/admin/clients/${pending.id}/approve`, {})).status, 401);
    const approve = await post(`/api/admin/clients/${pending.id}/approve`, {}, { cookie: admin });
    assert.deepEqual(await approve.json(), { ok: true, emailed: true });
    assert.ok(sent.some((m) => m.to[0] === 'maya@example.com' && /approved/.test(m.subject)));
    assert.equal((await post(`/api/admin/clients/${pending.id}/decline`, {}, { cookie: admin })).status, 409);
    login = await post('/api/login', { email: 'maya@example.com', password: 'mayapass1' });
    assert.equal(login.status, 200);

    // A second request gets declined with an email; the record is removed.
    await post('/api/signup', { ...good, email: 'nope@example.com', name: 'No Pe' });
    const nope = db.prepare("SELECT id FROM clients WHERE email = 'nope@example.com'").get();
    const decline = await post(`/api/admin/clients/${nope.id}/decline`, { sendEmail: true, reason: 'We don’t serve that area yet.' }, { cookie: admin });
    assert.deepEqual(await decline.json(), { ok: true, emailed: true });
    assert.equal(db.prepare("SELECT 1 FROM clients WHERE email = 'nope@example.com'").get(), undefined);
    assert.ok(sent.some((m) => m.to[0] === 'nope@example.com' && m.text.includes('serve that area')));

    // Pages
    const page = await fetch(`${base}/signup`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Create your account/);
    assert.match(await (await fetch(`${base}/login`)).text(), /href="\/signup"/);
  } finally {
    global.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  }
});

test('supplier jobs: request → accept/comment → photos + employee → complete → paid', async () => {
  const sent = [];
  const realFetch = global.fetch;
  process.env.RESEND_API_KEY = 'test-resend';
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.resend.com')) { sent.push(JSON.parse(opts.body)); return new Response('{"id":"x"}', { status: 200 }); }
    return realFetch(url, opts);
  };
  const del = (url, headers) => fetch(base + url, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
  try {
    const adminLogin = await post('/api/admin/login', { email: 'owner@example.com', password: 'owner-secret-1' });
    const admin = { cookie: adminLogin.headers.get('set-cookie').split(';')[0] };

    // Owner adds a supplier and gives them a portal login.
    await post('/api/admin/cleaners', { name: 'Ana Ruiz', company: 'Casa Nuova', email: 'ana@casanuova.test', active: true, services: [{ service: '2 Bedroom / 2 Bathroom Standard Clean', cost: '130', unit: 'clean' }] }, admin);
    const { cleaners } = await (await fetch(`${base}/api/admin/overview`, { headers: admin })).json();
    const ana = cleaners.find((c) => c.email === 'ana@casanuova.test');
    assert.equal(ana.portal, false);
    assert.equal('password_hash' in ana, false);
    assert.equal((await post(`/api/admin/cleaners/${ana.id}/portal`, { password: 'short' }, admin)).status, 400);
    assert.equal((await post(`/api/admin/cleaners/${ana.id}/portal`, { password: 'ana-portal-1' }, admin)).status, 200);

    // Supplier pages are gated.
    assert.match(await (await fetch(`${base}/supplier`)).text(), /Supplier login/);
    assert.equal((await fetch(`${base}/api/supplier/jobs`)).status, 401);
    assert.equal((await post('/api/supplier/login', { email: 'ana@casanuova.test', password: 'wrong-pass' })).status, 401);
    const supLogin = await post('/api/supplier/login', { email: 'ANA@casanuova.test', password: 'ana-portal-1' });
    assert.equal(supLogin.status, 200);
    const sup = { cookie: supLogin.headers.get('set-cookie').split(';')[0] };
    assert.match(await (await fetch(`${base}/supplier`, { headers: sup })).text(), /Supplier portal/);
    // A supplier session is not an owner or client session.
    assert.equal((await fetch(`${base}/api/admin/jobs`, { headers: sup })).status, 401);

    // Owner creates a job request.
    assert.equal((await post('/api/admin/jobs', { cleanerId: ana.id, address: '', serviceDate: '2026-11-02', pay: '130' }, admin)).status, 400);
    assert.equal((await post('/api/admin/jobs', { cleanerId: ana.id, address: '1 Main St', serviceDate: '2026-11-02', timeStart: '14:00', timeEnd: '12:00', pay: '130' }, admin)).status, 400);
    const created = await post('/api/admin/jobs', {
      cleanerId: ana.id, clientName: 'Maya Lopez', address: '900 Brickell Ave', unit: '12B', bedrooms: '2', bathrooms: '2',
      service: '2 Bedroom / 2 Bathroom Standard Clean', serviceDate: '2026-11-02', timeStart: '10:00', timeEnd: '13:00', pay: '130', instructions: 'Key at front desk',
    }, admin);
    assert.equal(created.status, 201);
    const { id: jobId, job_number } = await created.json();
    assert.match(job_number, /^J-\d+$/);
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(sent.some((m) => m.to?.[0] === 'ana@casanuova.test' && /New job request/.test(m.subject)));

    // Supplier sees it with address, beds/baths and times, and replies with a comment.
    let { jobs } = await (await fetch(`${base}/api/supplier/jobs`, { headers: sup })).json();
    let job = jobs.find((j) => j.id === jobId);
    assert.equal(job.status, 'requested');
    assert.equal(job.address, '900 Brickell Ave');
    assert.equal(job.bedrooms, '2');
    assert.equal(job.time_start, '10:00');
    assert.equal('client_id' in job, false);
    assert.equal((await post(`/api/supplier/jobs/${jobId}/messages`, { body: 'Can we start at 11?' }, sup)).status, 201);
    let owner = await (await fetch(`${base}/api/admin/jobs`, { headers: admin })).json();
    assert.equal(owner.jobs.find((j) => j.id === jobId).awaiting_owner, true);
    assert.equal((await post(`/api/admin/jobs/${jobId}/messages`, { body: '11 works.' }, admin)).status, 201);

    // Photos/completion aren't allowed before accepting.
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
    const upload = (kind, body = jpeg, type = 'image/jpeg') => fetch(`${base}/api/supplier/jobs/${jobId}/photos?kind=${kind}`, { method: 'POST', headers: { ...sup, 'Content-Type': type }, body });
    assert.equal((await upload('before')).status, 409);
    assert.equal((await post(`/api/supplier/jobs/${jobId}/accept`, {}, sup)).status, 200);
    assert.equal((await post(`/api/supplier/jobs/${jobId}/accept`, {}, sup)).status, 409);

    // Pending completion: needs before + after photos and the employee's full name.
    assert.equal((await post(`/api/supplier/jobs/${jobId}/complete`, { completedBy: 'Luis Gomez' }, sup)).status, 400);
    assert.equal((await upload('before', Buffer.from('not an image'))).status, 400);
    assert.equal((await upload('sideways')).status, 400);
    const b = await upload('before');
    assert.equal(b.status, 201);
    const beforeId = (await b.json()).id;
    assert.equal((await upload('after')).status, 201);
    assert.equal((await upload('after')).status, 201);
    assert.equal((await del(`/api/supplier/jobs/${jobId}/photos/${beforeId}`, sup)).status, 200);
    assert.equal((await post(`/api/supplier/jobs/${jobId}/complete`, { completedBy: 'Luis Gomez' }, sup)).status, 400);
    const b2 = await upload('before');
    const photoId = (await b2.json()).id;
    assert.equal((await post(`/api/supplier/jobs/${jobId}/complete`, { completedBy: 'Luis' }, sup)).status, 400);
    assert.equal((await post(`/api/supplier/jobs/${jobId}/complete`, { completedBy: '  Luis   Gomez ', notes: 'Oven was very dirty' }, sup)).status, 200);

    // Photos are viewable by the supplier and the owner only.
    const img = await fetch(`${base}/api/supplier/photos/${photoId}`, { headers: sup });
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.equal((await fetch(`${base}/api/admin/jobs/photos/${photoId}`, { headers: admin })).status, 200);
    assert.equal((await fetch(`${base}/api/admin/jobs/photos/${photoId}`)).status, 401);
    assert.equal((await upload('after')).status, 409);

    // Owner sees it completed and owed; supplier sees the outstanding amount.
    owner = await (await fetch(`${base}/api/admin/jobs`, { headers: admin })).json();
    job = owner.jobs.find((j) => j.id === jobId);
    assert.equal(job.status, 'completed');
    assert.equal(job.completed_by, 'Luis Gomez');
    assert.equal(job.photos.filter((p) => p.kind === 'after').length, 2);
    assert.equal(owner.payables.find((p) => p.cleaner_id === ana.id).outstanding_cents, 13000);
    let me = await (await fetch(`${base}/api/supplier/me`, { headers: sup })).json();
    assert.equal(me.payables.outstanding_cents, 13000);
    assert.ok(sent.some((m) => /Job completed/.test(m.subject)));

    // Mark paid with a reference → nothing outstanding.
    assert.equal((await post(`/api/admin/jobs/${jobId}/paid`, { paid: true, ref: 'ET-5521' }, admin)).status, 200);
    me = await (await fetch(`${base}/api/supplier/me`, { headers: sup })).json();
    assert.equal(me.payables.outstanding_cents, 0);
    assert.equal(me.payables.paid_cents, 13000);
    ({ jobs } = await (await fetch(`${base}/api/supplier/jobs`, { headers: sup })).json());
    assert.equal(jobs.find((j) => j.id === jobId).supplier_paid_ref, 'ET-5521');

    // Pay-all, cancel and supplier deletion rules.
    const second = await (await post('/api/admin/jobs', { cleanerId: ana.id, address: '2 Side St', serviceDate: '2026-11-05', pay: '110' }, admin)).json();
    assert.equal((await post(`/api/admin/jobs/${second.id}/paid`, { paid: true }, admin)).status, 409);
    assert.equal((await post(`/api/admin/jobs/${second.id}/cancel`, {}, admin)).status, 200);
    assert.equal((await post(`/api/supplier/jobs/${second.id}/accept`, {}, sup)).status, 409);
    assert.equal((await del(`/api/admin/jobs/${second.id}`, admin)).status, 200);
    assert.equal((await del(`/api/admin/cleaners/${ana.id}`, admin)).status, 409);

    // Turning the portal off signs the supplier out.
    assert.equal((await del(`/api/admin/cleaners/${ana.id}/portal`, admin)).status, 200);
    assert.equal((await fetch(`${base}/api/supplier/jobs`, { headers: sup })).status, 401);
  } finally {
    global.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  }
});

test('orders keep an optional requested service time', async () => {
  const adminLogin = await post('/api/admin/login', { email: 'owner@example.com', password: 'owner-secret-1' });
  const admin = { cookie: adminLogin.headers.get('set-cookie').split(';')[0] };
  const clientId = addClient('timed@example.com', 'timedpass1', 'Tim Ed');
  const res = await post('/api/admin/orders', { clientId, date: '2026-11-03', time: '14:30', service: '2 Bedroom / 2 Bathroom Standard Clean', plan: 'Bi-Weekly', amount: '160', status: 'scheduled' }, admin);
  assert.equal(res.status, 201);
  let { orders } = await (await fetch(`${base}/api/admin/overview`, { headers: admin })).json();
  let order = orders.find((o) => o.client_id === Number(clientId));
  assert.equal(order.service_time, '14:30');
  assert.equal(order.amount_cents, 16000);
  await fetch(`${base}/api/admin/orders/${order.id}`, { method: 'PATCH', headers: { ...admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ date: '2026-11-03', time: 'bad', service: 'X', plan: 'Monthly', amount: '160', status: 'scheduled' }) });
  ({ orders } = await (await fetch(`${base}/api/admin/overview`, { headers: admin })).json());
  order = orders.find((o) => o.client_id === Number(clientId));
  assert.equal(order.service_time, null);
});

test('invoicing an order links them, and the order shows the invoice status', async () => {
  const adminLogin = await post('/api/admin/login', { email: 'owner@example.com', password: 'owner-secret-1' });
  const admin = { cookie: adminLogin.headers.get('set-cookie').split(';')[0] };
  const clientId = Number(addClient('linked@example.com', 'linkedpass1', 'Lin Ked'));
  const otherId = Number(addClient('other@example.com', 'otherpass1', 'Oth Er'));
  await post('/api/admin/orders', { clientId, date: '2026-11-10', service: 'Studio Standard Clean', plan: 'One-Time', amount: '110', status: 'scheduled' }, admin);
  let { orders } = await (await fetch(`${base}/api/admin/overview`, { headers: admin })).json();
  const order = orders.find((o) => o.client_id === clientId);
  assert.equal(order.invoice_number, null);

  const item = [{ description: 'Studio Standard Clean', amount: '110' }];
  assert.equal((await post('/api/admin/invoices', { clientId: otherId, orderId: order.id, items: item, sendEmail: false }, admin)).status, 400);
  const res = await post('/api/admin/invoices', { clientId, orderId: order.id, items: item, serviceDate: '2026-11-10', sendEmail: false }, admin);
  assert.equal(res.status, 201);
  const { invoiceNumber } = await res.json();
  ({ orders } = await (await fetch(`${base}/api/admin/overview`, { headers: admin })).json());
  const linked = orders.find((o) => o.id === order.id);
  assert.equal(linked.invoice_number, invoiceNumber);
  assert.equal(linked.invoice_status, 'open');
});

test('prices are shown and charged in USD by default (STRIPE_CURRENCY can override)', async () => {
  const cfg = await fetch(`${base}/js/config.js`);
  assert.equal(cfg.status, 200);
  assert.match(await cfg.text(), /window\.APLUS = \{"currency":"usd"\}/);
  const stripe = require('../src/stripe');
  assert.equal(stripe.formatMoney(16000), '$160.00');
  process.env.STRIPE_CURRENCY = 'cad';
  try {
    assert.equal(stripe.currency(), 'cad');
    assert.match(await (await fetch(`${base}/js/config.js`)).text(), /"currency":"cad"/);
  } finally {
    delete process.env.STRIPE_CURRENCY;
  }
});

test('invoices can be cancelled (with optional Stripe refund) and orders/invoices take private notes', async () => {
  const adminLogin = await post('/api/admin/login', { email: 'owner@example.com', password: 'owner-secret-1' });
  const admin = { cookie: adminLogin.headers.get('set-cookie').split(';')[0] };
  const patch = (url, body) => fetch(base + url, { method: 'PATCH', headers: { ...admin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const clientId = Number(addClient('refund@example.com', 'refundpass1', 'Re Fund'));
  const make = async () => (await (await post('/api/admin/invoices', { clientId, items: [{ description: 'Studio Standard Clean', amount: '110' }], sendEmail: false }, admin)).json()).invoiceNumber;
  const find = async (num) => (await (await fetch(`${base}/api/admin/overview`, { headers: admin })).json()).invoices.find((i) => i.invoice_number === num);

  // Unpaid → cancelled, with a reason; hidden from the client.
  const a = await make();
  const invA = await find(a);
  assert.equal((await post(`/api/admin/invoices/${invA.id}/cancel`, { reason: 'Client changed plans' }, admin)).status, 200);
  assert.equal((await find(a)).status, 'void');
  assert.equal((await find(a)).cancel_reason, 'Client changed plans');
  assert.equal((await post(`/api/admin/invoices/${invA.id}/cancel`, {}, admin)).status, 409);

  // Paid by card → cancel + refund through Stripe.
  const b = await make();
  const invB = await find(b);
  db.prepare("UPDATE invoices SET status = 'paid', paid_method = 'stripe', stripe_payment_intent = 'pi_test_123', paid_at = datetime('now') WHERE id = ?").run(invB.id);
  assert.equal((await find(b)).stripe_refundable, 1);
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.stripe.com/v1/refunds')) { calls.push(new URLSearchParams(opts.body)); return new Response('{"id":"re_123"}', { status: 200 }); }
    return realFetch(url, opts);
  };
  try {
    const res = await post(`/api/admin/invoices/${invB.id}/cancel`, { refund: 'stripe', reason: 'Test payment' }, admin);
    assert.deepEqual(await res.json(), { ok: true, refunded: true, refundId: 're_123' });
    assert.equal(calls[0].get('payment_intent'), 'pi_test_123');
  } finally {
    global.fetch = realFetch;
    delete process.env.STRIPE_SECRET_KEY;
  }
  const cancelledB = await find(b);
  assert.equal(cancelledB.status, 'void');
  assert.ok(cancelledB.refunded_at);

  // Paid manually → can't refund via Stripe, but can record an existing refund.
  const c = await make();
  const invC = await find(c);
  db.prepare("UPDATE invoices SET status = 'paid', paid_method = 'e-transfer', paid_at = datetime('now') WHERE id = ?").run(invC.id);
  assert.equal((await post(`/api/admin/invoices/${invC.id}/cancel`, { refund: 'stripe' }, admin)).status, 400);
  assert.equal((await post(`/api/admin/invoices/${invC.id}/cancel`, { refund: 'already' }, admin)).status, 200);
  assert.ok((await find(c)).refunded_at);

  // Client portal: unpaid-cancelled hidden, refunded ones shown as refunded.
  const { cookie } = await login('refund@example.com', 'refundpass1');
  const { invoices } = await (await fetch(`${base}/api/invoices`, { headers: { cookie } })).json();
  assert.deepEqual(invoices.map((i) => i.invoice_number).sort(), [b, c].sort());
  assert.ok(invoices.every((i) => i.refunded_at));

  // Private notes.
  assert.equal((await patch(`/api/admin/invoices/${invA.id}/notes`, { notes: 'Called client Oct 14' })).status, 200);
  assert.equal((await find(a)).admin_notes, 'Called client Oct 14');
  await post('/api/admin/orders', { clientId, date: '2026-11-12', service: 'Studio Standard Clean', plan: 'One-Time', amount: '110', status: 'scheduled' }, admin);
  let { orders } = await (await fetch(`${base}/api/admin/overview`, { headers: admin })).json();
  const order = orders.find((o) => o.client_id === clientId);
  assert.equal((await patch(`/api/admin/orders/${order.id}/notes`, { notes: 'Gate code 4411' })).status, 200);
  ({ orders } = await (await fetch(`${base}/api/admin/overview`, { headers: admin })).json());
  assert.equal(orders.find((o) => o.id === order.id).admin_notes, 'Gate code 4411');
  // Notes never reach the client's portal.
  const mine = await (await fetch(`${base}/api/orders`, { headers: { cookie } })).json();
  assert.equal(JSON.stringify(mine).includes('Gate code'), false);
});

test('new invoice numbers are random 8-digit numbers, never repeated', async () => {
  const adminLogin = await post('/api/admin/login', { email: 'owner@example.com', password: 'owner-secret-1' });
  const admin = { cookie: adminLogin.headers.get('set-cookie').split(';')[0] };
  const clientId = Number(addClient('random@example.com', 'randompass1', 'Ran Dom'));
  const numbers = [];
  for (let i = 0; i < 5; i += 1) {
    const res = await post('/api/admin/invoices', { clientId, items: [{ description: 'Studio Standard Clean', amount: '110' }], sendEmail: false }, admin);
    numbers.push((await res.json()).invoiceNumber);
  }
  for (const n of numbers) assert.match(n, /^INV-\d{8}$/);
  assert.equal(new Set(numbers).size, numbers.length);
  // Still payable/lookup-able by number from the client portal.
  const { cookie } = await login('random@example.com', 'randompass1');
  const { invoices } = await (await fetch(`${base}/api/invoices`, { headers: { cookie } })).json();
  assert.equal(invoices.length, 5);
});

test('cleaner link: one job only, no login, supplier approves the submission', async () => {
  const sent = [];
  const realFetch = global.fetch;
  process.env.RESEND_API_KEY = 'test-resend';
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.resend.com')) { sent.push(JSON.parse(opts.body)); return new Response('{"id":"x"}', { status: 200 }); }
    return realFetch(url, opts);
  };
  const del = (url, headers = {}) => fetch(base + url, { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
  const soon = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
  try {
    const admin = { cookie: (await post('/api/admin/login', { email: 'owner@example.com', password: 'owner-secret-1' })).headers.get('set-cookie').split(';')[0] };
    await post('/api/admin/cleaners', { name: 'Rosa Diaz', company: 'Sparkle Co', email: 'rosa@sparkle.test', active: true, services: [] }, admin);
    const { cleaners } = await (await fetch(`${base}/api/admin/overview`, { headers: admin })).json();
    const rosa = cleaners.find((c) => c.email === 'rosa@sparkle.test');
    await post(`/api/admin/cleaners/${rosa.id}/portal`, { password: 'rosa-portal-1' }, admin);
    const sup = { cookie: (await post('/api/supplier/login', { email: 'rosa@sparkle.test', password: 'rosa-portal-1' })).headers.get('set-cookie').split(';')[0] };
    const { id: jobId } = await (await post('/api/admin/jobs', { cleanerId: rosa.id, clientName: 'Secret Client', address: '5 Ocean Dr', bedrooms: '1', serviceDate: soon, pay: '95', instructions: 'Lockbox 1234' }, admin)).json();
    const other = await (await post('/api/admin/jobs', { cleanerId: rosa.id, address: '9 Other Rd', serviceDate: soon, pay: '80' }, admin)).json();

    // Link only after accepting; reused unless a new one is asked for.
    assert.equal((await post(`/api/supplier/jobs/${jobId}/cleaner-link`, {}, sup)).status, 409);
    await post(`/api/supplier/jobs/${jobId}/accept`, {}, sup);
    await post(`/api/supplier/jobs/${other.id}/accept`, {}, sup);
    assert.equal((await post(`/api/supplier/jobs/${jobId}/cleaner-link`, {})).status, 401);
    const first = await (await post(`/api/supplier/jobs/${jobId}/cleaner-link`, {}, sup)).json();
    assert.match(first.path, /^\/c\/[A-Za-z0-9_-]{20,}$/);
    assert.equal((await (await post(`/api/supplier/jobs/${jobId}/cleaner-link`, {}, sup)).json()).path, first.path);
    const fresh = await (await post(`/api/supplier/jobs/${jobId}/cleaner-link?new=1`, {}, sup)).json();
    assert.notEqual(fresh.path, first.path);
    const oldToken = first.path.slice(3);
    const token = fresh.path.slice(3);
    assert.equal((await fetch(`${base}/api/cleaner/${oldToken}`)).status, 404);

    // The page loads without a login and shows only this job — no pay, client or messages.
    const page = await fetch(`${base}/c/${token}`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('x-robots-tag'), 'noindex');
    const { job } = await (await fetch(`${base}/api/cleaner/${token}`)).json();
    assert.equal(job.address, '5 Ocean Dr');
    assert.equal(job.instructions, 'Lockbox 1234');
    assert.equal(job.company, 'Sparkle Co');
    for (const hidden of ['pay_cents', 'client_name', 'client_id', 'messages', 'id', 'cleaner_token', 'cleaner_id']) assert.equal(hidden in job, false, hidden);
    assert.equal((await fetch(`${base}/api/cleaner/not-a-real-token-xxxxxxxx`)).status, 404);
    assert.equal((await fetch(`${base}/api/supplier/jobs`, { headers: {} })).status, 401);

    // Upload rules, then submit with a full name.
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
    const upload = (kind, t = token) => fetch(`${base}/api/cleaner/${t}/photos?kind=${kind}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg });
    assert.equal((await post(`/api/cleaner/${token}/submit`, { name: 'Luz Mora' })).status, 400);
    const before = await (await upload('before')).json();
    assert.equal((await upload('after')).status, 201);
    const extra = await (await upload('after')).json();
    assert.equal((await del(`/api/cleaner/${token}/photos/${extra.id}`)).status, 200);
    assert.equal((await fetch(`${base}/api/cleaner/${token}/photos/${before.id}`)).status, 200);
    assert.equal((await post(`/api/cleaner/${token}/submit`, { name: 'Luz' })).status, 400);
    assert.equal((await post(`/api/cleaner/${token}/submit`, { name: ' Luz   Mora ' })).status, 200);
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(sent.some((m) => m.to?.[0] === 'rosa@sparkle.test' && /Ready for review/.test(m.subject)));
    assert.ok(sent.some((m) => /Cleaner photos in/.test(m.subject)));

    // Locked after submitting; the owner and supplier see "ready for review".
    assert.equal((await upload('after')).status, 409);
    assert.equal((await del(`/api/cleaner/${token}/photos/${before.id}`)).status, 409);
    let owner = await (await fetch(`${base}/api/admin/jobs`, { headers: admin })).json();
    let ownerJob = owner.jobs.find((j) => j.id === jobId);
    assert.equal(ownerJob.cleaner_signed_by, 'Luz Mora');
    assert.equal(ownerJob.cleaner_name, 'Rosa Diaz');
    assert.equal(ownerJob.photos.length, 2);

    // Supplier sends it back, the cleaner can change photos, resubmits; then the supplier approves.
    assert.equal((await post(`/api/supplier/jobs/${jobId}/send-back`, {}, sup)).status, 200);
    assert.equal((await post(`/api/supplier/jobs/${jobId}/send-back`, {}, sup)).status, 409);
    assert.equal((await upload('after')).status, 201);
    assert.equal((await post(`/api/cleaner/${token}/submit`, { name: 'Luz Mora' })).status, 200);
    assert.equal((await post(`/api/supplier/jobs/${jobId}/complete`, { completedBy: 'Luz Mora' }, sup)).status, 200);
    owner = await (await fetch(`${base}/api/admin/jobs`, { headers: admin })).json();
    ownerJob = owner.jobs.find((j) => j.id === jobId);
    assert.equal(ownerJob.status, 'completed');
    assert.equal(ownerJob.completed_by, 'Luz Mora');
    assert.equal(ownerJob.cleaner_token, null);
    assert.equal((await fetch(`${base}/api/cleaner/${token}`)).status, 404);

    // Turning a link off kills it; a token never opens another job.
    const otherLink = await (await post(`/api/supplier/jobs/${other.id}/cleaner-link`, {}, sup)).json();
    const otherToken = otherLink.path.slice(3);
    assert.equal((await fetch(`${base}/api/cleaner/${otherToken}/photos/${before.id}`)).status, 404);
    assert.equal((await del(`/api/supplier/jobs/${other.id}/cleaner-link`, sup)).status, 200);
    assert.equal((await fetch(`${base}/api/cleaner/${otherToken}`)).status, 404);
  } finally {
    global.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  }
});

test('payment and job-completed alerts always reach info@aplus-cleaning-solutions.com', async () => {
  const sent = [];
  const realFetch = global.fetch;
  process.env.RESEND_API_KEY = 'test-resend';
  process.env.NOTIFY_EMAIL = 'someone-else@example.com';
  global.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.resend.com')) { sent.push(JSON.parse(opts.body)); return new Response('{"id":"x"}', { status: 200 }); }
    return realFetch(url, opts);
  };
  const INFO = 'info@aplus-cleaning-solutions.com';
  const soon = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
  try {
    const admin = { cookie: (await post('/api/admin/login', { email: 'owner@example.com', password: 'owner-secret-1' })).headers.get('set-cookie').split(';')[0] };

    // Invoice paid.
    const clientId = Number(addClient('payer@example.com', 'payerpass1', 'Pat Payer'));
    const { invoiceNumber } = await (await post('/api/admin/invoices', { clientId, items: [{ description: 'Studio Standard Clean', amount: '110' }], sendEmail: false }, admin)).json();
    const { invoices } = await (await fetch(`${base}/api/admin/overview`, { headers: admin })).json();
    const inv = invoices.find((i) => i.invoice_number === invoiceNumber);
    assert.equal((await post(`/api/admin/invoices/${inv.id}/mark-paid`, { method: 'e-transfer' }, admin)).status, 200);
    await new Promise((r) => setTimeout(r, 20));
    const paidMail = sent.find((m) => m.subject.startsWith(`Payment received: ${invoiceNumber}`));
    assert.ok(paidMail);
    assert.deepEqual(paidMail.to, ['someone-else@example.com', INFO]);
    assert.match(paidMail.text, /Pat Payer/);

    // Supplier job completed.
    await post('/api/admin/cleaners', { name: 'Tina Lee', company: 'Lee Clean', email: 'tina@lee.test', active: true, services: [] }, admin);
    const { cleaners } = await (await fetch(`${base}/api/admin/overview`, { headers: admin })).json();
    const tina = cleaners.find((c) => c.email === 'tina@lee.test');
    await post(`/api/admin/cleaners/${tina.id}/portal`, { password: 'tina-portal-1' }, admin);
    const sup = { cookie: (await post('/api/supplier/login', { email: 'tina@lee.test', password: 'tina-portal-1' })).headers.get('set-cookie').split(';')[0] };
    const { id: jobId } = await (await post('/api/admin/jobs', { cleanerId: tina.id, address: '7 Bay Rd', serviceDate: soon, pay: '90' }, admin)).json();
    await post(`/api/supplier/jobs/${jobId}/accept`, {}, sup);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
    for (const kind of ['before', 'after']) await fetch(`${base}/api/supplier/jobs/${jobId}/photos?kind=${kind}`, { method: 'POST', headers: { ...sup, 'Content-Type': 'image/jpeg' }, body: jpeg });
    assert.equal((await post(`/api/supplier/jobs/${jobId}/complete`, { completedBy: 'Sam Ortiz' }, sup)).status, 200);
    await new Promise((r) => setTimeout(r, 20));
    const doneMail = sent.find((m) => /^Job completed/.test(m.subject) && m.subject.includes('7 Bay Rd'));
    assert.ok(doneMail);
    assert.deepEqual(doneMail.to, ['someone-else@example.com', INFO]);
  } finally {
    global.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.NOTIFY_EMAIL;
  }
});

test('English/Spanish switch is on the website, login, sign-up, portal and cleaner pages', async () => {
  const js = await fetch(`${base}/js/i18n.js`);
  assert.equal(js.status, 200);
  const src = await js.text();
  for (const phrase of ['Request My Quote', 'Welcome back, {name}', 'Pay {amount}', '1. Scope of Services']) assert.ok(src.includes(`'${phrase}'`), phrase);
  for (const page of ['/', '/login', '/signup', '/does-not-exist']) {
    assert.match(await (await fetch(base + page)).text(), /<script src="\/js\/i18n\.js" defer><\/script>/, page);
  }
  // The portal and cleaner pages load it too (checked from the files, since they need a login or a link).
  for (const file of ['portal.html', 'cleaner.html']) {
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8'), /\/js\/i18n\.js/, file);
  }
});
