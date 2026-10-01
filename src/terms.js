'use strict';

// Terms & Conditions: current version, client acceptance, and the records kept for the owner.

const crypto = require('node:crypto');
const db = require('./db');
const content = require('./terms-content');

// Plain-text copy of the terms, stored with every acceptance as the record of what was agreed to.
function plainText() {
  const lines = [`${content.company.toUpperCase()}`, content.title, `Version ${content.version}`, ''];
  for (const section of content.sections) {
    lines.push(section.heading);
    for (const block of section.blocks) {
      if (block.type === 'list') block.items.forEach((item) => lines.push(`  • ${item}`));
      else lines.push(block.text);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

const TEXT = plainText();
const HASH = crypto.createHash('sha256').update(TEXT).digest('hex');

const current = () => ({ ...content, hash: HASH });

function latestFor(clientId) {
  return db.prepare(`
    SELECT id, signed_name, terms_version, accepted_at FROM terms_acceptances
    WHERE client_id = ? ORDER BY id DESC LIMIT 1
  `).get(clientId) || null;
}

const hasAccepted = (clientId) => latestFor(clientId)?.terms_version === content.version;

function accept(client, signedName, { ip, userAgent }) {
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO terms_acceptances
      (client_id, client_name, client_email, signed_name, terms_version, terms_hash, terms_text, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(client.id, client.name, client.email, signedName, content.version, HASH, TEXT,
    ip || null, (userAgent || '').slice(0, 300) || null);
  return Number(lastInsertRowid);
}

const getRecord = (id) => db.prepare('SELECT * FROM terms_acceptances WHERE id = ?').get(id) || null;

module.exports = { current, latestFor, hasAccepted, accept, getRecord, version: content.version };
