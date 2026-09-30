'use strict';

// Emails the business when someone submits the website quote form.
// Uses Resend (https://resend.com). Configure with:
//   RESEND_API_KEY  — API key from Resend (required to send)
//   NOTIFY_EMAIL    — where alerts go, e.g. info@aplus-cleaning-solutions.com
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

async function sendInquiryAlert(inquiry) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;
  if (!apiKey || !to) return { skipped: true };

  const { subject, text, html } = buildInquiryEmail(inquiry, process.env.RENDER_EXTERNAL_URL || process.env.SITE_URL);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || DEFAULT_FROM,
      to: to.split(',').map((s) => s.trim()).filter(Boolean),
      reply_to: inquiry.email,
      subject,
      text,
      html,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return { sent: true };
}

module.exports = { sendInquiryAlert, buildInquiryEmail };
