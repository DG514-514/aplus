'use strict';

// Emails the business when someone submits the website quote form.
// Uses Resend (https://resend.com). Configure with:
//   RESEND_API_KEY  — API key from Resend (required to send)
//   NOTIFY_EMAIL    — where alerts go, e.g. info@aplus-cleaning-solutions.com
//   SITE_URL        — public address used for links, e.g. https://aplus-cleaning-solutions.com
//   MAIL_FROM       — optional sender once your domain is verified in Resend,
//                     e.g. "A+ Cleaning Website <website@aplus-cleaning-solutions.com>"

const DEFAULT_FROM = 'A+ Cleaning Website <onboarding@resend.dev>';

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// "Friday, Oct 16, 2026" and "2:30 PM" for the owner's quote-request email.
const formatDay = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const formatClock = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

function buildInquiryEmail(inquiry, siteUrl) {
  const rows = [
    ['Name', inquiry.name],
    ['Email', inquiry.email],
    ['Phone', inquiry.phone],
    ['Plan', inquiry.plan],
    ['Residence', inquiry.residence],
    ['Bedrooms', inquiry.bedrooms],
    ['Bathrooms', inquiry.bathrooms],
    ['Requested date', inquiry.requested_date && formatDay(inquiry.requested_date)],
    ['Requested time', inquiry.requested_time && formatClock(inquiry.requested_time)],
    ['Message', inquiry.message],
  ].filter(([, value]) => value);

  const adminUrl = siteUrl ? `${siteUrl.replace(/\/$/, '')}/admin` : null;
  const text = [
    'New quote request from the A+ Cleaning Solutions website:',
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'Reply to this email to respond directly to the customer.',
    adminUrl ? `Create their client login: ${adminUrl}` : null,
  ].filter((line) => line !== null).join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;color:#2c3529;max-width:560px">
      <h2 style="color:#3c4838;margin:0 0 16px">New quote request</h2>
      <table style="border-collapse:collapse;width:100%">
        ${rows.map(([label, value]) => `
          <tr>
            <td style="padding:8px 12px 8px 0;color:#66705f;font-weight:bold;vertical-align:top;white-space:nowrap">${escapeHtml(label)}</td>
            <td style="padding:8px 0;white-space:pre-wrap">${escapeHtml(value)}</td>
          </tr>`).join('')}
      </table>
      <p style="margin:20px 0 0;color:#66705f">Reply to this email to respond directly to ${escapeHtml(inquiry.name)}.</p>
      ${adminUrl ? `<p><a href="${escapeHtml(adminUrl)}" style="color:#5a6f54">Open your dashboard to create their client login →</a></p>` : ''}
    </div>`;

  return {
    subject: `New quote request: ${inquiry.name}${inquiry.plan ? ` (${inquiry.plan})` : ''}`,
    text,
    html,
  };
}

const DEFAULT_NOTIFY_EMAIL = 'info@aplus-cleaning-solutions.com';

// Payments and completed jobs always reach the business inbox, even if NOTIFY_EMAIL lists other addresses.
function ownerInbox() {
  const list = config().to;
  return list.some((e) => e.toLowerCase() === DEFAULT_NOTIFY_EMAIL) ? list : [...list, DEFAULT_NOTIFY_EMAIL];
}

// Last outcome, shown in the owner dashboard so problems are visible without server logs.
const lastResult = { at: null, ok: null, message: null };

function config() {
  return {
    apiKey: (process.env.RESEND_API_KEY || '').trim(),
    to: (process.env.NOTIFY_EMAIL || DEFAULT_NOTIFY_EMAIL).split(',').map((s) => s.trim()).filter(Boolean),
    from: process.env.MAIL_FROM || DEFAULT_FROM,
  };
}

// Turns Resend's error responses into something an owner can act on.
function explain(status, body) {
  const raw = String(body || '').slice(0, 300);
  if (status === 401 || (status === 400 && /api key/i.test(raw))) {
    return `The Resend API key was rejected. Create a new key in Resend and paste it into RESEND_API_KEY in Render. (${raw})`;
  }
  if (status === 403 && /own email|testing emails|verify a domain/i.test(raw)) {
    return 'Resend will only deliver to the email address your Resend account was created with until you verify your domain. '
      + `Either sign up to Resend with ${config().to.join(', ')}, or verify aplus-cleaning-solutions.com in Resend. (${raw})`;
  }
  if (status === 403 || status === 422) {
    return `Resend refused the email — usually the sender (MAIL_FROM) uses a domain that isn't verified in Resend. (${raw})`;
  }
  return `Resend responded ${status}: ${raw}`;
}

