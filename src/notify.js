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
    ['Residence & room', inquiry.residence],
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

async function sendEmail({ subject, text, html, replyTo }) {
  const { apiKey, to, from } = config();
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

function emailStatus() {
  const { apiKey, to, from } = config();
  return { keySet: Boolean(apiKey), to, from, last: { ...lastResult } };
}

module.exports = { sendInquiryAlert, sendTestEmail, emailStatus, buildInquiryEmail };
