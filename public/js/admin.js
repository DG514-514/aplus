'use strict';

const money = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const STATUS_LABELS = { scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled' };

const state = {
  clients: [], orders: [], inquiries: [], invoices: [], payments: {},
  editingOrder: null, editingClient: null, invoiceInquiry: null, pendingInquiry: null,
};

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
  $('count-inquiries').textContent = state.inquiries.filter((i) => !i.invoice_number).length || '';
  $('count-invoices').textContent = state.invoices.filter((i) => i.status === 'open').length || '';
  renderClientOptions();
  renderOrders();
  renderClients();
  renderInquiries();
  renderInvoices();
  renderPaymentsStatus();
}

/* ---------- Tabs ---------- */

function showView(view) {
  document.querySelectorAll('.admin-tabs .tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${view}`; });
}

/* ---------- Orders ---------- */

const NEW_CLIENT = '__new';

function renderClientOptions() {
  for (const select of [$('o-client'), $('i-client')]) {
    const current = select.value;
    select.replaceChildren(
      el('option', { value: '' }, 'Choose a client…'),
      el('option', { value: NEW_CLIENT, class: 'add-new' }, '+ Add new client…'));
    for (const c of state.clients) {
      select.append(el('option', { value: String(c.id) }, `${c.name} — ${c.email}`));
    }
    select.value = current === NEW_CLIENT ? '' : current;
    select.dataset.previous = select.value;
  }
}

/* ---------- Add a client from a dropdown ---------- */

let newClientTarget = null;

function openNewClientDialog(select) {
  newClientTarget = select;
  const form = $('new-client-form');
  form.reset();
  formError(form, '');
  form.password.value = generatePassword();
  $('new-client-dialog').showModal();
  form.name.focus();
}

function closeNewClientDialog() {
  $('new-client-dialog').close();
  // Cancelled: put the dropdown back to what it was.
  if (newClientTarget && newClientTarget.value === NEW_CLIENT) {
    newClientTarget.value = newClientTarget.dataset.previous || '';
  }
  newClientTarget = null;
}

async function submitNewClient(e) {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  const btn = $('nc-submit');
  btn.disabled = true;
  try {
    const { id } = await api('/clients', 'POST', data);
    const target = newClientTarget;
    await refresh();
    if (target) {
      target.value = String(id);
      target.dataset.previous = target.value;
    }
    newClientTarget = null;
    $('new-client-dialog').close();
    alert(`Client login created.\n\nSend ${data.name} their login:\nWebsite: ${location.origin}/login\nEmail: ${data.email.trim().toLowerCase()}\nPassword: ${data.password}\n\nThey can change the password after signing in.`);
  } catch (err) {
    formError(form, err.message);
  } finally {
    btn.disabled = false;
  }
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
        el('button', { type: 'button', class: 'link-btn', onclick: () => openInvoiceFor(c) }, 'Invoice'),
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
  state.pendingInquiry = null;
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
    const pending = state.pendingInquiry;
    resetClientForm();
    await refresh();
    if (pending) {
      const client = state.clients.find((c) => c.email.toLowerCase() === data.email.trim().toLowerCase());
      if (client) openInvoiceFor(client, pending);
    }
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
        inq.invoice_number
          ? el('span', { class: 'chip' }, `✓ Invoiced ${inq.invoice_number}`)
          : el('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => approveInquiry(inq) }, 'Approve & Invoice'),
        el('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => clientFromInquiry(inq) }, 'Create Client Login'),
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

// Approving a quote: make sure the client has a login, then open a pre-filled invoice.
function approveInquiry(inq) {
  const existing = state.clients.find((c) => c.email.toLowerCase() === inq.email.toLowerCase());
  if (existing) {
    openInvoiceFor(existing, inq);
    return;
  }
  clientFromInquiry(inq);
  state.pendingInquiry = inq;
  toast('First create their client login — the invoice form opens next.');
}

async function archiveInquiry(inq) {
  if (!confirm(`Archive the request from ${inq.name}? It will be removed from this list.`)) return;
  try {
    await api(`/inquiries/${inq.id}`, 'DELETE');
    await refresh();
  } catch (err) { toast(err.message); }
}

/* ---------- Invoices ---------- */

const todayIso = () => new Date().toLocaleDateString('en-CA');

// "14:00" → "2:00 p.m."
const fmtTime = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
};
const addDaysIso = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
};

function renderPaymentsStatus() {
  const box = $('payments-status');
  const p = state.payments || {};
  box.classList.toggle('warn', !p.configured);
  if (!p.configured) {
    box.textContent = '⚠️ Online card payments aren’t connected yet (add STRIPE_SECRET_KEY in Render → Environment). You can still send invoices and mark them paid by hand.';
  } else {
    box.textContent = p.mode === 'live'
      ? '✅ Stripe connected — clients can pay invoices by card.'
      : '🧪 Stripe connected in TEST mode — use card 4242 4242 4242 4242 to try it. No real money moves.';
  }
}

function addItemRow(description = '', amount = '') {
  const row = el('div', { class: 'item-row' },
    el('input', { class: 'item-desc', placeholder: 'Description, e.g. Bi-Weekly dorm cleaning (October)', 'aria-label': 'Description', value: description, oninput: updateInvoiceTotal }),
    el('input', { class: 'item-amount', type: 'number', min: '0', step: '0.01', placeholder: 'Amount $', 'aria-label': 'Amount', value: amount, oninput: updateInvoiceTotal }),
    el('button', {
      type: 'button', class: 'link-btn danger', 'aria-label': 'Remove line item',
      onclick: () => { if ($('invoice-items').children.length > 1) row.remove(); updateInvoiceTotal(); },
    }, '✕'));
  $('invoice-items').append(row);
  updateInvoiceTotal();
  return row;
}

function readItems() {
  return [...$('invoice-items').querySelectorAll('.item-row')].map((row) => ({
    description: row.querySelector('.item-desc').value.trim(),
    amount: row.querySelector('.item-amount').value,
  })).filter((item) => item.description || item.amount);
}

function updateInvoiceTotal() {
  const total = readItems().reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  $('invoice-total').textContent = money.format(total);
}

function resetInvoiceForm() {
  const form = $('invoice-form');
  form.reset();
  $('i-email').checked = true;
  $('i-due').value = addDaysIso(7);
  $('invoice-items').replaceChildren();
  addItemRow();
  state.invoiceInquiry = null;
  formError(form, '');
}

function openInvoiceFor(client, inquiry = null) {
  resetInvoiceForm();
  showView('invoices');
  $('i-client').value = String(client.id);
  state.invoiceInquiry = inquiry;
  if (inquiry) {
    const desc = [inquiry.plan && `${inquiry.plan} cleaning`, inquiry.residence].filter(Boolean).join(' — ');
    $('invoice-items').querySelector('.item-desc').value = desc || 'Cleaning service';
  }
  $('invoice-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('invoice-items').querySelector('.item-amount').focus({ preventScroll: true });
}

async function submitInvoice(e) {
  e.preventDefault();
  const form = e.target;
  const btn = $('invoice-submit');
  formError(form, '');
  btn.disabled = true;
  try {
    const { invoiceNumber, email } = await api('/invoices', 'POST', {
      clientId: $('i-client').value,
      dueDate: $('i-due').value,
      serviceDate: $('i-service-date').value,
      serviceTime: $('i-service-time').value,
      notes: $('i-notes').value,
      items: readItems(),
      inquiryId: state.invoiceInquiry?.id,
      sendEmail: $('i-email').checked,
    });
    resetInvoiceForm();
    await refresh();
    if (email === 'sent' || email === 'skipped') {
      toast(`Invoice ${invoiceNumber} ${email === 'sent' ? 'sent — the client has been emailed' : 'created'}. It’s in their portal now.`);
    } else {
      alert(`Invoice ${invoiceNumber} was created and is in the client’s portal, but the email to them didn’t send:\n\n${email}\n\nYou can let them know to sign in and pay.`);
    }
  } catch (err) {
    formError(form, err.message);
  } finally {
    btn.disabled = false;
  }
}

function invoiceStatus(inv) {
  if (inv.status === 'paid') return ['paid', `Paid${inv.paid_method && inv.paid_method !== 'stripe' ? ` (${inv.paid_method})` : ''}`];
  if (inv.status === 'void') return ['void', 'Void'];
  if (inv.due_date && inv.due_date < todayIso()) return ['overdue', 'Overdue'];
  return ['open', 'Unpaid'];
}

function renderInvoices() {
  const q = $('invoice-search').value.trim().toLowerCase();
  const rows = state.invoices.filter((i) => !q
    || [i.invoice_number, i.client_name, i.client_email, ...i.items.map((it) => it.description)].join(' ').toLowerCase().includes(q));
  const tbody = $('invoices-body');
  tbody.replaceChildren();
  $('invoices-empty').hidden = rows.length > 0;

  for (const inv of rows) {
    const [cls, label] = invoiceStatus(inv);
    const actions = el('div', { class: 'row-actions' });
    if (inv.status === 'open') {
      actions.append(
        el('button', { type: 'button', class: 'link-btn', onclick: () => markInvoicePaid(inv) }, 'Mark Paid'),
        el('button', { type: 'button', class: 'link-btn danger', onclick: () => voidInvoice(inv) }, 'Void'));
    }
    if (inv.receipt_url) actions.append(el('a', { class: 'link-btn', href: inv.receipt_url, target: '_blank', rel: 'noopener' }, 'Receipt'));

    tbody.append(el('tr', {},
      el('td', { 'data-label': 'Invoice', class: 'mono' }, inv.invoice_number),
      el('td', { 'data-label': 'Client' }, el('div', {},
        el('strong', {}, inv.client_name),
        el('span', { class: 'sub' }, inv.items.map((it) => it.description).join(', ')))),
      el('td', { 'data-label': 'Service' }, inv.service_date
        ? el('div', {}, el('strong', {}, fmtDate(inv.service_date)),
          inv.service_time ? el('span', { class: 'sub' }, fmtTime(inv.service_time)) : null)
        : el('span', { class: 'sub' }, `Sent ${fmtDate(inv.created_at.slice(0, 10))}`)),
      el('td', { 'data-label': 'Due' }, inv.due_date ? fmtDate(inv.due_date) : '—'),
      el('td', { 'data-label': 'Status' }, el('span', { class: `badge badge-${cls}` }, label)),
      el('td', { 'data-label': 'Total', class: 'num' }, money.format(inv.amount_cents / 100)),
      el('td', {}, actions)));
  }
}

async function markInvoicePaid(inv) {
  const method = prompt(`Mark ${inv.invoice_number} (${money.format(inv.amount_cents / 100)}) as paid.\n\nHow was it paid? (e.g. e-transfer, cash, cheque)`, 'e-transfer');
  if (method === null) return;
  try {
    await api(`/invoices/${inv.id}/mark-paid`, 'POST', { method: method.trim() || 'manual' });
    toast(`${inv.invoice_number} marked paid.`);
    await refresh();
  } catch (err) { toast(err.message); }
}

async function voidInvoice(inv) {
  if (!confirm(`Void ${inv.invoice_number} for ${inv.client_name}? It will disappear from their portal and can’t be paid.`)) return;
  try {
    await api(`/invoices/${inv.id}/void`, 'POST');
    toast(`${inv.invoice_number} voided.`);
    await refresh();
  } catch (err) { toast(err.message); }
}

/* ---------- Email alerts ---------- */

async function loadEmailStatus() {
  const box = $('email-status');
  try {
    const st = await api('/email-status');
    const lines = [];
    if (!st.keySet) {
      lines.push('⚠️ Not set up: RESEND_API_KEY is missing in Render → Environment.');
    } else {
      lines.push(`Alerts go to ${st.to.join(', ')} (sent from ${st.from}).`);
    }
    if (st.last.at) {
      const when = new Date(st.last.at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
      lines.push(`${st.last.ok ? '✅ Last email sent' : '❌ Last email failed'} ${when}: ${st.last.message}`);
    }
    box.textContent = lines.join('\n');
  } catch (err) {
    box.textContent = `Couldn’t check email settings: ${err.message}`;
  }
}

async function sendTestEmail() {
  const btn = $('email-test-btn');
  const result = $('email-result');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const { message } = await api('/email-test', 'POST');
    result.className = 'alert alert-success';
    result.textContent = message;
  } catch (err) {
    result.className = 'alert alert-error';
    result.textContent = err.message;
  } finally {
    result.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Send Test Email';
    loadEmailStatus();
  }
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
  $('email-test-btn').addEventListener('click', sendTestEmail);
  $('invoice-form').addEventListener('submit', submitInvoice);
  for (const select of [$('o-client'), $('i-client')]) {
    select.addEventListener('change', () => {
      if (select.value === NEW_CLIENT) openNewClientDialog(select);
      else select.dataset.previous = select.value;
    });
  }
  $('new-client-form').addEventListener('submit', submitNewClient);
  $('nc-cancel').addEventListener('click', closeNewClientDialog);
  $('new-client-dialog').addEventListener('cancel', (e) => { e.preventDefault(); closeNewClientDialog(); });
  $('nc-gen').addEventListener('click', () => { $('nc-password').value = generatePassword(); });
  $('add-item').addEventListener('click', () => addItemRow().querySelector('.item-desc').focus());
  $('invoice-search').addEventListener('input', renderInvoices);
  resetInvoiceForm();
  $('gen-password').addEventListener('click', () => { $('c-password').value = generatePassword(); });
  $('logout-btn').addEventListener('click', async () => {
    try { await api('/logout', 'POST'); } finally { window.location.assign('/admin'); }
  });

  loadEmailStatus();
  try {
    await refresh();
  } catch (err) {
    if (err.message !== 'Signed out') toast(`Couldn’t load data: ${err.message}`);
  }
});
