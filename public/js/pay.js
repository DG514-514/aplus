'use strict';

// Pay link page (/pay/:token): one invoice, viewable and payable by card without signing in.
(() => {
  const T = (s, v) => (window.I18N ? window.I18N.t(s, v) : s.replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m)));
  const LOCALE = () => (window.I18N ? window.I18N.locale() : 'en-CA');
  const CURRENCY = ((window.APLUS && window.APLUS.currency) || 'usd').toUpperCase();
  const money = new Intl.NumberFormat(CURRENCY === 'CAD' ? 'en-CA' : 'en-US', { style: 'currency', currency: CURRENCY });
  const token = window.location.pathname.split('/').filter(Boolean)[1] || '';
  const base = `/api/pay/${encodeURIComponent(token)}`;
  const $ = (id) => document.getElementById(id);

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value);
    }
    for (const child of children) if (child != null && child !== false) node.append(child);
    return node;
  }

  async function api(path, method = 'GET', body) {
    const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    return data;
  }

  const day = (iso, opts = { month: 'short', day: 'numeric', year: 'numeric' }) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(LOCALE(), opts);
  };
  const clock = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString(LOCALE(), { hour: 'numeric', minute: '2-digit' }); };

  function notice(type, message) {
    const box = $('pay-notice');
    box.className = `alert alert-${type}`;
    box.textContent = message;
    box.hidden = false;
  }

  function render(inv, paymentsEnabled) {
    const isOverdue = inv.status === 'open' && inv.due_date && inv.due_date < new Date().toISOString().slice(0, 10);
    const [cls, label] = inv.status === 'paid' ? ['paid', 'Paid']
      : inv.status === 'void' ? ['cancelled', inv.refunded ? 'Refunded' : 'Cancelled']
        : isOverdue ? ['overdue', 'Overdue'] : ['open', 'Due'];

    let service = null;
    if (inv.service_date) {
      let when = day(inv.service_date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      if (inv.service_time) when = T('{date} at {time}', { date: when, time: clock(inv.service_time) });
      service = el('p', { class: 'invoice-service' }, '🗓️ ', el('strong', {}, `${T('Service:')} `), when);
    }
    const meta = [T('Issued {date}', { date: day(inv.created_at.slice(0, 10)) })];
    if (inv.status === 'open' && inv.due_date) meta.push(T('Due {date}', { date: day(inv.due_date) }));
    if (inv.status === 'paid' && inv.paid_at) meta.push(T('Paid {date}', { date: day(inv.paid_at.slice(0, 10)) }));

    const actions = el('div', { class: 'invoice-actions' });
    if (inv.status === 'open' && paymentsEnabled) {
      const btn = el('button', { type: 'button', class: 'btn btn-primary pay-btn' }, T('Pay {amount}', { amount: money.format(inv.amount_cents / 100) }));
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = T('Opening secure checkout…');
        try {
          const { url } = await api('/checkout', 'POST');
          window.location.assign(url);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = T('Pay {amount}', { amount: money.format(inv.amount_cents / 100) });
          notice('error', T(err.message));
        }
      });
      actions.append(btn, el('span', { class: 'secure' }, T('🔒 Secure checkout by Stripe')));
    } else if (inv.status === 'open') {
      actions.append(el('span', { class: 'secure' }, T('Online payment coming soon — contact us at info@apluscleaningsolution.com to pay.')));
    }
    if (inv.receipt_url) actions.append(el('a', { class: 'btn btn-outline btn-sm', href: inv.receipt_url, target: '_blank', rel: 'noopener' }, T('View Receipt')));

    $('pay-invoice').replaceChildren(
      el('div', { class: 'pay-hello' },
        el('h1', {}, inv.first_name ? T('Hi {name},', { name: inv.first_name }) : T('Your invoice')),
        el('p', { class: 'muted' }, inv.status === 'paid' ? T('This invoice is paid — thank you!')
          : inv.status === 'void' ? T('This invoice was cancelled, so there’s nothing to pay.')
            : T('Here’s your invoice from A+ Cleaning Solutions. You can pay securely by card below.'))),
      el('article', { class: `invoice-card${inv.status === 'open' ? ' is-open' : ''}` },
        el('div', { class: 'invoice-top' },
          el('div', {}, el('h3', {}, T('Invoice {number}', { number: inv.invoice_number })), el('span', { class: 'sub' }, meta.join(' · '))),
          el('span', { class: `badge badge-${cls}` }, T(label))),
        service,
        el('table', { class: 'invoice-lines' }, el('tbody', {},
          ...inv.items.map((it) => el('tr', {}, el('td', {}, T(it.description)), el('td', {}, money.format(it.amount_cents / 100)))),
          el('tr', { class: 'total' }, el('td', {}, T('Total')), el('td', {}, money.format(inv.amount_cents / 100))))),
        inv.notes ? el('p', { class: 'invoice-note' }, inv.notes) : null,
        actions.children.length ? actions : null),
      el('p', { class: 'pay-account muted' }, T('Have an account?'), ' ', el('a', { href: '/login' }, T('Sign in')), ' ', T('to see all your visits and invoices.')));
  }

  async function load() {
    try {
      const { invoice, payments } = await api('');
      render(invoice, payments);
    } catch (err) {
      $('pay-invoice').replaceChildren(el('div', { class: 'panel pay-missing' }, el('h1', {}, T('Payment link not found')), el('p', { class: 'muted' }, T(err.message))));
    } finally {
      $('pay-loading').hidden = true;
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    // Back from Stripe: confirm right away so the page shows "Paid".
    const sessionId = new URLSearchParams(window.location.search).get('paid');
    if (sessionId) {
      history.replaceState(null, '', window.location.pathname);
      try {
        const result = await api('/confirm', 'POST', { sessionId });
        notice('success', result.paid ? T('Thank you! Your payment went through. A receipt has been emailed to you.') : T('Thanks! Your payment is processing and will show here shortly.'));
      } catch {
        notice('success', T('Thanks! Your payment is processing and will show here shortly.'));
      }
    }
    load();
  });
})();
