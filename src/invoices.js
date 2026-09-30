'use strict';

// Invoice records shared by the owner dashboard, the client portal and Stripe callbacks.

const db = require('./db');
const notify = require('./notify');

const logEmailError = (label) => (err) => console.error(`${label} email failed:`, err.message);

function itemsFor(invoiceId) {
  return db.prepare('SELECT description, amount_cents FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(invoiceId);
}

function withItems(invoice) {
  return invoice ? { ...invoice, items: itemsFor(invoice.id) } : null;
}

function findByNumber(invoiceNumber) {
  return db.prepare('SELECT * FROM invoices WHERE invoice_number = ?').get(invoiceNumber);
}

function listForClient(clientId) {
  return db.prepare(`
    SELECT id, invoice_number, status, amount_cents, due_date, service_date, service_time, notes, receipt_url, paid_at, created_at
    FROM invoices WHERE client_id = ? AND status != 'void'
    ORDER BY (status = 'open') DESC, created_at DESC, id DESC
  `).all(clientId).map((inv) => {
    const { id, ...rest } = withItems(inv);
    return rest;
  });
}

function listAll() {
  return db.prepare(`
    SELECT i.id, i.invoice_number, i.client_id, c.name AS client_name, c.email AS client_email, i.status,
           i.amount_cents, i.due_date, i.service_date, i.service_time, i.notes, i.paid_method, i.paid_at, i.receipt_url, i.created_at
    FROM invoices i JOIN clients c ON c.id = i.client_id
    ORDER BY i.id DESC
  `).all().map(withItems);
}

function create({ clientId, items, dueDate, serviceDate, serviceTime, notes, inquiryId }) {
  const total = items.reduce((sum, item) => sum + item.amount_cents, 0);
  const invoiceNumber = db.nextInvoiceNumber();
  db.exec('BEGIN');
  try {
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO invoices (invoice_number, client_id, amount_cents, due_date, service_date, service_time, notes, inquiry_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(invoiceNumber, clientId, total, dueDate || null, serviceDate || null, serviceTime || null, notes || null, inquiryId || null);
    const insertItem = db.prepare('INSERT INTO invoice_items (invoice_id, description, amount_cents) VALUES (?, ?, ?)');
    for (const item of items) insertItem.run(lastInsertRowid, item.description, item.amount_cents);
    if (inquiryId) db.prepare('UPDATE inquiries SET invoice_number = ? WHERE id = ?').run(invoiceNumber, inquiryId);
    db.exec('COMMIT');
    return withItems(db.prepare('SELECT * FROM invoices WHERE id = ?').get(lastInsertRowid));
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Idempotent: only the first call for an open invoice changes anything or sends the alert.
function markPaid(invoice, { method, paymentIntent = null, receiptUrl = null }) {
  const result = db.prepare(`
    UPDATE invoices
    SET status = 'paid', paid_method = ?, stripe_payment_intent = COALESCE(?, stripe_payment_intent),
        receipt_url = COALESCE(?, receipt_url), paid_at = datetime('now')
    WHERE id = ? AND status = 'open'
  `).run(method, paymentIntent, receiptUrl, invoice.id);
  if (result.changes) {
    const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoice.id);
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(updated.client_id);
    notify.sendPaymentAlert({ client, invoice: updated }).catch(logEmailError('Payment alert'));
  }
  return result.changes > 0;
}

// Records a completed Stripe Checkout session against its invoice.
function applyCheckoutSession(session) {
  const invoiceNumber = session.metadata?.invoice_number || session.client_reference_id;
  const invoice = invoiceNumber && findByNumber(invoiceNumber);
  if (!invoice || session.payment_status !== 'paid') return { invoice, paid: false };
  // Guard against a session for a different amount (e.g. an edited invoice).
  if (Number(session.amount_total) !== invoice.amount_cents) {
    console.error(`Stripe session ${session.id} amount ${session.amount_total} ≠ invoice ${invoice.invoice_number} ${invoice.amount_cents}`);
    return { invoice, paid: false };
  }
  const pi = session.payment_intent;
  markPaid(invoice, {
    method: 'stripe',
    paymentIntent: typeof pi === 'string' ? pi : pi?.id,
    receiptUrl: typeof pi === 'object' ? pi?.latest_charge?.receipt_url : null,
  });
  return { invoice: findByNumber(invoiceNumber), paid: true };
}

module.exports = { findByNumber, listForClient, listAll, create, markPaid, applyCheckoutSession, itemsFor };
