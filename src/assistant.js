'use strict';

// Owner voice assistant: a business-aware conversation partner that can take notes and sit in on meetings.
// Uses the Claude API (set ANTHROPIC_API_KEY). Speech-to-text and text-to-speech happen in the browser.

const crypto = require('node:crypto');
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');

const MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MAX_TOOL_ROUNDS = 5;
const CONVERSATION_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CONVERSATIONS = 30;
// Long conversations re-send their whole history each turn; start a fresh one after this many exchanges
// to keep cost and latency flat over a full day of talking (saved notes carry over).
const MAX_EXCHANGES = 40;

// What A+ charges clients (matches the invoice presets in the owner dashboard).
const CLIENT_PRICES = [
  ['Studio Standard Clean', 110],
  ['1 Bedroom / 1 Bathroom Standard Clean', 140],
  ['2 Bedroom / 2 Bathroom Standard Clean', 160],
  ['4 Bedroom / 4 Bathroom Standard Clean', 220],
];

db.exec(`
  CREATE TABLE IF NOT EXISTS assistant_notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    kind       TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'meeting')),
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    transcript TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const configured = () => Boolean(process.env.ANTHROPIC_API_KEY);

// Built per request so tests (and key changes) take effect; fetch is resolved at call time for test stubs.
const client = () => new Anthropic({ fetch: (...args) => globalThis.fetch(...args) });

const SYSTEM_PROMPT = `You are Ace, a colleague at A+ Cleaning Solutions — not a generic assistant. A+ is a cleaning company serving private student housing near university campuses (Miami, Florida, Arizona, Texas, Toronto, McGill). You work alongside the owner like a trusted business partner and right-hand coworker: you know the business, care how it does, and talk with them by voice.

How you work with the owner:
- Talk like a sharp, warm coworker in a real conversation. Use "we" and "our" for the business. Be natural and human, with a bit of personality, never robotic or overly formal.
- Think with them, don't just answer. Give your honest opinion, push back when an idea has a weak spot, point out risks and opportunities they may have missed, and suggest a next step. Ask a short follow-up question when it moves the conversation forward.
- Give real feedback on pricing, margins, operations, sales, marketing, hiring and managing cleaners, clients and growth, and briefly say why.
- Use the business snapshot for facts about clients, invoices, quote requests, cleaners and margins. If something isn't there, say you don't have it rather than guessing.

How to speak:
- Your replies are read aloud by text-to-speech: plain spoken sentences only — no markdown, bullet symbols, headings, emojis or tables.
- Keep it conversational and short by default, usually two to four sentences, and go deeper when asked. Say numbers naturally.

Notes:
- When the owner asks you to note, remember, write down or jot something, call save_note with a short title and the note written clearly, then confirm in one short sentence.
- When a decision or follow-up comes up that they'll want later, offer to note it.

Meetings:
- In meeting mode you're sitting in on a live meeting through a microphone; the transcript is speech-to-text and may contain errors or run speakers together. Someone says "Ace" when they want you. Answer what you were asked, using the meeting so far as context, briefly — people are mid-meeting. You may be speaking to the room, so be professional and never reveal internal figures like supplier costs or margins unless the owner explicitly asks for them.`;

/* ---------- Business snapshot ---------- */

const dollars = (cents) => `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;

function snapshot() {
  const today = new Date().toISOString().slice(0, 10);
  const in14 = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);

  const lines = [`Today is ${today}.`, '', 'Prices A+ charges clients:'];
  CLIENT_PRICES.forEach(([name, price]) => lines.push(`- ${name}: $${price}`));

  const cleaners = all(`
    SELECT c.name, c.company, c.phone, c.email, c.area, s.service, s.cost_cents, s.unit
    FROM cleaners c LEFT JOIN cleaner_services s ON s.cleaner_id = c.id
    WHERE c.active = 1 ORDER BY c.name, s.id`);
  lines.push('', 'Suppliers / cleaners (what they charge A+):');
  if (!cleaners.length) lines.push('- none on file yet');
  for (const c of cleaners) {
    const who = [c.name, c.company && `(${c.company})`, c.area && `area ${c.area}`, c.phone, c.email].filter(Boolean).join(' ');
    lines.push(c.service ? `- ${who}: ${c.service} ${dollars(c.cost_cents)} per ${c.unit}` : `- ${who}: no services listed`);
  }

  const clients = one('SELECT COUNT(*) AS n FROM clients').n;
  const upcoming = all(`
    SELECT o.service_date, o.service_type, o.location, c.name FROM orders o JOIN clients c ON c.id = o.client_id
    WHERE o.status = 'scheduled' AND o.service_date BETWEEN ? AND ? ORDER BY o.service_date LIMIT 25`, today, in14);
  const doneThisMonth = one(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS cents FROM orders
    WHERE status = 'completed' AND service_date >= ?`, monthStart);
  const open = one(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS cents FROM invoices WHERE status = 'open'`);
  const paid = one(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents),0) AS cents FROM invoices
    WHERE status = 'paid' AND COALESCE(paid_at, created_at) >= ?`, monthStart);
  const inquiries = all('SELECT name, residence, plan, message, created_at FROM inquiries ORDER BY id DESC LIMIT 8');

  lines.push('', `Clients with logins: ${clients}.`,
    `Completed cleans this month: ${doneThisMonth.n} (${dollars(doneThisMonth.cents)}).`,
    `Open invoices: ${open.n} totalling ${dollars(open.cents)}. Paid this month: ${paid.n} totalling ${dollars(paid.cents)}.`,
    '', 'Scheduled cleans in the next 14 days:');
  if (!upcoming.length) lines.push('- none');
  upcoming.forEach((o) => lines.push(`- ${o.service_date}: ${o.name}, ${o.service_type}${o.location ? ` at ${o.location}` : ''}`));

  lines.push('', 'Latest website quote requests:');
  if (!inquiries.length) lines.push('- none');
  inquiries.forEach((q) => lines.push(`- ${q.created_at.slice(0, 10)}: ${q.name}${q.residence ? `, ${q.residence}` : ''}${q.plan ? `, ${q.plan}` : ''}${q.message ? ` — "${q.message.slice(0, 160)}"` : ''}`));

  const notes = all('SELECT kind, title, body, created_at FROM assistant_notes ORDER BY id DESC LIMIT 15');
  lines.push('', 'Recent saved notes and meeting summaries:');
  if (!notes.length) lines.push('- none yet');
  notes.forEach((n) => lines.push(`- [${n.created_at.slice(0, 10)}] ${n.kind === 'meeting' ? 'Meeting: ' : ''}${n.title}: ${n.body.slice(0, 400).replace(/\s+/g, ' ')}`));

  return lines.join('\n');
}

