'use strict';

// Server-rendered pages for the Terms & Conditions: the public copy and the owner's signed records.

const terms = require('./terms');

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[ch]);

// SQLite datetime('now') is UTC without a zone marker.
const fmtUtc = (sqlDate) => new Date(`${sqlDate.replace(' ', 'T')}Z`).toLocaleString('en-CA', {
  timeZone: 'America/Toronto', dateStyle: 'long', timeStyle: 'short',
}) + ' (Eastern)';

function layout(title, body, { robots = 'index' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} | A+ Cleaning Solutions</title>
  <meta name="robots" content="${robots}">
  <meta name="theme-color" content="#809678">
  <link rel="icon" type="image/png" href="/img/icon.png">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&family=Nunito+Sans:wght@400;600;700&display=swap">
  <link rel="stylesheet" href="/css/site.css">
  <link rel="stylesheet" href="/css/terms.css">
  <script src="/js/terms-page.js" defer></script>
</head>
<body class="terms-page">
  <header class="terms-header">
    <div class="container"><a href="/" class="brand"><img src="/img/logo.png" alt="A+ Cleaning Solutions" width="800" height="333"></a></div>
  </header>
  <main class="container terms-main">
${body}
  </main>
</body>
</html>`;
}

function sectionsHtml(sections) {
  return sections.map((section) => {
    const blocks = section.blocks.map((block) => (block.type === 'list'
      ? `<ul>${block.items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`
      : `<p>${esc(block.text)}</p>`)).join('');
    return `<section><h2>${esc(section.heading)}</h2>${blocks}</section>`;
  }).join('\n');
}

function publicPage() {
  const t = terms.current();
  return layout(t.title, `
    <p class="eyebrow">${esc(t.company)}</p>
    <h1>${esc(t.title)}</h1>
    <p class="muted">Version ${esc(t.version)} · Clients agree to these terms when they first sign in to their account.</p>
    <article class="terms-body">${sectionsHtml(t.sections)}</article>
    <p class="muted">Questions? Email <a href="mailto:info@aplus-cleaning-solutions.com">info@aplus-cleaning-solutions.com</a>.</p>`);
}

function recordPage(record) {
  const rows = [
    ['Client', `${record.client_name} (${record.client_email})`],
    ['Signed name', record.signed_name],
    ['Agreed on', fmtUtc(record.accepted_at)],
    ['Terms version', record.terms_version],
    ['IP address', record.ip || '—'],
    ['Device / browser', record.user_agent || '—'],
    ['Document fingerprint (SHA-256)', record.terms_hash],
    ['Record ID', `#${record.id}`],
  ];
  return layout(`Signed agreement – ${record.client_name}`, `
    <div class="record-bar no-print">
      <a href="/admin#clients" class="btn btn-outline btn-sm">← Back to dashboard</a>
      <button type="button" class="btn btn-primary btn-sm" data-print>Print / Save as PDF</button>
    </div>
    <p class="eyebrow">Signed agreement record</p>
    <h1>Terms &amp; Conditions acceptance</h1>
    <dl class="record-meta">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <div class="signature">
      <span class="signature-name">${esc(record.signed_name)}</span>
      <span class="signature-note">Typed electronic signature · clicked “Agree” on ${esc(fmtUtc(record.accepted_at))}</span>
    </div>
    <h2 class="record-copy-title">Exact copy of the terms agreed to</h2>
    <pre class="record-text">${esc(record.terms_text)}</pre>`, { robots: 'noindex' });
}

module.exports = { publicPage, recordPage };
