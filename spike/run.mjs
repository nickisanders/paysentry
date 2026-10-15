// PaySentry sandbox spike — verifies the full invoice loop against PayPal sandbox.
// Run: node spike/run.mjs   (needs PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET in env or .env)
//
// Proves, in order:
//   1. OAuth client-credentials token works
//   2. Create a draft invoice
//   3. Send it (no real email in sandbox unless recipient is a sandbox account)
//   4. List invoices + read one back (the PaySentry ingest path = polling)
//   5. Record an external payment against it (buyer-payment simulation for demos)
//   6. Cancel flow on a second invoice (the "block" action)

import { readFileSync, existsSync } from 'fs';

// minimal .env loader (no deps)
if (existsSync(new URL('../.env', import.meta.url))) {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const BASE = 'https://api-m.sandbox.paypal.com';
const ID = process.env.PAYPAL_CLIENT_ID;
const SECRET = process.env.PAYPAL_CLIENT_SECRET;
if (!ID || !SECRET) {
  console.error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (see .env.example). Spike not run.');
  process.exit(1);
}

const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

async function api(method, path, body, token, extraHeaders = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* some endpoints return 204/empty */ }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${text.slice(0, 400)}`);
  return json;
}

// 1. token
step(1, 'OAuth client-credentials token');
const tokRes = await fetch(`${BASE}/v1/oauth2/token`, {
  method: 'POST',
  headers: {
    authorization: 'Basic ' + Buffer.from(`${ID}:${SECRET}`).toString('base64'),
    'content-type': 'application/x-www-form-urlencoded',
  },
  body: 'grant_type=client_credentials',
});
if (!tokRes.ok) { console.error('token failed:', tokRes.status, await tokRes.text()); process.exit(1); }
const { access_token: token, expires_in } = await tokRes.json();
console.log(`    ok — token acquired, expires_in=${expires_in}s`);

// 2. create a draft invoice (legit-looking)
step(2, 'create draft invoice');
const draft = await api('POST', '/v2/invoicing/invoices', {
  detail: {
    currency_code: 'USD',
    note: 'Monthly retainer — October',
    payment_term: { term_type: 'NET_30' },
  },
  invoicer: { name: { given_name: 'PaySentry', surname: 'Spike' } },
  primary_recipients: [{ billing_info: { email_address: 'sb-buyer@business.example.com' } }],
  items: [{ name: 'Consulting services', quantity: '1', unit_amount: { currency_code: 'USD', value: '150.00' } }],
}, token);
const invUrl = draft?.href || draft?.links?.find((l) => l.rel === 'self')?.href;
const invId = invUrl?.split('/').pop();
console.log(`    ok — draft created: ${invId}`);

// 3. send it
step(3, 'send invoice');
await api('POST', `/v2/invoicing/invoices/${invId}/send`, { send_to_recipient: true }, token);
console.log('    ok — sent');

// 4. list + read back (PaySentry ingest = polling this)
step(4, 'list invoices (ingest path)');
const list = await api('GET', '/v2/invoicing/invoices?page_size=5&total_required=true', null, token);
console.log(`    ok — total_items=${list.total_items}; latest: ${list.items?.map((i) => `${i.id}:${i.status}`).join(', ')}`);
const readBack = await api('GET', `/v2/invoicing/invoices/${invId}`, null, token);
console.log(`    ok — read back ${invId}, status=${readBack.status}, amount=${readBack.amount?.value} ${readBack.amount?.currency_code}`);

// 5. record external payment (demo's "buyer paid" simulation)
step(5, 'record payment against invoice');
await api('POST', `/v2/invoicing/invoices/${invId}/payments`, {
  method: 'OTHER',
  amount: { currency_code: 'USD', value: '150.00' },
  note: 'spike: simulated buyer payment',
}, token);
const paid = await api('GET', `/v2/invoicing/invoices/${invId}`, null, token);
console.log(`    ok — status now: ${paid.status}`);

// 6. cancel flow on a second invoice (the "block" action)
step(6, 'create + send + cancel a second invoice (block path)');
const draft2 = await api('POST', '/v2/invoicing/invoices', {
  detail: { currency_code: 'USD', note: 'URGENT wire needed today' },
  primary_recipients: [{ billing_info: { email_address: 'sb-buyer@business.example.com' } }],
  items: [{ name: 'Urgent services', quantity: '1', unit_amount: { currency_code: 'USD', value: '4999.00' } }],
}, token);
const inv2 = (draft2?.href || draft2?.links?.find((l) => l.rel === 'self')?.href)?.split('/').pop();
await api('POST', `/v2/invoicing/invoices/${inv2}/send`, { send_to_recipient: true }, token);
await api('POST', `/v2/invoicing/invoices/${inv2}/cancel`, { send_to_recipient: false }, token);
const cancelled = await api('GET', `/v2/invoicing/invoices/${inv2}`, null, token);
console.log(`    ok — ${inv2} status: ${cancelled.status}`);

console.log('\nSPIKE COMPLETE — full loop verified: token, create, send, poll, record-payment, cancel.');
console.log('PaySentry can ingest by polling and act without webhooks or buyer logins.');