/* ---------- Notes ---------- */

const listNotes = () => db.prepare('SELECT id, kind, title, body, created_at, transcript IS NOT NULL AS has_transcript FROM assistant_notes ORDER BY id DESC LIMIT 200').all();

function saveNote({ kind = 'note', title, body, transcript = null }) {
  const { lastInsertRowid } = db.prepare('INSERT INTO assistant_notes (kind, title, body, transcript) VALUES (?, ?, ?, ?)')
    .run(kind, String(title).slice(0, 160) || 'Note', String(body).slice(0, 20000), transcript);
  return db.prepare('SELECT id, kind, title, body, created_at FROM assistant_notes WHERE id = ?').get(Number(lastInsertRowid));
}

const TOOLS = [{
  name: 'save_note',
  description: 'Save a note to the owner\'s notes in the A+ dashboard. Use when the owner asks you to note, remember, write down or jot something, or agrees to save a decision or follow-up.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title, a few words.' },
      body: { type: 'string', description: 'The note, written clearly and completely so it makes sense later.' },
    },
    required: ['title', 'body'],
    additionalProperties: false,
  },
}];

/* ---------- Conversations (kept server-side, append-only) ---------- */

const conversations = new Map();

function getConversation(id) {
  const now = Date.now();
  for (const [key, convo] of conversations) {
    if (now - convo.updated > CONVERSATION_TTL_MS) conversations.delete(key);
  }
  let convo = id && conversations.get(id);
  if (convo && convo.exchanges >= MAX_EXCHANGES) {
    conversations.delete(convo.id);
    convo = null;
  }
  if (!convo) {
    if (conversations.size >= MAX_CONVERSATIONS) conversations.delete(conversations.keys().next().value);
    convo = { id: crypto.randomUUID(), messages: [], updated: now, exchanges: 0, lastSnapshot: null };
    conversations.set(convo.id, convo);
  }
  convo.updated = now;
  return convo;
}

function request(messages, { effort = 'low', tools = true } = {}) {
  return client().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    output_config: { effort },
    // The system prompt never changes and the history is append-only, so the whole prefix is cached
    // and each turn only pays full price for what's new.
    cache_control: { type: 'ephemeral' },
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    ...(tools ? { tools: TOOLS } : {}),
    messages,
  });
}

const snapshotBlock = (snap) => `<business_snapshot>\nLive from the A+ dashboard (use for facts; it may update during the conversation):\n${snap}\n</business_snapshot>`;

const textOf = (response) => response.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();

