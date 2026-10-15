// Thin PayPal sandbox REST client. Raw fetch, no SDK.
import { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } from './env.js';

const BASE = 'https://api-m.sandbox.paypal.com';
let cached = { token: null, exp: 0 };

export async function token() {
  if (cached.token && Date.now() < cached.exp - 60_000) return cached.token;
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded',
    },
    // ignoreCache: PayPal serves cached tokens that keep pre-feature-change scopes
    body: 'grant_type=client_credentials&ignoreCache=true',
  });
  if (!r.ok) throw new Error(`oauth ${r.status}: ${await r.text()}`);
  const j = await r.json();
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

async function api(method, path, body) {
  const t = await token();
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return null; }
}

export const createInvoice = (payload) => api('POST', '/v2/invoicing/invoices', payload);
export const deleteInvoice = (id) => api('DELETE', `/v2/invoicing/invoices/${id}`);
export const sendInvoice = (id) => api('POST', `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: false });
export const getInvoice = (id) => api('GET', `/v2/invoicing/invoices/${id}`);
export const cancelInvoice = (id) =>
  api('POST', `/v2/invoicing/invoices/${id}/cancel`, { send_to_recipient: false });
export const remindInvoice = (id, note) =>
  api('POST', `/v2/invoicing/invoices/${id}/remind`, { send_to_recipient: false, note });
export const recordPayment = (id, value, currency = 'USD', note = 'PaySentry: approved and paid') =>
  api('POST', `/v2/invoicing/invoices/${id}/payments`, {
    method: 'OTHER',
    amount: { currency_code: currency, value },
    note,
  });

export async function listInvoices(pageSize = 50) {
  const out = [];
  let page = 1;
  for (;;) {
    const j = await api('GET', `/v2/invoicing/invoices?page=${page}&page_size=${pageSize}&total_required=true`);
    out.push(...(j.items || []));
    if (!j.links?.some((l) => l.rel === 'next')) break;
    page += 1;
    if (page > 10) break;
  }
  return out;
}

export function idFromHref(obj) {
  const href = obj?.href || obj?.links?.find((l) => l.rel === 'self')?.href;
  return href?.split('/').pop();
}