async function sendEmail({ subject, text, html, replyTo, to: toOverride }) {
  const { apiKey, from } = config();
  const to = toOverride || config().to;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set in Render → Environment, so no emails can be sent.');
  }
  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, reply_to: replyTo, subject, text, html }),
    });
  } catch (err) {
    throw new Error(`Couldn't reach Resend: ${err.message}`);
  }
  if (!res.ok) throw new Error(explain(res.status, await res.text()));
  return { sent: true, to };
}

async function track(promise) {
  try {
    const result = await promise;
    Object.assign(lastResult, { at: new Date().toISOString(), ok: true, message: `Sent to ${result.to.join(', ')}` });
    return result;
  } catch (err) {
    Object.assign(lastResult, { at: new Date().toISOString(), ok: false, message: err.message });
    throw err;
  }
}

function sendInquiryAlert(inquiry) {
  const email = buildInquiryEmail(inquiry, process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL);
  return track(sendEmail({ ...email, replyTo: inquiry.email }));
}

function sendTestEmail() {
  return track(sendEmail({
    subject: 'Test: A+ Cleaning website email alerts are working',
    text: 'This is a test from your A+ Cleaning Solutions owner dashboard. Quote request alerts will arrive at this address.',
    html: '<p style="font-family:Arial,sans-serif">This is a test from your A+ Cleaning Solutions owner dashboard. '
      + 'Quote request alerts will arrive at this address. ✅</p>',
  }));
}

// Same currency the website charges in (STRIPE_CURRENCY). Required lazily to avoid a load-order cycle.
const money = (cents) => require('./stripe').formatMoney(cents);
// "2026-10-12", "14:00" → "Monday, October 12, 2026 at 2:00 p.m."
function formatService(date, time) {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-CA', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
  if (!time) return day;
  const [h, min] = time.split(':').map(Number);
  const clock = new Date(Date.UTC(2000, 0, 1, h, min)).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  return `${day} at ${clock}`;
}

