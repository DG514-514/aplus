'use strict';

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const STATUS_LABELS = { scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled' };

// service_date is a plain YYYY-MM-DD; parse as a local date so it doesn't shift by timezone.
const parseDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const fmtDate = (iso, opts = { month: 'short', day: 'numeric', year: 'numeric' }) =>
  parseDate(iso).toLocaleDateString('en-CA', opts);
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
  document.getElementById('greeting').textContent = `Welcome back, ${first}`;
  document.getElementById('user-name').textContent = client.name;
  document.getElementById('avatar').textContent = client.name
    .split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  document.getElementById('pw-username').value = client.email;

  const where = [client.residence, client.room && `Room ${client.room}`].filter(Boolean).join(' · ');
  document.getElementById('location-line').textContent = where;

  const details = document.getElementById('account-details');
  details.replaceChildren();
  const rows = [
    ['Name', client.name],
    ['Email', client.email],
    ['Phone', client.phone || '—'],
    ['Residence', where || '—'],
    ['Client since', new Date(client.created_at.replace(' ', 'T') + 'Z')
      .toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })],
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
    ? `${upcoming.length} upcoming visit${upcoming.length === 1 ? '' : 's'}`
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
      ? `No ${currentFilter === 'scheduled' ? 'upcoming' : currentFilter} orders.`
      : 'You don’t have any orders yet. Once your first clean is booked it will appear here.';
    return;
  }

  for (const o of rows) {
    const service = el('td', { 'data-label': 'Service' }, el('div', {},
      el('strong', {}, o.service_type),
      el('span', { class: 'sub' }, `${o.plan} plan`),
      o.notes ? el('span', { class: 'note' }, o.notes) : null));

    tbody.append(el('tr', { class: `status-${o.status}` },
      el('td', { 'data-label': 'Date' }, el('time', { datetime: o.service_date }, fmtDate(o.service_date))),
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

document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupLogout();
  setupPasswordForm();

  try {
    const [{ client }, { orders }] = await Promise.all([api('/api/me'), api('/api/orders')]);
    allOrders = orders;
    renderProfile(client);
    renderStats(orders);
    renderOrders();
  } catch (err) {
    if (err.message === 'Signed out') return;
    document.getElementById('orders-body').replaceChildren();
    const box = document.getElementById('orders-error');
    box.textContent = `We couldn’t load your orders. ${err.message} Please refresh to try again.`;
    box.hidden = false;
  }
});
