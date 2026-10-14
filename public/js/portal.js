'use strict';

const CURRENCY = ((window.APLUS && window.APLUS.currency) || 'usd').toUpperCase();
const money = new Intl.NumberFormat(CURRENCY === 'CAD' ? 'en-CA' : 'en-US', { style: 'currency', currency: CURRENCY });
const T = (s, v) => (window.I18N ? window.I18N.t(s, v) : s.replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m)));
const LOCALE = () => (window.I18N ? window.I18N.locale() : 'en-CA');
const STATUS_LABELS = { scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled' };

// service_date is a plain YYYY-MM-DD; parse as a local date so it doesn't shift by timezone.
const parseDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const fmtDate = (iso, opts = { month: 'short', day: 'numeric', year: 'numeric' }) =>
  parseDate(iso).toLocaleDateString(LOCALE(), opts);
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child != null) node.append(child);
  }
  return node;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (res.status === 401) {
    window.location.replace('/login');
    throw new Error('Signed out');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Something went wrong.');
  return body;
}

let allOrders = [];
let currentFilter = 'all';

function renderProfile(client) {
  const first = client.name.split(' ')[0];
  document.getElementById('greeting').textContent = T('Welcome back, {name}', { name: first });
  document.getElementById('user-name').textContent = client.name;
  document.getElementById('avatar').textContent = client.name
    .split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  document.getElementById('pw-username').value = client.email;

  const where = [client.residence, client.room && T('Room {room}', { room: client.room })].filter(Boolean).join(' · ');
  document.getElementById('location-line').textContent = where;

  const details = document.getElementById('account-details');
  details.replaceChildren();
  const rows = [
    ['Name', client.name],
    ['Email', client.email],
    ['Phone', client.phone || '—'],
    ['Residence', where || '—'],
    ['Client since', new Date(client.created_at.replace(' ', 'T') + 'Z')
      .toLocaleDateString(LOCALE(), { month: 'long', year: 'numeric' })],
  ];
  for (const [term, value] of rows) {
    details.append(el('div', {}, el('dt', {}, term), el('dd', {}, value)));
  }
}

function renderStats(orders) {
  const today = todayIso();
  const upcoming = orders
    .filter((o) => o.status === 'scheduled' && o.service_date >= today)
    .sort((a, b) => a.service_date.localeCompare(b.service_date));
  const completed = orders.filter((o) => o.status === 'completed');
  const spent = completed.reduce((sum, o) => sum + o.amount_cents, 0);

  const next = upcoming[0];
  document.getElementById('stat-next').textContent = next
    ? fmtDate(next.service_date, { weekday: 'short', month: 'short', day: 'numeric' })
    : 'None booked';
  document.getElementById('stat-next-meta').textContent = next
    ? next.service_type
    : 'Email us to book your next clean';

  document.getElementById('stat-completed').textContent = String(completed.length);
  document.getElementById('stat-spent').textContent = money.format(spent / 100);

  // Current plan = plan on the most recent non-cancelled order.
  const latest = orders.find((o) => o.status !== 'cancelled');
  document.getElementById('stat-plan').textContent = latest ? latest.plan : '—';
  document.getElementById('stat-plan-meta').textContent = upcoming.length
    ? T(upcoming.length === 1 ? '{n} upcoming visit' : '{n} upcoming visits', { n: upcoming.length })
    : '';
}

