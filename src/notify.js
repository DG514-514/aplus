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

function buildInquiryEmail(inquiry, siteUrl) {
  const rows = [
    ['Name', inquiry.name],
    ['Email', inquiry.email],
    ['Phone', inquiry.phone],
    ['Plan', inquiry.plan],
    ['Residence', inquiry.residence],
    ['Bedrooms', inquiry.bedrooms],
    ['Bathrooms', inquiry.bathrooms],
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

const money = (cents) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100);
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
function sendInvoiceEmail({ client, invoice, items }) {
  const loginUrl = `${siteUrl()}/login`;
  const first = client.name.split(' ')[0];
  const lines = items.map((i) => `${i.description}: ${money(i.amount_cents)}`);
  const due = invoice.due_date ? `Due ${invoice.due_date}. ` : '';
  const service = formatService(invoice.service_date, invoice.service_time);
  const text = [
    `Hi ${first},`,
    '',
    `You have a new invoice (${invoice.invoice_number}) from A+ Cleaning Solutions for ${money(invoice.amount_cents)}.`,
    '',
    service ? `Service: ${service}` : null,
    ...lines,
    invoice.notes ? `\n${invoice.notes}` : null,
    '',
    `${due}Sign in to view and pay securely online: ${loginUrl}`,
    '',
    'Thank you!',
    'A+ Cleaning Solutions',
  ].filter((l) => l !== null).join('\n');
  const html = `
    <div style="font-family:Arial,sans-serif;color:#2c3529;max-width:560px">
      <p>Hi ${escapeHtml(first)},</p>
      <p>You have a new invoice <strong>${escapeHtml(invoice.invoice_number)}</strong> from A+ Cleaning Solutions.</p>
      ${service ? `<p style="background:#f3f6f1;padding:10px 14px;border-radius:8px">🗓️ <strong>Service:</strong> ${escapeHtml(service)}</p>` : ''}
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        ${items.map((i) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e3e0d8">${escapeHtml(i.description)}</td>
          <td style="padding:8px 0;border-bottom:1px solid #e3e0d8;text-align:right">${money(i.amount_cents)}</td></tr>`).join('')}
        <tr><td style="padding:10px 0;font-weight:bold">Total</td>
          <td style="padding:10px 0;text-align:right;font-weight:bold">${money(invoice.amount_cents)}</td></tr>
      </table>
      ${invoice.notes ? `<p style="white-space:pre-wrap;color:#66705f">${escapeHtml(invoice.notes)}</p>` : ''}
      ${invoice.due_date ? `<p>Due <strong>${escapeHtml(invoice.due_date)}</strong>.</p>` : ''}
      <p style="margin:24px 0"><a href="${escapeHtml(loginUrl)}" style="background:#809678;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">View &amp; Pay Invoice</a></p>
      <p style="color:#66705f">Thank you!<br>A+ Cleaning Solutions</p>
    </div>`;
  return track(sendEmail({
    to: [client.email],
    replyTo: config().to[0],
    subject: `Invoice ${invoice.invoice_number} from A+ Cleaning Solutions: ${money(invoice.amount_cents)}`,
    text,
    html,
  }));
}

// Tells the business a client paid.
function sendPaymentAlert({ client, invoice }) {
  const text = `${client.name} (${client.email}) paid invoice ${invoice.invoice_number}: ${money(invoice.amount_cents)}.`;
  return track(sendEmail({
    replyTo: client.email,
    subject: `Payment received: ${invoice.invoice_number} (${money(invoice.amount_cents)})`,
    text,
    html: `<p style="font-family:Arial,sans-serif">💳 ${escapeHtml(text)}</p>`,
  }));
}

function emailStatus() {
  const { apiKey, to, from } = config();
  return { keySet: Boolean(apiKey), to, from, last: { ...lastResult } };
}

module.exports = {
  sendInquiryAlert, sendTestEmail, sendInvoiceEmail, sendPaymentAlert, emailStatus, buildInquiryEmail, formatService,
};
