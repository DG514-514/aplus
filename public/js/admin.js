'use strict';

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const STATUS_LABELS = { scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled' };

const state = { clients: [], orders: [], inquiries: [], editingOrder: null, editingClient: null };

const $ = (id) => document.getElementById(id);
const fmtDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child != null) node.append(child);
  return node;
}

async function api(path, method = 'GET', body) {
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });
  if (res.status === 401) {
    window.location.replace('/admin');
    throw new Error('Signed out');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

let toastTimer;
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

function formError(form, message) {
  const box = form.querySelector('.alert');
  box.textContent = message || '';
  box.hidden = !message;
}

async function refresh() {
  Object.assign(state, await api('/overview'));
  $('count-orders').textContent = state.orders.length || '';
  $('count-clients').textContent = state.clients.length || '';
  $('count-inquiries').textContent = state.inquiries.length || '';
  renderClientOptions();
  renderOrders();
  renderClients();
  renderInquiries();
}

/* ---------- Tabs ---------- */

function showView(view) {
  document.querySelectorAll('.admin-tabs .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${view}`; });
}

/* ---------- Orders ---------- */

function renderClientOptions() {
  const select = $('o-client');
  const current = select.value;
  select.replaceChildren(el('option', { value: '' }, state.clients.length ? 'Choose a client…' : 'Add a client first'));
  for (const c of state.clients) {
    select.append(el('option', { value: String(c.id) }, `${c.name} — ${c.email}`));
  }
  select.value = current;
}

function renderOrders() {
  const q = $('order-search').value.trim().toLowerCase();
  const rows = state.orders.filter((o) => !q
    || [o.client_name, o.order_number, o.service_type, o.plan, o.location].join(' ').toLowerCase().includes(q));
  const tbody = $('orders-body');
  tbody.replaceChildren();
  $('orders-empty').hidden = rows.length > 0;

  for (const o of rows) {
    const status = el('select', {
      class: `status-select badge-${o.status}`,
      'aria-label': `Status for ${o.order_number}`,
      onchange: async (e) => {
        try {
          await api(`/orders/${o.id}`, 'PATCH', { status: e.target.value });
          toast(`${o.order_number} marked ${STATUS_LABELS[e.target.value].toLowerCase()}.`);
          await refresh();
        } catch (err) { toast(err.message); }
      },
    });
    for (const [value, label] of Object.entries(STATUS_LABELS)) {
      const opt = el('option', { value }, label);
      if (value === o.status) opt.selected = true;
      status.append(opt);
    }

    tbody.append(el('tr', {},
      el('td', { 'data-label': 'Date' }, el('time', {}, fmtDate(o.service_date))),
      el('td', { 'data-label': 'Order', class: 'mono' }, o.order_number),
      el('td', { 'data-label': 'Client' }, o.client_name),
      el('td', { 'data-label': 'Service' }, el('div', {},
        el('strong', {}, o.service_type), el('span', { class: 'sub' }, `${o.plan} · ${o.location || '—'}`))),
      el('td', { 'data-label': 'Status' }, status),
      el('td', { 'data-label': 'Amount', class: 'num' }, money.format(o.amount_cents / 100)),
      el('td', {}, el('div', { class: 'row-actions' },
        el('button', { type: 'button', class: 'link-btn', onclick: () => editOrder(o) }, 'Edit'),
        el('button', { type: 'button', class: 'link-btn danger', onclick: () => deleteOrder(o) }, 'Delete')))));
  }
}

function resetOrderForm() {
  const form = $('order-form');
  form.reset();
  form.plan.value = 'Bi-Weekly';
  state.editingOrder = null;
  $('order-form-title').textContent = 'Add an order';
  $('order-submit').textContent = 'Add Order';
  $('order-cancel').hidden = true;
  form.clientId.disabled = false;
  formError(form, '');
}

function editOrder(o) {
  const form = $('order-form');
  state.editingOrder = o;
  form.clientId.value = String(o.client_id);
  form.clientId.disabled = true;
  form.date.value = o.service_date;
  form.service.value = o.service_type;
  form.plan.value = o.plan;
  form.amount.value = (o.amount_cents / 100).toFixed(2);
  form.status.value = o.status;
  form.location.value = o.location || '';
  form.notes.value = o.notes || '';
  $('order-form-title').textContent = `Edit order ${o.order_number}`;
  $('order-submit').textContent = 'Save Changes';
  $('order-cancel').hidden = false;
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteOrder(o) {
  if (!confirm(`Delete order ${o.order_number} for ${o.client_name}? This can’t be undone.`)) return;
  try {
    await api(`/orders/${o.id}`, 'DELETE');
    toast(`Order ${o.order_number} deleted.`);
    await refresh();
  } catch (err) { toast(err.message); }
}

async function submitOrder(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  try {
    if (state.editingOrder) {
      await api(`/orders/${state.editingOrder.id}`, 'PATCH', data);
      toast(`Order ${state.editingOrder.order_number} updated.`);
    } else {
      const { orderNumber } = await api('/orders', 'POST', data);
      toast(`Order ${orderNumber} added — it’s now visible in the client’s portal.`);
    }
    resetOrderForm();
    await refresh();
  } catch (err) { formError(form, err.message); }
}

/* ---------- Clients ---------- */

function renderClients() {
  const q = $('client-search').value.trim().toLowerCase();
  const rows = state.clients.filter((c) => !q
    || [c.name, c.email, c.residence, c.room, c.phone].join(' ').toLowerCase().includes(q));
  const tbody = $('clients-body');
  tbody.replaceChildren();
  $('clients-empty').hidden = rows.length > 0;

  for (const c of rows) {
    tbody.append(el('tr', {},
      el('td', { 'data-label': 'Client' }, el('div', {}, el('strong', {}, c.name), el('span', { class: 'sub' }, c.email))),
      el('td', { 'data-label': 'Residence' }, [c.residence, c.room && `Rm ${c.room}`].filter(Boolean).join(', ') || '—'),
      el('td', { 'data-label': 'Phone' }, c.phone || '—'),
      el('td', { 'data-label': 'Orders', class: 'num' }, String(c.order_count)),
      el('td', {}, el('div', { class: 'row-actions' },
        el('button', { type: 'button', class: 'link-btn', onclick: () => newOrderFor(c) }, 'Add Order'),
        el('button', { type: 'button', class: 'link-btn', onclick: () => editClient(c) }, 'Edit'),
        el('button', { type: 'button', class: 'link-btn', onclick: () => resetPassword(c) }, 'Reset Password'),
        el('button', { type: 'button', class: 'link-btn danger', onclick: () => deleteClient(c) }, 'Delete')))));
  }
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function resetClientForm() {
  const form = $('client-form');
  form.reset();
  state.editingClient = null;
  $('client-form-title').textContent = 'Add a client login';
  $('client-submit').textContent = 'Create Client Login';
  $('client-cancel').hidden = true;
  $('c-password-field').hidden = false;
  formError(form, '');
}

function editClient(c) {
  const form = $('client-form');
  state.editingClient = c;
  form.name.value = c.name;
  form.email.value = c.email;
  form.phone.value = c.phone || '';
  form.residence.value = c.residence || '';
  form.room.value = c.room || '';
  $('c-password-field').hidden = true;
  $('client-form-title').textContent = `Edit ${c.name}`;
  $('client-submit').textContent = 'Save Changes';
  $('client-cancel').hidden = false;
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function newOrderFor(c) {
  resetOrderForm();
  showView('orders');
  $('o-client').value = String(c.id);
  $('o-date').focus();
}

async function resetPassword(c) {
  const password = prompt(`New password for ${c.name} (at least 8 characters):`, generatePassword());
  if (password === null) return;
  try {
    await api(`/clients/${c.id}`, 'PATCH', { password });
    alert(`Password updated.\n\nSend ${c.name} their new login:\nEmail: ${c.email}\nPassword: ${password}`);
  } catch (err) { toast(err.message); }
}

async function deleteClient(c) {
  if (!confirm(`Delete ${c.name} and all ${c.order_count} of their orders? This can’t be undone.`)) return;
  try {
    await api(`/clients/${c.id}`, 'DELETE');
    toast(`${c.name} deleted.`);
    await refresh();
  } catch (err) { toast(err.message); }
}

async function submitClient(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  try {
    if (state.editingClient) {
      delete data.password;
      await api(`/clients/${state.editingClient.id}`, 'PATCH', data);
      toast(`${data.name} updated.`);
    } else {
      await api('/clients', 'POST', data);
      alert(`Client login created.\n\nSend ${data.name} their login:\nWebsite: ${location.origin}/login\nEmail: ${data.email.trim().toLowerCase()}\nPassword: ${data.password}\n\nThey can change the password after signing in.`);
    }
    resetClientForm();
    await refresh();
  } catch (err) { formError(form, err.message); }
}

/* ---------- Inquiries ---------- */

function renderInquiries() {
  const list = $('inquiries-list');
  list.replaceChildren();
  $('inquiries-empty').hidden = state.inquiries.length > 0;

  for (const inq of state.inquiries) {
    const received = new Date(inq.created_at.replace(' ', 'T') + 'Z').toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
    list.append(el('article', { class: 'inquiry' },
      el('div', { class: 'inquiry-head' },
        el('strong', {}, inq.name),
        el('span', { class: 'sub' }, received)),
      el('p', {},
        el('a', { href: `mailto:${inq.email}` }, inq.email),
        inq.phone ? ` · ${inq.phone}` : null),
      el('p', { class: 'sub' }, [inq.plan, inq.residence].filter(Boolean).join(' · ') || ''),
      inq.message ? el('p', { class: 'inquiry-msg' }, inq.message) : null,
      el('div', { class: 'row-actions' },
        el('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => clientFromInquiry(inq) }, 'Create Client Login'),
        el('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => archiveInquiry(inq) }, 'Archive'))));
  }
}

function clientFromInquiry(inq) {
  resetClientForm();
  showView('clients');
  const form = $('client-form');
  form.name.value = inq.name;
  form.email.value = inq.email;
  form.phone.value = inq.phone || '';
  form.residence.value = inq.residence || '';
  form.password.value = generatePassword();
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function archiveInquiry(inq) {
  if (!confirm(`Archive the request from ${inq.name}? It will be removed from this list.`)) return;
  try {
    await api(`/inquiries/${inq.id}`, 'DELETE');
    await refresh();
  } catch (err) { toast(err.message); }
}

/* ---------- Init ---------- */

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.admin-tabs .tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
  $('order-form').addEventListener('submit', submitOrder);
  $('client-form').addEventListener('submit', submitClient);
  $('order-cancel').addEventListener('click', resetOrderForm);
  $('client-cancel').addEventListener('click', resetClientForm);
  $('order-search').addEventListener('input', renderOrders);
  $('client-search').addEventListener('input', renderClients);
  $('gen-password').addEventListener('click', () => { $('c-password').value = generatePassword(); });
  $('logout-btn').addEventListener('click', async () => {
    try { await api('/logout', 'POST'); } finally { window.location.assign('/admin'); }
  });

  try {
    await refresh();
  } catch (err) {
    if (err.message !== 'Signed out') toast(`Couldn’t load data: ${err.message}`);
  }
});
