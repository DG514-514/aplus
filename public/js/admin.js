'use strict';

const CURRENCY = ((window.APLUS && window.APLUS.currency) || 'usd').toUpperCase();
const money = new Intl.NumberFormat(CURRENCY === 'CAD' ? 'en-CA' : 'en-US', { style: 'currency', currency: CURRENCY });
const STATUS_LABELS = { scheduled: 'Scheduled', completed: 'Completed', cancelled: 'Cancelled' };

const state = {
  clients: [], orders: [], inquiries: [], invoices: [], cleaners: [], payments: {}, editingCleaner: null,
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
  $('count-inquiries').textContent = state.inquiries.filter((i) => !i.invoice_number && !i.declined_at).length || '';
  renderClientOptions();
  renderOrders();
  renderClients();
  renderInquiries();
  renderInvoices();
  renderCleaners();
  renderPaymentsStatus();
  // Lets other dashboard scripts (Jobs) refresh their client/supplier dropdowns.
  document.dispatchEvent(new Event('admin:data'));
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
      el('td', { 'data-label': 'Date' }, el('time', {}, fmtDate(o.service_date)), o.service_time ? el('span', { class: 'sub' }, fmtClock(o.service_time)) : null),
      el('td', { 'data-label': 'Order', class: 'mono' }, o.order_number),
      el('td', { 'data-label': 'Client' }, clientLink(o.client_id, o.client_name)),
      el('td', { 'data-label': 'Service' }, el('div', {},
        el('strong', {}, o.service_type), el('span', { class: 'sub' }, `${o.plan} · ${o.location || '—'}`),
        o.admin_notes ? el('span', { class: 'row-note' }, `📝 ${o.admin_notes}`) : null)),
      el('td', { 'data-label': 'Status' }, status),
      el('td', { 'data-label': 'Amount', class: 'num' }, money.format(o.amount_cents / 100)),
      el('td', {}, el('div', { class: 'row-actions' },
        orderInvoiceAction(o),
        el('button', { type: 'button', class: 'link-btn', onclick: () => openNotes('order', o) }, o.admin_notes ? 'Notes ✎' : 'Add Note'),
        el('button', { type: 'button', class: 'link-btn', onclick: () => editOrder(o) }, 'Edit'),
        el('button', { type: 'button', class: 'link-btn danger', onclick: () => deleteOrder(o) }, 'Delete')))));
  }
}

// The order form uses the same service presets as invoices: picking one fills the description and price.
const fmtClock = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }); };

function fillOrderServicePicker() {
  const pick = $('o-service-pick');
  if (pick.options.length) return;
  pick.replaceChildren(el('option', { value: '' }, 'Choose a service…'),
    ...SERVICES.map((s) => el('option', { value: s.id }, s.name)), el('option', { value: 'custom' }, 'Custom service…'));
  pick.addEventListener('change', () => {
    const service = SERVICES.find((s) => s.id === pick.value);
    if (service) {
      $('o-service').value = service.name;
      $('o-amount').value = service.price.toFixed(2);
    } else if (pick.value === 'custom') {
      $('o-service').value = '';
      $('o-service').focus();
    }
  });
}

// Standard service matching a client's (or quote request's) bedrooms/bathrooms, if any.
function serviceForRooms(src) {
  if (!src) return null;
  if (src.bedrooms === 'Studio') return SERVICES.find((s) => s.id === 'studio');
  return SERVICES.find((s) => s.bedrooms && s.bedrooms === src.bedrooms && s.bathrooms === src.bathrooms) || null;
}