async function chat({ conversationId, text, meetingTranscript }) {
  const convo = getConversation(conversationId);
  // The live business snapshot rides along in the user turn (only when it changed), keeping the cached prefix stable.
  const snap = snapshot();
  const context = snap !== convo.lastSnapshot ? `${snapshotBlock(snap)}\n\n` : '';
  convo.lastSnapshot = snap;
  const userText = context + (meetingTranscript
    ? `[Meeting mode] The meeting so far (most recent part of the live transcript):\n"""\n${meetingTranscript}\n"""\n\nThe owner just asked you: ${text}`
    : text);
  const messages = [...convo.messages, { role: 'user', content: userText }];
  const saved = [];

  let response;
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    response = await request(messages);
    if (response.stop_reason === 'refusal') {
      // Start fresh rather than carrying a declined turn forward.
      conversations.delete(convo.id);
      return { conversationId: null, reply: 'Sorry, I can’t help with that one. Let’s try something else.', notes: saved };
    }
    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason !== 'tool_use') break;

    const results = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      if (block.name === 'save_note' && typeof block.input?.title === 'string' && typeof block.input?.body === 'string') {
        const note = saveNote({ title: block.input.title, body: block.input.body });
        saved.push(note);
        results.push({ type: 'tool_result', tool_use_id: block.id, content: `Saved as note #${note.id}.` });
      } else {
        results.push({ type: 'tool_result', tool_use_id: block.id, content: 'That tool call was invalid.', is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }

  convo.messages = messages;
  convo.exchanges += 1;
  return { conversationId: convo.id, reply: textOf(response) || 'Done.', notes: saved };
}

async function summarizeMeeting({ title, transcript }) {
  const response = await request([{
    role: 'user',
    content: `${snapshotBlock(snapshot())}\n\nHere is the transcript of a meeting the owner of A+ Cleaning Solutions just had. It is automatic speech-to-text, so fix obvious recognition errors from context.\n\n"""\n${transcript}\n"""\n\nWrite meeting notes for the owner's records in plain text (no markdown symbols). Use these sections, each starting on its own line with the label followed by a colon: Summary (3-6 sentences), Key points, Decisions, Action items (who does what, by when if mentioned), Follow-ups or open questions. Under each section put one item per line starting with "- ". Write "None" where a section is empty. Then add one line starting "Assistant feedback:" with your brief, practical advice for the business based on the meeting.`,
  }], { effort: 'medium', tools: false });
  if (response.stop_reason === 'refusal') throw new Error('The assistant could not summarize this meeting.');
  return saveNote({ kind: 'meeting', title: title || `Meeting ${new Date().toISOString().slice(0, 10)}`, body: textOf(response), transcript });
}

/* ---------- Routes (mounted under the admin router, so owner-only) ---------- */

const router = express.Router();
const str = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function apiError(res, err) {
  console.error('Assistant error:', err.message);
  if (err instanceof Anthropic.AuthenticationError) return res.status(502).json({ error: 'The assistant’s API key was rejected. Check ANTHROPIC_API_KEY in Render.' });
  if (err instanceof Anthropic.RateLimitError) return res.status(503).json({ error: 'The assistant is busy right now. Try again in a moment.' });
  if (err instanceof Anthropic.APIError) return res.status(502).json({ error: 'The assistant couldn’t answer just now. Please try again.' });
  return res.status(500).json({ error: err.message || 'Something went wrong.' });
}

const requireConfigured = (_req, res, next) => (configured()
  ? next()
  : res.status(503).json({ error: 'The assistant isn’t switched on yet. Add ANTHROPIC_API_KEY in Render → Environment.' }));

router.get('/status', (_req, res) => res.json({ configured: configured() }));

router.post('/chat', requireConfigured, async (req, res) => {
  const text = str(req.body?.text, 4000);
  if (!text) return res.status(400).json({ error: 'Say or type something first.' });
  try {
    res.json(await chat({
      conversationId: str(req.body?.conversationId, 64) || null,
      text,
      meetingTranscript: str(req.body?.meetingTranscript, 60000) || null,
    }));
  } catch (err) {
    apiError(res, err);
  }
});

router.post('/meeting/summary', requireConfigured, async (req, res) => {
  const transcript = str(req.body?.transcript, 400000);
  if (transcript.length < 20) return res.status(400).json({ error: 'The meeting transcript is empty — nothing was picked up by the microphone.' });
  try {
    res.json({ note: await summarizeMeeting({ title: str(req.body?.title, 160), transcript }) });
  } catch (err) {
    apiError(res, err);
  }
});

router.get('/notes', (_req, res) => res.json({ notes: listNotes() }));

router.get('/notes/:id/transcript', (req, res) => {
  const row = db.prepare('SELECT transcript FROM assistant_notes WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Note not found.' });
  res.json({ transcript: row.transcript || '' });
});

router.post('/notes', (req, res) => {
  const body = str(req.body?.body, 20000);
  if (!body) return res.status(400).json({ error: 'The note is empty.' });
  res.status(201).json({ note: saveNote({ title: str(req.body?.title, 160) || body.slice(0, 60), body }) });
});

router.delete('/notes/:id', (req, res) => {
  const result = db.prepare('DELETE FROM assistant_notes WHERE id = ?').run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: 'Note not found.' });
  res.json({ ok: true });
});

module.exports = { router, MODEL };
