'use strict';

// Minimal Stripe client for invoice payments via Stripe Checkout.
// Configure with:
//   STRIPE_SECRET_KEY      — sk_test_… (testing) or sk_live_… (real payments)
//   STRIPE_WEBHOOK_SECRET  — optional whsec_… so payments are recorded even if the
//                            client closes their browser before returning to the site
//   STRIPE_CURRENCY        — optional, defaults to cad

const crypto = require('node:crypto');

const API = 'https://api.stripe.com/v1';
const WEBHOOK_TOLERANCE_SECONDS = 300;

const secretKey = () => (process.env.STRIPE_SECRET_KEY || '').trim();
const currency = () => (process.env.STRIPE_CURRENCY || 'cad').toLowerCase();

function status() {
  const key = secretKey();
  return {
    configured: Boolean(key),
    mode: key.startsWith('sk_live_') || key.startsWith('rk_live_') ? 'live' : key ? 'test' : null,
    webhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    currency: currency(),
  };
}

// Stripe's API takes form-encoded bodies with bracketed keys for nested values.
function encode(params, prefix, out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') encode(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}

async function request(method, path, params) {
  const key = secretKey();
  if (!key) throw new Error('Online payments aren’t set up yet (STRIPE_SECRET_KEY is missing).');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: params ? encode(params).toString() : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error?.message || `Stripe responded ${res.status}`;
    throw new Error(`Stripe: ${message}`);
  }
  return data;
}

function createCheckoutSession({ invoice, items, client, successUrl, cancelUrl }) {
  // Array params are encoded as objects keyed by index: line_items[0][…].
  const lineItems = Object.fromEntries(items.map((item, i) => [i, {
    quantity: 1,
    price_data: {
      currency: currency(),
      unit_amount: item.amount_cents,
      product_data: { name: item.description.slice(0, 250) },
    },
  }]));
  return request('POST', '/checkout/sessions', {
    mode: 'payment',
    customer_email: client.email,
    client_reference_id: invoice.invoice_number,
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: lineItems,
    metadata: { invoice_number: invoice.invoice_number },
    payment_intent_data: {
      description: `A+ Cleaning Solutions invoice ${invoice.invoice_number}`,
      receipt_email: client.email,
      metadata: { invoice_number: invoice.invoice_number },
    },
  });
}

const retrieveCheckoutSession = (id) =>
  request('GET', `/checkout/sessions/${encodeURIComponent(id)}?expand[]=payment_intent.latest_charge`);

// Verifies the Stripe-Signature header against the raw request body.
function verifyWebhook(rawBody, header) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set.');
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
  }));
  const signatures = String(header || '').split(',')
    .filter((p) => p.trim().startsWith('v1='))
    .map((p) => p.trim().slice(3));
  const timestamp = Number(parts.t);
  if (!timestamp || !signatures.length) throw new Error('Missing Stripe signature.');
  if (Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) throw new Error('Stripe signature too old.');

  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const ok = signatures.some((sig) => sig.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
  if (!ok) throw new Error('Invalid Stripe signature.');
  return JSON.parse(rawBody);
}

module.exports = { status, createCheckoutSession, retrieveCheckoutSession, verifyWebhook };