function resetOrderForm() {
  const form = $('order-form');
  form.reset();
  form.plan.value = 'Bi-Weekly';
  fillOrderServicePicker();
  $('o-service-pick').value = '';
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
  form.time.value = o.service_time || '';
  fillOrderServicePicker();
  $('o-service-pick').value = SERVICES.find((s) => s.name === o.service_type)?.id || 'custom';
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

/* ---------- Account requests from the website ---------- */

function renderPending() {
  const pending = state.clients.filter((c) => c.status === 'pending');
  $('pending-panel').hidden = pending.length === 0;
  $('pending-count').textContent = pending.length || '';
  const list = $('pending-list');
  list.replaceChildren();
  for (const c of pending) {
    const when = new Date(`${c.created_at.replace(' ', 'T')}Z`).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const place = [c.residence, c.room && `Unit ${c.room}`].filter(Boolean).join(', ');
    const size = [c.bedrooms && (c.bedrooms === 'Studio' ? 'Studio' : `${c.bedrooms} bed`), c.bathrooms && `${c.bathrooms} bath`].filter(Boolean).join(' · ');
    const approve = el('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: (e) => approveAccount(c, e.currentTarget) }, 'Approve');
    list.append(el('article', { class: 'inquiry pending-card' },
      el('div', { class: 'inquiry-head' }, el('strong', {}, c.name), el('span', { class: 'sub' }, `Requested ${when}`)),
      el('p', {}, el('a', { href: `mailto:${c.email}` }, c.email), c.phone ? ` · ${c.phone}` : ''),
      place ? el('p', {}, `🏠 ${place}`) : null,
      size ? el('p', { class: 'sub' }, size) : null,
      c.signup_note ? el('p', { class: 'inquiry-msg' }, c.signup_note) : null,
      el('div', { class: 'row-actions' },
        approve,
        el('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => openDeclineDialog(c, 'account') }, 'Decline'))));
  }
}

async function approveAccount(c, btn) {
  btn.disabled = true;
  btn.textContent = 'Approving…';
  try {
    const result = await api(`/clients/${c.id}/approve`, 'POST');
    await refresh();
    if (result.emailed) toast(`${c.name} approved and emailed — they can sign in now.`);
    else alert(`${c.name} is approved and can sign in now, but the email didn’t send${result.emailError ? `:\n\n${result.emailError}` : '.'}\n\nLet them know directly.`);
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
    btn.textContent = 'Approve';
  }
}

function renderClients() {
  const q = $('client-search').value.trim().toLowerCase();
  renderPending();
  const rows = state.clients.filter((c) => c.status !== 'pending').filter((c) => !q
    || [c.name, c.email, c.residence, c.room, c.phone].join(' ').toLowerCase().includes(q));
  const tbody = $('clients-body');
  tbody.replaceChildren();
  $('clients-empty').hidden = rows.length > 0;

  for (const c of rows) {
    tbody.append(el('tr', {},
      el('td', { 'data-label': 'Client' }, el('div', {}, clientLink(c.id, c.name, true), el('span', { class: 'sub' }, c.email))),
      el('td', { 'data-label': 'Residence' }, [c.residence, c.room && `Rm ${c.room}`].filter(Boolean).join(', ') || '—'),
      el('td', { 'data-label': 'Phone' }, c.phone || '—'),
      el('td', { 'data-label': 'Orders', class: 'num' }, String(c.order_count)),
      el('td', { 'data-label': 'Terms' }, termsCell(c)),
      el('td', {}, el('div', { class: 'row-actions' },
        el('button', { type: 'button', class: 'link-btn', onclick: () => newOrderFor(c) }, 'Add Order'),
        el('button', { type: 'button', class: 'link-btn', onclick: () => openInvoiceFor(c) }, 'Invoice'),
        el('button', { type: 'button', class: 'link-btn', onclick: () => editClient(c) }, 'Edit'),
        el('button', { type: 'button', class: 'link-btn', onclick: () => resetPassword(c) }, 'Reset Password'),
        el('button', { type: 'button', class: 'link-btn danger', onclick: () => deleteClient(c) }, 'Delete')))));
  }
}

// Signed Terms & Conditions status, with a link to the printable signed copy.
function termsCell(c) {
  if (!c.terms_id) return el('span', { class: 'badge badge-scheduled', title: 'Asked to agree at their first sign-in' }, 'Not signed yet');
  const signed = new Date(`${c.terms_accepted_at.replace(' ', 'T')}Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  return el('div', {},
    el('span', { class: `badge ${c.terms_current ? 'badge-completed' : 'badge-scheduled'}` }, c.terms_current ? `✓ Signed ${signed}` : 'Old version — re-sign pending'),
    el('a', { class: 'terms-link', href: `/admin/agreements/${c.terms_id}`, target: '_blank', rel: 'noopener' }, 'View signed copy'));
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
  // Same pre-fill as the invoice form: pick the standard service for the client's unit size.
  const match = serviceForRooms(c);
  if (match) {
    $('o-service-pick').value = match.id;
    $('o-service-pick').dispatchEvent(new Event('change'));
  }
  $('order-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('o-date').focus({ preventScroll: true });
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

// "2 bed / 1.5 bath" from a quote request's room counts.
function roomSummary(inq) {
  return [inq.bedrooms && `${inq.bedrooms} bed`, inq.bathrooms && `${inq.bathrooms} bath`].filter(Boolean).join(' / ');
}

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
      el('p', { class: 'sub' }, [inq.plan, inq.residence, roomSummary(inq)].filter(Boolean).join(' · ') || ''),
      inq.message ? el('p', { class: 'inquiry-msg' }, inq.message) : null,
      inq.declined_at
        ? el('p', { class: 'decline-note' }, el('strong', {}, 'Reason given: '), inq.decline_reason || '(no reason recorded)')
        : null,
      el('div', { class: 'row-actions' }, ...inquiryActions(inq))));
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

function inquiryActions(inq) {
  const archive = el('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => archiveInquiry(inq) }, 'Archive');
  if (inq.invoice_number) return [el('span', { class: 'chip' }, `✓ Invoiced ${inq.invoice_number}`), archive];
  if (inq.declined_at) {
    const when = new Date(inq.declined_at.replace(' ', 'T') + 'Z').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
    return [el('span', { class: 'chip chip-declined' }, `✕ Declined ${when}`), archive];
  }
  return [
    el('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => approveInquiry(inq) }, 'Approve & Invoice'),
    el('button', { type: 'button', class: 'btn btn-danger-outline btn-sm', onclick: () => openDeclineDialog(inq) }, 'Decline'),
    el('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => clientFromInquiry(inq) }, 'Create Client Login'),
    archive,
  ];
}

/* ---------- Declining a quote request ---------- */

let decliningInquiry = null;

// Declines either a website quote request ('inquiry') or a website account request ('account').
let declineKind = 'inquiry';
function openDeclineDialog(item, kind = 'inquiry') {
  decliningInquiry = item;
  declineKind = kind;
  const form = $('decline-form');
  form.reset();
  formError(form, '');
  $('dc-email').checked = true;
  $('dc-title').textContent = kind === 'account' ? 'Decline account request' : 'Decline quote request';
  $('dc-preview').textContent = kind === 'account'
    ? '“Thank you for signing up with A+ Cleaning Solutions. Unfortunately, we’re unable to open an account for you at this time.”'
    : '“Thank you for your interest in A+ Cleaning Solutions. Unfortunately, we’re unable to take on your cleaning request at this time.”';
  $('dc-who').textContent = `${item.name} · ${item.email}`;
  $('decline-dialog').showModal();
  $('dc-reason').focus();
}

function closeDeclineDialog() {
  $('decline-dialog').close();
  decliningInquiry = null;
}

async function submitDecline(e) {
  e.preventDefault();
  const form = e.target;
  const reason = $('dc-reason').value.trim();
  const sendEmail = $('dc-email').checked;
  if (sendEmail && !reason) {
    formError(form, 'Add a reason to include in the email, or untick “Email the reason to the customer”.');
    return;
  }
  const inq = decliningInquiry;
  const btn = $('dc-submit');
  btn.disabled = true;
  if (declineKind === 'account') {
    try {
      const result = await api(`/clients/${inq.id}/decline`, 'POST', { reason, sendEmail });
      closeDeclineDialog();
      await refresh();
      if (!sendEmail) toast(`${inq.name}’s account request was declined.`);
      else if (result.emailed) toast(`Declined — ${inq.name} has been emailed.`);
      else alert(`The account request was declined, but the email didn’t send:\n\n${result.emailError || 'Unknown error'}`);
    } catch (err) {
      formError(form, err.message);
    } finally {
      btn.disabled = false;
    }
    return;
  }
  try {
    const { email } = await api(`/inquiries/${inq.id}/decline`, 'POST', { reason, sendEmail });
    closeDeclineDialog();
    await refresh();
    if (email === 'sent') toast(`Declined — ${inq.name} has been emailed.`);
    else if (email === 'skipped') toast(`${inq.name}’s request marked as declined.`);
    else alert(`The request was marked as declined, but the email didn’t send:\n\n${email}`);
  } catch (err) {
    formError(form, err.message);
  } finally {
    btn.disabled = false;
  }
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

// Standard services offered in the line-item dropdown (prices in dollars).
const SERVICES = [
  { id: 'studio', name: 'Studio Standard Clean', price: 110 },
  { id: '1b1b', name: '1 Bedroom / 1 Bathroom Standard Clean', price: 140, bedrooms: '1', bathrooms: '1' },
  { id: '2b2b', name: '2 Bedroom / 2 Bathroom Standard Clean', price: 160, bedrooms: '2', bathrooms: '2' },
  { id: '4b4b', name: '4 Bedroom / 4 Bathroom Standard Clean', price: 220, bedrooms: '4', bathrooms: '4' },
];

function applyService(row, serviceId) {
  const service = SERVICES.find((s) => s.id === serviceId);
  if (!service) return;
  row.querySelector('.item-desc').value = service.name;
  row.querySelector('.item-amount').value = service.price.toFixed(2);
  updateInvoiceTotal();
}

function addItemRow(description = '', amount = '') {
  const picker = el('select', { class: 'item-service', 'aria-label': 'Service' },
    el('option', { value: '' }, 'Choose a service…'),
    ...SERVICES.map((s) => el('option', { value: s.id }, s.name)),
    el('option', { value: 'custom' }, 'Custom item…'));
  const row = el('div', { class: 'item-row' },
    picker,
    el('input', { class: 'item-desc', placeholder: 'Description, e.g. Bi-Weekly dorm cleaning (October)', 'aria-label': 'Description', value: description, oninput: updateInvoiceTotal }),
    el('input', { class: 'item-amount', type: 'number', min: '0', step: '0.01', placeholder: 'Amount $', 'aria-label': 'Amount', value: amount, oninput: updateInvoiceTotal }),
    el('button', {
      type: 'button', class: 'link-btn danger', 'aria-label': 'Remove line item',
      onclick: () => { if ($('invoice-items').children.length > 1) row.remove(); updateInvoiceTotal(); },
    }, '✕'));
  picker.addEventListener('change', () => {
    if (picker.value === 'custom') {
      row.querySelector('.item-desc').value = '';
      row.querySelector('.item-amount').value = '';
      row.querySelector('.item-desc').focus();
      updateInvoiceTotal();
    } else {
      applyService(row, picker.value);
    }
  });
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
  state.invoiceOrder = null;
  $('invoice-order-note').hidden = true;
  formError(form, '');
}

function openInvoiceFor(client, inquiry = null) {
  resetInvoiceForm();
  showView('invoices');
  $('i-client').value = String(client.id);
  state.invoiceInquiry = inquiry;
  if (!inquiry && serviceForRooms(client)) {
    const row = $('invoice-items').querySelector('.item-row');
    const match = serviceForRooms(client);
    row.querySelector('.item-service').value = match.id;
    applyService(row, match.id);
  }
  if (inquiry) {
    const row = $('invoice-items').querySelector('.item-row');
    // Pre-pick the standard service matching the requested bedrooms/bathrooms, if there is one.
    const match = SERVICES.find((s) => s.bedrooms && s.bedrooms === inquiry.bedrooms && s.bathrooms === inquiry.bathrooms);
    if (match) {
      row.querySelector('.item-service').value = match.id;
      applyService(row, match.id);
      if (inquiry.residence) row.querySelector('.item-desc').value += ` — ${inquiry.residence}`;
    } else {
      const size = roomSummary(inquiry);
      const desc = [inquiry.plan && `${inquiry.plan} cleaning`, inquiry.residence].filter(Boolean).join(' — ')
        + (size ? ` (${size})` : '');
      row.querySelector('.item-desc').value = desc || 'Cleaning service';
    }
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
      orderId: state.invoiceOrder?.id,
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
  if (inv.status === 'void') return inv.refunded_at ? ['void', 'Cancelled · Refunded'] : ['void', 'Cancelled'];
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
        el('button', { type: 'button', class: 'link-btn danger', onclick: () => openCancelInvoice(inv) }, 'Cancel'));
    }
    if (inv.status === 'paid') actions.append(el('button', { type: 'button', class: 'link-btn danger', onclick: () => openCancelInvoice(inv) }, 'Cancel / Refund'));
    actions.prepend(el('button', { type: 'button', class: 'link-btn', onclick: () => openNotes('invoice', inv) }, inv.admin_notes ? 'Notes ✎' : 'Add Note'));
    if (inv.receipt_url) actions.append(el('a', { class: 'link-btn', href: inv.receipt_url, target: '_blank', rel: 'noopener' }, 'Receipt'));

    tbody.append(el('tr', {},
      el('td', { 'data-label': 'Invoice', class: 'mono' }, inv.invoice_number),
      el('td', { 'data-label': 'Client' }, el('div', {},
        clientLink(inv.client_id, inv.client_name, true),
        el('span', { class: 'sub' }, inv.items.map((it) => it.description).join(', ')),
        inv.cancel_reason ? el('span', { class: 'row-note cancel' }, `Cancelled: ${inv.cancel_reason}`) : null,
        inv.admin_notes ? el('span', { class: 'row-note' }, `📝 ${inv.admin_notes}`) : null)),
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

/* ---------- Invoicing an order ---------- */

function orderInvoiceAction(o) {
  if (o.invoice_number) {
    const paid = o.invoice_status === 'paid';
    return el('button', {
      type: 'button', class: `invoiced-pill ${paid ? 'paid' : 'due'}`, title: 'Show this invoice',
      onclick: () => { closeClientFile(); showView('invoices'); $('invoice-search').value = o.invoice_number; renderInvoices(); },
    }, `${o.invoice_number} · ${paid ? 'Paid' : 'Invoiced'}`);
  }
  return el('button', { type: 'button', class: 'link-btn', onclick: () => invoiceFromOrder(o) }, 'Invoice');
}

// Opens Send an invoice pre-filled from the order: client, service line, amount, service date and time.
function invoiceFromOrder(o) {
  closeClientFile();
  resetInvoiceForm();
  showView('invoices');
  state.invoiceOrder = o;
  $('i-client').value = String(o.client_id);
  $('i-service-date').value = o.service_date;
  $('i-service-time').value = o.service_time || '';
  const row = $('invoice-items').querySelector('.item-row');
  const preset = SERVICES.find((s) => s.name === o.service_type);
  row.querySelector('.item-service').value = preset ? preset.id : 'custom';
  row.querySelector('.item-desc').value = o.plan && o.plan !== 'One-Time' ? `${o.service_type} (${o.plan})` : o.service_type;
  row.querySelector('.item-amount').value = (o.amount_cents / 100).toFixed(2);
  updateInvoiceTotal();
  $('invoice-order-note').textContent = `Invoicing order ${o.order_number} — ${fmtDate(o.service_date)}. The order will show as invoiced.`;
  $('invoice-order-note').hidden = false;
  $('invoice-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- Client file: everything about one client ---------- */

function clientLink(id, name, strong = false) {
  return el('button', { type: 'button', class: `client-link${strong ? ' strong' : ''}`, title: 'Open client file', onclick: () => openClientFile(id) }, name);
}

function closeClientFile() {
  if ($('client-file').open) $('client-file').close();
}

async function openClientFile(id) {
  const c = state.clients.find((x) => x.id === id);
  if (!c) { toast('That client is no longer on file.'); return; }
  const orders = state.orders.filter((o) => o.client_id === id);
  const invs = state.invoices.filter((i) => i.client_id === id);
  const today = new Date().toISOString().slice(0, 10);
  const sum = (list) => list.reduce((t, x) => t + x.amount_cents, 0);
  const paid = invs.filter((i) => i.status === 'paid');
  const open = invs.filter((i) => i.status === 'open');

  const place = [c.residence, c.room && `Unit/Rm ${c.room}`].filter(Boolean).join(', ') || '—';
  const size = [c.bedrooms && (c.bedrooms === 'Studio' ? 'Studio' : `${c.bedrooms} bed`), c.bathrooms && `${c.bathrooms} bath`].filter(Boolean).join(' · ');
  const since = new Date(`${c.created_at.replace(' ', 'T')}Z`).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' });

  const box = $('client-file-body');
  const parts = [
    el('div', { class: 'cf-head' },
      el('div', {},
        el('h2', { id: 'cf-title' }, c.name),
        el('p', { class: 'cf-contact' },
          el('a', { href: `mailto:${c.email}` }, c.email),
          c.phone ? el('a', { href: `tel:${c.phone.replace(/[^\d+]/g, '')}` }, c.phone) : null),
        el('p', { class: 'sub' }, `🏠 ${place}${size ? ` · ${size}` : ''} · Client since ${since}`)),
      el('div', { class: 'cf-terms' }, termsCell(c))),
    el('div', { class: 'cf-actions' },
      el('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => { closeClientFile(); newOrderFor(c); } }, 'Add Order'),
      el('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => { closeClientFile(); openInvoiceFor(c); } }, 'Send Invoice'),
      el('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => { closeClientFile(); showView('clients'); editClient(c); } }, 'Edit Details')),
    el('div', { class: 'cf-stats' },
      stat('Orders', String(orders.length), `${orders.filter((o) => o.status === 'completed').length} completed`),
      stat('Upcoming', String(orders.filter((o) => o.status === 'scheduled' && o.service_date >= today).length), 'scheduled'),
      stat('Paid', money.format(sum(paid) / 100), `${paid.length} invoice${paid.length === 1 ? '' : 's'}`),
      stat('Outstanding', money.format(sum(open) / 100), `${open.length} open invoice${open.length === 1 ? '' : 's'}`)),
    el('h3', { class: 'cf-section' }, 'Order history'),
    orders.length ? el('div', { class: 'table-wrap' }, el('table', { class: 'orders admin-table cf-table' },
      el('thead', {}, el('tr', {}, ...['Date', 'Order', 'Service', 'Status', 'Amount', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...orders.map((o) => el('tr', {},
        el('td', { 'data-label': 'Date' }, fmtDate(o.service_date), o.service_time ? el('span', { class: 'sub' }, fmtClock(o.service_time)) : null),
        el('td', { 'data-label': 'Order', class: 'mono' }, o.order_number),
        el('td', { 'data-label': 'Service' }, el('div', {}, el('strong', {}, o.service_type), el('span', { class: 'sub' }, `${o.plan} · ${o.location || '—'}`))),
        el('td', { 'data-label': 'Status' }, el('span', { class: `badge badge-${o.status}` }, STATUS_LABELS[o.status])),
        el('td', { 'data-label': 'Amount', class: 'num' }, money.format(o.amount_cents / 100)),
        el('td', {}, el('div', { class: 'row-actions' }, orderInvoiceAction(o),
          el('button', { type: 'button', class: 'link-btn', onclick: () => { closeClientFile(); showView('orders'); editOrder(o); } }, 'Edit'))))))))
      : el('p', { class: 'empty' }, 'No orders yet.'),
    el('h3', { class: 'cf-section' }, 'Invoices'),
    invs.length ? el('div', { class: 'table-wrap' }, el('table', { class: 'orders admin-table cf-table' },
      el('thead', {}, el('tr', {}, ...['Invoice', 'Items', 'Sent', 'Status', 'Total', ''].map((h) => el('th', {}, h)))),
      el('tbody', {}, ...invs.map((inv) => {
        const [cls, label] = invoiceStatus(inv);
        return el('tr', {},
          el('td', { 'data-label': 'Invoice', class: 'mono' }, inv.invoice_number),
          el('td', { 'data-label': 'Items' }, inv.items.map((it) => it.description).join(', ')),
          el('td', { 'data-label': 'Sent' }, fmtDate(inv.created_at.slice(0, 10))),
          el('td', { 'data-label': 'Status' }, el('span', { class: `badge badge-${cls}` }, label)),
          el('td', { 'data-label': 'Total', class: 'num' }, money.format(inv.amount_cents / 100)),
          el('td', {}, inv.receipt_url ? el('a', { class: 'link-btn', href: inv.receipt_url, target: '_blank', rel: 'noopener' }, 'Receipt') : ''));
      }))))
      : el('p', { class: 'empty' }, 'No invoices yet.'),
    el('h3', { class: 'cf-section' }, 'Supplier jobs'),
    el('div', { id: 'cf-jobs' }, el('p', { class: 'sub' }, 'Loading…')),
    c.signup_note ? el('div', {}, el('h3', { class: 'cf-section' }, 'Note from sign-up'), el('p', { class: 'inquiry-msg' }, c.signup_note)) : null];
  box.replaceChildren(...parts.filter(Boolean));
  $('client-file').showModal();
  box.scrollTop = 0;

  try {
    const { jobs } = await api('/jobs');
    const mine = jobs.filter((j) => j.client_id === id);
    const target = document.getElementById('cf-jobs');
    if (!target) return;
    target.replaceChildren(mine.length
      ? el('ul', { class: 'cf-jobs' }, ...mine.map((j) => el('li', {},
        el('span', { class: 'mono' }, j.job_number), ' ',
        `${fmtDate(j.service_date)} · ${j.cleaner_name} · `,
        el('strong', {}, j.status === 'completed' ? `Completed by ${j.completed_by}` : ({ requested: 'Awaiting supplier', accepted: 'Pending completion', cancelled: 'Cancelled' })[j.status]),
        j.photos.length ? ` · ${j.photos.length} photo${j.photos.length === 1 ? '' : 's'}` : '')))
      : el('p', { class: 'empty' }, 'No supplier jobs for this client.'));
  } catch { /* jobs are a nice-to-have here */ }
}

function stat(label, value, meta) {
  return el('div', { class: 'cf-stat' }, el('span', { class: 'cf-stat-label' }, label), el('strong', {}, value), el('span', { class: 'sub' }, meta));
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

/* ---------- Cancelling invoices ---------- */

let cancellingInvoice = null;
function openCancelInvoice(inv) {
  cancellingInvoice = inv;
  const form = $('cancel-invoice-form');
  form.reset();
  formError(form, '');
  const paid = inv.status === 'paid';
  $('ci-title').textContent = paid ? 'Cancel / refund invoice' : 'Cancel invoice';
  $('ci-who').textContent = `${inv.invoice_number} · ${inv.client_name} · ${money.format(inv.amount_cents / 100)}${paid ? ' · paid' : ' · unpaid — it will disappear from the client’s portal'}`;
  $('ci-refund').hidden = !paid;
  $('ci-amount').textContent = money.format(inv.amount_cents / 100);
  $('ci-opt-stripe').hidden = !inv.stripe_refundable;
  if (paid) form.querySelector(`input[value="${inv.stripe_refundable ? 'stripe' : 'already'}"]`).checked = true;
  $('cancel-invoice-dialog').showModal();
  $('ci-reason').focus();
}

async function submitCancelInvoice(e) {
  e.preventDefault();
  const form = e.target;
  const inv = cancellingInvoice;
  const refund = inv.status === 'paid' ? (form.querySelector('input[name="refund"]:checked')?.value || 'none') : 'none';
  if (refund === 'stripe' && !confirm(`Refund ${money.format(inv.amount_cents / 100)} to ${inv.client_name}’s card now? This sends real money back.`)) return;
  const btn = $('ci-submit');
  btn.disabled = true;
  try {
    const result = await api(`/invoices/${inv.id}/cancel`, 'POST', { reason: $('ci-reason').value.trim(), refund });
    $('cancel-invoice-dialog').close();
    await refresh();
    toast(result.refunded && refund === 'stripe' ? `${inv.invoice_number} cancelled and ${money.format(inv.amount_cents / 100)} refunded to the client’s card.` : `${inv.invoice_number} cancelled.`);
  } catch (err) {
    formError(form, err.message);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Private notes on orders and invoices ---------- */

let notesTarget = null;
function openNotes(kind, item) {
  notesTarget = { kind, item };
  const form = $('notes-form');
  formError(form, '');
  $('nd-title').textContent = kind === 'order' ? `Notes — order ${item.order_number}` : `Notes — invoice ${item.invoice_number}`;
  $('nd-who').textContent = item.client_name;
  $('nd-text').value = item.admin_notes || '';
  $('notes-dialog').showModal();
  $('nd-text').focus();
}

async function submitNotes(e) {
  e.preventDefault();
  const { kind, item } = notesTarget;
  const btn = $('nd-submit');
  btn.disabled = true;
  try {
    await api(`/${kind === 'order' ? 'orders' : 'invoices'}/${item.id}/notes`, 'PATCH', { notes: $('nd-text').value });
    $('notes-dialog').close();
    await refresh();
    toast('Notes saved.');
  } catch (err) {
    formError(e.target, err.message);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- Suppliers / cleaners ---------- */

function addCleanerServiceRow(service = '', cost = '', unit = 'clean') {
  const known = SERVICES.find((s) => s.name === service);
  const picker = el('select', { class: 'item-service', 'aria-label': 'Service' },
    el('option', { value: '' }, 'Choose a service…'),
    ...SERVICES.map((s) => el('option', { value: s.name }, s.name)),
    el('option', { value: 'custom' }, 'Other service…'));
  const name = el('input', { class: 'item-desc', placeholder: 'Service, e.g. Deep clean, Move-out, Carpet', 'aria-label': 'Service name', value: service });
  const costInput = el('input', { class: 'item-amount', type: 'number', min: '0', step: '0.01', placeholder: 'Cost $', 'aria-label': 'Cost', value: cost });
  const unitSelect = el('select', { class: 'item-unit', 'aria-label': 'Charged' },
    el('option', { value: 'clean' }, 'per clean'), el('option', { value: 'hour' }, 'per hour'));
  unitSelect.value = unit;
  picker.value = known ? known.name : (service ? 'custom' : '');
  picker.addEventListener('change', () => {
    if (picker.value === 'custom') { name.value = ''; name.focus(); } else name.value = picker.value;
  });
  const row = el('div', { class: 'item-row cleaner-row' }, picker, name, costInput, unitSelect,
    el('button', {
      type: 'button', class: 'link-btn danger', 'aria-label': 'Remove service',
      onclick: () => { if ($('cleaner-services').children.length > 1) row.remove(); else { name.value = ''; costInput.value = ''; picker.value = ''; } },
    }, '✕'));
  $('cleaner-services').append(row);
  return row;
}

function resetCleanerForm() {
  const form = $('cleaner-form');
  form.reset();
  formError(form, '');
  state.editingCleaner = null;
  $('cleaner-services').replaceChildren();
  addCleanerServiceRow();
  $('cleaner-form-title').textContent = 'Add a cleaner';
  $('cleaner-submit').textContent = 'Save Cleaner';
  $('cleaner-cancel').hidden = true;
}

function editCleaner(c) {
  resetCleanerForm();
  const form = $('cleaner-form');
  state.editingCleaner = c;
  form.name.value = c.name;
  form.company.value = c.company || '';
  form.phone.value = c.phone || '';
  form.email.value = c.email || '';
  form.area.value = c.area || '';
  form.notes.value = c.notes || '';
  form.active.value = String(c.active);
  if (c.services.length) {
    $('cleaner-services').replaceChildren();
    for (const s of c.services) addCleanerServiceRow(s.service, (s.cost_cents / 100).toFixed(2), s.unit);
  }
  $('cleaner-form-title').textContent = `Edit ${c.name}`;
  $('cleaner-submit').textContent = 'Save Changes';
  $('cleaner-cancel').hidden = false;
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function submitCleaner(e) {
  e.preventDefault();
  const form = e.target;
  const services = [...$('cleaner-services').querySelectorAll('.cleaner-row')].map((row) => ({
    service: row.querySelector('.item-desc').value.trim(),
    cost: row.querySelector('.item-amount').value,
    unit: row.querySelector('.item-unit').value,
  })).filter((s) => s.service || s.cost);
  const body = {
    name: form.name.value, company: form.company.value, phone: form.phone.value, email: form.email.value,
    area: form.area.value, notes: form.notes.value, active: form.active.value === 'true', services,
  };
  try {
    if (state.editingCleaner) {
      await api(`/cleaners/${state.editingCleaner.id}`, 'PUT', body);
      toast(`${body.name} updated.`);
    } else {
      await api('/cleaners', 'POST', body);
      toast(`${body.name} added.`);
    }
    resetCleanerForm();
    await refresh();
  } catch (err) { formError(form, err.message); }
}

async function deleteCleaner(c) {
  if (!confirm(`Delete ${c.name}${c.company ? ` (${c.company})` : ''}? This can’t be undone.`)) return;
  try {
    await api(`/cleaners/${c.id}`, 'DELETE');
    toast(`${c.name} deleted.`);
    await refresh();
  } catch (err) { toast(err.message); }
}

function renderCleaners() {
  const q = $('cleaner-search').value.trim().toLowerCase();
  const rows = state.cleaners.filter((c) => !q
    || [c.name, c.company, c.area, c.email, c.phone, c.notes, ...c.services.map((s) => s.service)].join(' ').toLowerCase().includes(q));
  const list = $('cleaners-list');
  list.replaceChildren();
  $('cleaners-empty').hidden = rows.length > 0;

  for (const c of rows) {
    const contact = el('p', { class: 'cleaner-contact' });
    if (c.phone) contact.append(el('a', { href: `tel:${c.phone.replace(/[^\d+]/g, '')}` }, `📞 ${c.phone}`));
    if (c.email) contact.append(el('a', { href: `mailto:${c.email}` }, `✉️ ${c.email}`));
    if (c.area) contact.append(el('span', {}, `📍 ${c.area}`));

    const services = el('table', { class: 'cleaner-services' }, el('tbody', {},
      ...c.services.map((s) => {
        const std = SERVICES.find((x) => x.name === s.service);
        const margin = std && s.unit === 'clean' ? std.price * 100 - s.cost_cents : null;
        return el('tr', {},
          el('td', {}, s.service),
          el('td', { class: 'num' }, `${money.format(s.cost_cents / 100)} / ${s.unit}`),
          el('td', { class: 'num margin' }, margin === null ? ''
            : el('span', { class: `margin-pill ${margin >= 0 ? 'pos' : 'neg'}` },
              `You charge ${money.format(std.price)} · margin ${money.format(margin / 100)}`)));
      })));

    list.append(el('article', { class: `cleaner-card${c.active ? '' : ' inactive'}` },
      el('div', { class: 'cleaner-head' },
        el('div', {},
          el('h3', {}, c.name),
          c.company ? el('span', { class: 'sub' }, c.company) : null),
        el('div', { class: 'row-actions' },
          el('span', { class: `badge ${c.active ? 'badge-completed' : 'badge-cancelled'}` }, c.active ? 'Active' : 'Inactive'),
          c.portal ? el('span', { class: 'badge badge-pending' }, 'Portal on') : null,
          el('button', { type: 'button', class: 'link-btn', onclick: () => portalLogin(c) }, c.portal ? 'Reset Portal Password' : 'Create Portal Login'),
          c.portal ? el('button', { type: 'button', class: 'link-btn', onclick: () => portalOff(c) }, 'Turn Off Portal') : null,
          el('button', { type: 'button', class: 'link-btn', onclick: () => editCleaner(c) }, 'Edit'),
          el('button', { type: 'button', class: 'link-btn danger', onclick: () => deleteCleaner(c) }, 'Delete'))),
      contact.children.length ? contact : null,
      c.services.length ? services : el('p', { class: 'sub' }, 'No services listed yet.'),
      c.notes ? el('p', { class: 'cleaner-notes' }, c.notes) : null));
  }
}

// Supplier portal logins: the supplier signs in at /supplier with their email and this password.
async function portalLogin(c) {
  if (!c.email) { toast('Add an email for this supplier first (Edit) — it’s their username.'); return; }
  const password = window.prompt(`Password for ${c.name}'s supplier portal (min. 8 characters). Share it with them along with the link.`, generatePassword());
  if (password == null) return;
  try {
    await api(`/cleaners/${c.id}/portal`, 'POST', { password });
    await refresh();
    window.prompt('Portal login ready. Copy these details and send them to the supplier:', `${location.origin}/supplier  ·  Email: ${c.email}  ·  Password: ${password}`);
  } catch (err) { toast(err.message); }
}

async function portalOff(c) {
  if (!window.confirm(`Turn off ${c.name}'s supplier portal? They won't be able to sign in until you create a new login.`)) return;
  try { await api(`/cleaners/${c.id}/portal`, 'DELETE'); await refresh(); toast('Portal login turned off.'); } catch (err) { toast(err.message); }
}

/* ---------- Phone app & notifications ---------- */

async function refreshPushUI() {
  const on = await window.APlusApp.pushEnabled().catch(() => false);
  $('push-toggle').textContent = on ? '🔕 Turn Off Notifications' : '🔔 Turn On Notifications';
  $('push-toggle').className = `btn btn-sm ${on ? 'btn-outline' : 'btn-primary'}`;
  $('push-test').hidden = !on;
  try {
    const { devices } = await api('/push/key');
    $('push-status').textContent = on
      ? `✅ This device gets alerts for new quote requests and payments. (${devices} device${devices === 1 ? '' : 's'} signed up)`
      : devices
        ? `${devices} other device${devices === 1 ? '' : 's'} signed up for alerts. Turn them on here too if you like.`
        : 'Tip: on iPhone, install the app first (Share → Add to Home Screen), then turn notifications on from the app.';
  } catch { /* status is optional */ }
}

async function togglePush() {
  const btn = $('push-toggle');
  btn.disabled = true;
  try {
    if (await window.APlusApp.pushEnabled()) {
      await window.APlusApp.disablePush('owner');
      toast('Notifications turned off on this device.');
    } else {
      const result = await window.APlusApp.enablePush('owner');
      if (result?.ok !== false) toast('Notifications are on for this device.');
    }
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    refreshPushUI();
  }
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
  $('push-toggle').addEventListener('click', togglePush);
  $('push-test').addEventListener('click', async () => {
    try {
      const { delivered } = await api('/push/test', 'POST');
      toast(delivered ? 'Test notification sent — check your phone.' : 'No devices are signed up yet.');
    } catch (err) { toast(err.message); }
  });
  refreshPushUI();
  // Deep links from notifications, e.g. /admin#invoices
  const startView = location.hash.slice(1);
  if (['orders', 'clients', 'jobs', 'invoices', 'cleaners', 'inquiries'].includes(startView)) showView(startView);
  $('invoice-form').addEventListener('submit', submitInvoice);
  for (const select of [$('o-client'), $('i-client')]) {
    select.addEventListener('change', () => {
      if (select.value === NEW_CLIENT) openNewClientDialog(select);
      else select.dataset.previous = select.value;
    });
  }
  $('new-client-form').addEventListener('submit', submitNewClient);
  $('decline-form').addEventListener('submit', submitDecline);
  $('dc-cancel').addEventListener('click', closeDeclineDialog);
  $('dc-email').addEventListener('change', () => {
    $('dc-submit').textContent = $('dc-email').checked ? 'Decline & Send' : 'Decline';
  });
  $('nc-cancel').addEventListener('click', closeNewClientDialog);
  $('new-client-dialog').addEventListener('cancel', (e) => { e.preventDefault(); closeNewClientDialog(); });
  $('nc-gen').addEventListener('click', () => { $('nc-password').value = generatePassword(); });
  $('add-item').addEventListener('click', () => addItemRow().querySelector('.item-desc').focus());
  $('invoice-search').addEventListener('input', renderInvoices);
  resetInvoiceForm();
  fillOrderServicePicker();
  $('cf-close').addEventListener('click', closeClientFile);
  $('cancel-invoice-form').addEventListener('submit', submitCancelInvoice);
  $('ci-close').addEventListener('click', () => $('cancel-invoice-dialog').close());
  $('notes-form').addEventListener('submit', submitNotes);
  $('nd-close').addEventListener('click', () => $('notes-dialog').close());
  resetCleanerForm();
  $('cleaner-form').addEventListener('submit', submitCleaner);
  $('cleaner-cancel').addEventListener('click', resetCleanerForm);
  $('add-cleaner-service').addEventListener('click', () => addCleanerServiceRow().querySelector('.item-service').focus());
  $('cleaner-search').addEventListener('input', renderCleaners);
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