function renderOrders() {
  const tbody = document.getElementById('orders-body');
  const empty = document.getElementById('orders-empty');
  const rows = currentFilter === 'all' ? allOrders : allOrders.filter((o) => o.status === currentFilter);

  tbody.replaceChildren();
  empty.hidden = rows.length > 0;
  if (!rows.length) {
    empty.textContent = allOrders.length
      ? T(`No ${currentFilter === 'scheduled' ? 'upcoming' : currentFilter} orders.`)
      : 'You don’t have any orders yet. Once your first clean is booked it will appear here.';
    return;
  }

  for (const o of rows) {
    const service = el('td', { 'data-label': 'Service' }, el('div', {},
      el('strong', {}, o.service_type),
      el('span', { class: 'sub' }, T('{plan} plan', { plan: T(o.plan) })),
      o.notes ? el('span', { class: 'note' }, o.notes) : null));

    tbody.append(el('tr', { class: `status-${o.status}` },
      el('td', { 'data-label': 'Date' }, el('time', { datetime: o.service_date }, fmtDate(o.service_date)),
        o.service_time ? el('span', { class: 'sub' }, new Date(2000, 0, 1, ...o.service_time.split(':').map(Number)).toLocaleTimeString(LOCALE(), { hour: 'numeric', minute: '2-digit' })) : null),
      el('td', { 'data-label': 'Order', class: 'mono' }, o.order_number),
      service,
      el('td', { 'data-label': 'Location' }, o.location || '—'),
      el('td', { 'data-label': 'Status' },
        el('span', { class: `badge badge-${o.status}` }, STATUS_LABELS[o.status] || o.status)),
      el('td', { 'data-label': 'Amount', class: 'num' },
        o.status === 'cancelled' && !o.amount_cents ? '—' : money.format(o.amount_cents / 100))));
  }
}

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((tab) => tab.addEventListener('click', () => {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    currentFilter = tab.dataset.filter;
    renderOrders();
  }));
}

function setupLogout() {
  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await api('/api/logout', { method: 'POST', body: '{}' });
    } finally {
      window.location.assign('/login');
    }
  });
}

function setupPasswordForm() {
  const form = document.getElementById('password-form');
  const alertBox = form.querySelector('.alert');
  const submit = form.querySelector('button[type="submit"]');
  const show = (type, msg) => {
    alertBox.className = `alert alert-${type}`;
    alertBox.textContent = msg;
    alertBox.hidden = false;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = form.currentPassword.value;
    const newPassword = form.newPassword.value;
    if (!currentPassword || newPassword.length < 8) {
      show('error', 'Enter your current password and a new password of at least 8 characters.');
      return;
    }
    submit.disabled = true;
    try {
      await api('/api/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      form.reset();
      show('success', 'Password updated. Other devices have been signed out.');
    } catch (err) {
      show('error', err.message);
    } finally {
      submit.disabled = false;
    }
  });
}

/* ---------- Invoices ---------- */

function invoiceBadge(inv) {
  if (inv.refunded_at) return ['cancelled', 'Refunded'];
  if (inv.status === 'paid') return ['paid', 'Paid'];
  if (inv.due_date && inv.due_date < todayIso()) return ['overdue', 'Overdue'];
  return ['open', 'Due'];
}

async function payInvoice(inv, btn) {
  btn.disabled = true;
  btn.textContent = 'Opening secure checkout…';
  try {
    const { url } = await api(`/api/invoices/${encodeURIComponent(inv.invoice_number)}/pay`, { method: 'POST', body: '{}' });
    window.location.assign(url);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = T('Pay {amount}', { amount: money.format(inv.amount_cents / 100) });
    showPayNotice('error', err.message);
  }
}

function showPayNotice(type, message) {
  const box = document.getElementById('pay-notice');
  box.className = `alert alert-${type}`;
  box.textContent = message;
  box.hidden = false;
}