const siteUrl = () => (process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');

// Tells a client they have a new invoice to pay in their portal.
function sendInvoiceEmail({ client, invoice, items, payUrl, reminder = false }) {
  const loginUrl = `${siteUrl()}/login`;
  const payLink = payUrl || loginUrl;
  const first = client.name.split(' ')[0];
  const lines = items.map((i) => `${i.description}: ${money(i.amount_cents)}`);
  const due = invoice.due_date ? `Due ${invoice.due_date}. ` : '';
  const service = formatService(invoice.service_date, invoice.service_time);
  const text = [
    `Hi ${first},`,
    '',
    reminder
      ? `Here is the payment link for your invoice ${invoice.invoice_number} from A+ Cleaning Solutions (${money(invoice.amount_cents)}).`
      : `You have a new invoice (${invoice.invoice_number}) from A+ Cleaning Solutions for ${money(invoice.amount_cents)}.`,
    '',
    service ? `Service: ${service}` : null,
    ...lines,
    invoice.notes ? `\n${invoice.notes}` : null,
    '',
    `${due}View and pay securely by card (no sign-in needed): ${payLink}`,
    payUrl ? `Or sign in to your account: ${loginUrl}` : null,
    '',
    'Thank you!',
    'A+ Cleaning Solutions',
  ].filter((l) => l !== null).join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;color:#2c3529;max-width:560px">
      <p>Hi ${escapeHtml(first)},</p>
      <p>${reminder ? 'Here is the payment link for your invoice' : 'You have a new invoice'} <strong>${escapeHtml(invoice.invoice_number)}</strong> from A+ Cleaning Solutions.</p>
      ${service ? `<p style="background:#f3f6f1;padding:10px 14px;border-radius:8px">🗓️ <strong>Service:</strong> ${escapeHtml(service)}</p>` : ''}
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        ${items.map((i) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e3e0d8">${escapeHtml(i.description)}</td>
          <td style="padding:8px 0;border-bottom:1px solid #e3e0d8;text-align:right">${money(i.amount_cents)}</td></tr>`).join('')}
        <tr><td style="padding:10px 0;font-weight:bold">Total</td>
          <td style="padding:10px 0;text-align:right;font-weight:bold">${money(invoice.amount_cents)}</td></tr>
      </table>
      ${invoice.notes ? `<p style="white-space:pre-wrap;color:#66705f">${escapeHtml(invoice.notes)}</p>` : ''}
      ${invoice.due_date ? `<p>Due <strong>${escapeHtml(invoice.due_date)}</strong>.</p>` : ''}
      <p style="margin:24px 0"><a href="${escapeHtml(payLink)}" style="background:#809678;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">View &amp; Pay Invoice</a></p>
      ${payUrl ? `<p style="color:#66705f;font-size:13px">No sign-in needed. Prefer your account? <a href="${escapeHtml(loginUrl)}" style="color:#5a6f54">Sign in here</a>.</p>` : ''}
      <p style="color:#66705f">Thank you!<br>A+ Cleaning Solutions</p>
    </div>`;
  return track(sendEmail({
    to: [client.email],
    replyTo: config().to[0],
    subject: `${reminder ? 'Payment link — ' : ''}Invoice ${invoice.invoice_number} from A+ Cleaning Solutions: ${money(invoice.amount_cents)}`,
    text,
    html,
  }));
}

// Lets a customer know their quote request can't be taken on, with the owner's reason.
function sendDeclineEmail({ inquiry, reason }) {
  const first = inquiry.name.split(' ')[0];
  const text = [
    `Hi ${first},`,
    '',
    'Thank you for your interest in A+ Cleaning Solutions. Unfortunately, we’re unable to take on your cleaning request at this time.',
    '',
    reason,
    '',
    'If anything changes or you have any questions, just reply to this email — we’d be happy to help in the future.',
    '',
    'Best regards,',
    'A+ Cleaning Solutions',
  ].join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;color:#2c3529;max-width:560px;line-height:1.5">
      <p>Hi ${escapeHtml(first)},</p>
      <p>Thank you for your interest in A+ Cleaning Solutions. Unfortunately, we’re unable to take on your cleaning request at this time.</p>
      <p style="background:#f3f6f1;padding:12px 16px;border-radius:8px;white-space:pre-wrap">${escapeHtml(reason)}</p>
      <p>If anything changes or you have any questions, just reply to this email — we’d be happy to help in the future.</p>
      <p style="color:#66705f">Best regards,<br>A+ Cleaning Solutions</p>
    </div>`;
  return track(sendEmail({
    to: [inquiry.email],
    replyTo: config().to[0],
    subject: 'Your A+ Cleaning Solutions quote request',
    text,
    html,
  }));
}

// Tells the business a client paid.
function sendPaymentAlert({ client, invoice }) {
  const site = (process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  const how = invoice.paid_method === 'stripe' ? 'Paid by card through Stripe' : `Marked paid (${invoice.paid_method || 'manual'})`;
  return sendNotice({
    to: ownerInbox(),
    replyTo: client.email,
    subject: `Payment received: ${invoice.invoice_number} (${money(invoice.amount_cents)})`,
    lines: [
      `💳 ${client.name} (${client.email}) paid invoice ${invoice.invoice_number}: ${money(invoice.amount_cents)}.`,
      `${how}${invoice.paid_at ? ` · ${invoice.paid_at} UTC` : ''}`,
      invoice.receipt_url ? `Stripe receipt: ${invoice.receipt_url}` : null,
    ].filter(Boolean),
    link: site ? ['Open invoices', `${site}/admin#invoices`] : null,
  });
}

// Owner alert: someone created an account on the website and is waiting for approval.
function sendSignupAlert(client) {
  const site = (process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  const rows = [
    ['Name', client.name], ['Email', client.email], ['Phone', client.phone],
    ['Residence', [client.residence, client.room && `Unit/Room ${client.room}`].filter(Boolean).join(', ')],
    ['Bedrooms', client.bedrooms], ['Bathrooms', client.bathrooms], ['Notes', client.note],
  ].filter(([, v]) => v);
  const text = ['New account request on the website — approve or decline it in your dashboard.', '',
    ...rows.map(([k, v]) => `${k}: ${v}`), '', site ? `Review: ${site}/admin#clients` : ''].join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;color:#2c3529;max-width:560px;line-height:1.5">
      <p><strong>New account request</strong> — approve or decline it in your dashboard.</p>
      <table style="border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#66705f">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`).join('')}</table>
      ${site ? `<p><a href="${escapeHtml(site)}/admin#clients" style="display:inline-block;background:#809678;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Review in dashboard</a></p>` : ''}
    </div>`;
  return track(sendEmail({ replyTo: client.email, subject: `New account request: ${client.name}`, text, html }));
}

// Client email once the owner approves their account.
function sendAccountApprovedEmail(client) {
  const site = (process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  const first = client.name.split(' ')[0];
  const login = site ? `${site}/login` : 'our website';
  const text = [`Hi ${first},`, '', 'Good news — your A+ Cleaning Solutions account has been approved.', '',
    `Sign in with the email and password you chose: ${login}`, '',
    'From your account you can see upcoming visits, your order history and pay invoices online.', '',
    'Welcome aboard!', 'A+ Cleaning Solutions'].join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;color:#2c3529;max-width:560px;line-height:1.5">
      <p>Hi ${escapeHtml(first)},</p>
      <p>Good news — your A+ Cleaning Solutions account has been <strong>approved</strong>.</p>
      <p>Sign in with the email and password you chose to see upcoming visits, your order history and pay invoices online.</p>
      ${site ? `<p><a href="${escapeHtml(login)}" style="display:inline-block;background:#809678;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Sign in</a></p>` : ''}
      <p style="color:#66705f">Welcome aboard!<br>A+ Cleaning Solutions</p>
    </div>`;
  return track(sendEmail({ to: [client.email], replyTo: config().to[0], subject: 'Your A+ Cleaning Solutions account is approved', text, html }));
}

// Client email when the owner declines an account request.
function sendAccountDeclinedEmail(client, reason) {
  const first = client.name.split(' ')[0];
  const text = [`Hi ${first},`, '', 'Thank you for signing up with A+ Cleaning Solutions. Unfortunately, we’re unable to open an account for you at this time.',
    ...(reason ? ['', reason] : []), '', 'If you have any questions, just reply to this email.', '', 'Best regards,', 'A+ Cleaning Solutions'].join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;color:#2c3529;max-width:560px;line-height:1.5">
      <p>Hi ${escapeHtml(first)},</p>
      <p>Thank you for signing up with A+ Cleaning Solutions. Unfortunately, we’re unable to open an account for you at this time.</p>
      ${reason ? `<p style="background:#f3f6f1;padding:12px 16px;border-radius:8px;white-space:pre-wrap">${escapeHtml(reason)}</p>` : ''}
      <p>If you have any questions, just reply to this email.</p>
      <p style="color:#66705f">Best regards,<br>A+ Cleaning Solutions</p>
    </div>`;
  return track(sendEmail({ to: [client.email], replyTo: config().to[0], subject: 'Your A+ Cleaning Solutions account request', text, html }));
}

// Short notice email used for supplier job updates (new job, replies, completions).
// `to` defaults to the business inbox; `lines` are plain sentences; `link` is an optional [label, url].
function sendNotice({ to, replyTo, subject, lines, link }) {
  const text = [...lines, ...(link ? ['', `${link[0]}: ${link[1]}`] : [])].join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;color:#2c3529;max-width:560px;line-height:1.5">
      ${lines.map((l) => (l ? `<p style="margin:0 0 8px;white-space:pre-wrap">${escapeHtml(l)}</p>` : '')).join('')}
      ${link ? `<p><a href="${escapeHtml(link[1])}" style="display:inline-block;background:#809678;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${escapeHtml(link[0])}</a></p>` : ''}
    </div>`;
  return track(sendEmail({ ...(to ? { to } : {}), replyTo, subject, text, html }));
}

function emailStatus() {
  const { apiKey, to, from } = config();
  return { keySet: Boolean(apiKey), to, from, last: { ...lastResult } };
}

module.exports = {
  sendInquiryAlert, sendTestEmail, sendInvoiceEmail, sendPaymentAlert, sendDeclineEmail, emailStatus, buildInquiryEmail, formatService,
  sendSignupAlert, sendAccountApprovedEmail, sendAccountDeclinedEmail, sendNotice, ownerInbox,
};