function renderInvoices(invoices, paymentsEnabled) {
  const panel = document.getElementById('invoices-panel');
  const list = document.getElementById('invoice-list');
  const banner = document.getElementById('balance-banner');
  list.replaceChildren();
  panel.hidden = invoices.length === 0;

  const open = invoices.filter((i) => i.status === 'open');
  banner.hidden = open.length === 0;
  if (open.length) {
    const due = open.reduce((sum, i) => sum + i.amount_cents, 0);
    document.getElementById('balance-title').textContent =
      T(open.length === 1 ? 'You have {n} unpaid invoice · {amount} due' : 'You have {n} unpaid invoices · {amount} due', { n: open.length, amount: money.format(due / 100) });
    document.getElementById('balance-sub').textContent = paymentsEnabled
      ? 'Pay securely online by card in under a minute.'
      : 'Please contact us to arrange payment.';
  }

  for (const inv of invoices) {
    const [cls, label] = invoiceBadge(inv);
    const lines = el('table', { class: 'invoice-lines' }, el('tbody', {},
      ...inv.items.map((it) => el('tr', {}, el('td', {}, it.description), el('td', {}, money.format(it.amount_cents / 100)))),
      el('tr', { class: 'total' }, el('td', {}, 'Total'), el('td', {}, money.format(inv.amount_cents / 100)))));

    const meta = [T('Issued {date}', { date: fmtDate(inv.created_at.slice(0, 10)) })];
    let service = null;
    if (inv.service_date) {
      let when = fmtDate(inv.service_date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      if (inv.service_time) {
        const [h, m] = inv.service_time.split(':').map(Number);
        when = T('{date} at {time}', { date: when, time: new Date(2000, 0, 1, h, m).toLocaleTimeString(LOCALE(), { hour: 'numeric', minute: '2-digit' }) });
      }
      service = el('p', { class: 'invoice-service' }, '🗓️ ', el('strong', {}, `${T('Service:')} `), when);
    }
    if (inv.status === 'open' && inv.due_date) meta.push(T('Due {date}', { date: fmtDate(inv.due_date) }));
    if (inv.status === 'paid' && inv.paid_at) meta.push(T('Paid {date}', { date: fmtDate(inv.paid_at.slice(0, 10)) }));

    const actions = el('div', { class: 'invoice-actions' });
    if (inv.status === 'open' && paymentsEnabled) {
      const btn = el('button', { type: 'button', class: 'btn btn-primary' }, T('Pay {amount}', { amount: money.format(inv.amount_cents / 100) }));
      btn.addEventListener('click', () => payInvoice(inv, btn));
      actions.append(btn, el('span', { class: 'secure' }, '🔒 Secure checkout by Stripe'));
    } else if (inv.status === 'open') {
      actions.append(el('span', { class: 'secure' }, 'Online payment coming soon — contact us at info@aplus-cleaning-solutions.com to pay.'));
    }
    if (inv.receipt_url) {
      actions.append(el('a', { class: 'btn btn-outline btn-sm', href: inv.receipt_url, target: '_blank', rel: 'noopener' }, 'View Receipt'));
    }

    list.append(el('article', { class: `invoice-card${inv.status === 'open' ? ' is-open' : ''}` },
      el('div', { class: 'invoice-top' },
        el('div', {}, el('h3', {}, T('Invoice {number}', { number: inv.invoice_number })), el('span', { class: 'sub' }, meta.join(' · '))),
        el('span', { class: `badge badge-${cls}` }, label)),
      service,
      lines,
      inv.notes ? el('p', { class: 'invoice-note' }, inv.notes) : null,
      actions.children.length ? actions : null));
  }
}

async function loadInvoices() {
  const { invoices, payments } = await api('/api/invoices');
  renderInvoices(invoices, payments);
}

// Back from Stripe: confirm the payment so the invoice shows as paid right away.
async function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('paid');
  if (!sessionId) return;
  history.replaceState(null, '', '/portal');
  try {
    const result = await api('/api/invoices/confirm', { method: 'POST', body: JSON.stringify({ sessionId }) });
    if (result.paid) showPayNotice('success', T('Thank you! Invoice {number} is paid. A receipt has been emailed to you.', { number: result.invoiceNumber }));
    else showPayNotice('success', 'Thanks! Your payment is processing and will show here shortly.');
  } catch (err) {
    showPayNotice('success', 'Thanks! Your payment is processing and will show here shortly.');
  }
}

/* ---------- App & invoice alerts ---------- */

async function setupAppStrip() {
  const app = window.APlusApp;
  if (!app) return;
  const strip = document.getElementById('app-strip');
  const btn = document.getElementById('client-push');
  const render = async () => {
    const on = await app.pushEnabled().catch(() => false);
    btn.textContent = on ? '✓ Invoice alerts on' : '🔔 Notify Me About Invoices';
    btn.disabled = on;
    btn.className = `btn btn-sm ${on ? 'btn-outline' : 'btn-primary'}`;
    strip.hidden = on && app.isStandalone();
  };
  btn.addEventListener('click', async () => {
    try {
      const result = await app.enablePush('client');
      if (result?.ok !== false) showPayNotice('success', 'You’ll get a notification on this device when a new invoice arrives.');
    } catch (err) {
      showPayNotice('error', err.message);
    }
    render();
  });
  render();
}

/* ---------- Terms & Conditions (signed once, when the account is first opened) ---------- */

function renderTerms(t) {
  const body = document.getElementById('terms-body');
  body.replaceChildren(el('p', { class: 'muted' }, T('{company} · Terms & Conditions of Service · Version {version}', t)));
  if (window.I18N && window.I18N.lang === 'es') {
    body.append(el('p', { class: 'alert alert-info' }, T('Courtesy translation. The English version of these Terms & Conditions is the one that applies and prevails if there is any difference.')));
  }
  for (const section of t.sections) {
    const wrap = el('section', {}, el('h3', {}, section.heading));
    for (const block of section.blocks) {
      wrap.append(block.type === 'list'
        ? el('ul', {}, ...block.items.map((item) => el('li', {}, item)))
        : el('p', {}, block.text));
    }
    body.append(wrap);
  }
}

// Shows the pop-up and resolves once the client has signed. It can't be dismissed — only signed or signed out.
async function requireTermsAcceptance(client) {
  const t = await api('/api/terms');
  renderTerms(t);
  const dialog = document.getElementById('terms-dialog');
  const form = document.getElementById('terms-form');
  const nameInput = document.getElementById('terms-name');
  const agree = document.getElementById('terms-agree');
  const submit = document.getElementById('terms-submit');
  const alertBox = form.querySelector('.alert');
  nameInput.placeholder = T('e.g. {name}', { name: client.name });

  const update = () => { submit.disabled = !(agree.checked && nameInput.value.trim().length >= 2); };
  nameInput.addEventListener('input', update);
  agree.addEventListener('change', update);
  dialog.addEventListener('cancel', (e) => e.preventDefault());
  document.getElementById('terms-signout').addEventListener('click', () => document.getElementById('logout-btn').click());

  dialog.showModal();
  document.getElementById('terms-body').scrollTop = 0;

  return new Promise((resolve) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      submit.textContent = 'Saving…';
      alertBox.hidden = true;
      try {
        await api('/api/terms/accept', {
          method: 'POST',
          body: JSON.stringify({ signedName: nameInput.value.trim(), agree: agree.checked, version: t.version }),
        });
        dialog.close();
        resolve();
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.hidden = false;
        submit.textContent = 'Agree';
        update();
      }
    });
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  setupAppStrip();
  setupTabs();
  setupLogout();
  setupPasswordForm();

  let me;
  try {
    me = await api('/api/me');
    renderProfile(me.client);
    if (!me.terms.accepted) await requireTermsAcceptance(me.client);
  } catch (err) {
    if (err.message === 'Signed out') return;
    const box = document.getElementById('orders-error');
    box.textContent = T('We couldn’t load your account. {message} Please refresh to try again.', { message: T(err.message) });
    box.hidden = false;
    return;
  }

  await handlePaymentReturn();
  loadInvoices().catch((err) => {
    if (err.message !== 'Signed out') showPayNotice('error', T('We couldn’t load your invoices. {message}', { message: T(err.message) }));
  });

  try {
    const { orders } = await api('/api/orders');
    allOrders = orders;
    renderStats(orders);
    renderOrders();
  } catch (err) {
    if (err.message === 'Signed out') return;
    document.getElementById('orders-body').replaceChildren();
    const box = document.getElementById('orders-error');
    box.textContent = T('We couldn’t load your orders. {message} Please refresh to try again.', { message: T(err.message) });
    box.hidden = false;
  }
});
