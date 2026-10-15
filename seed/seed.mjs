// Seeds the demo world: vendor ledger with history + 9 live sandbox invoices (SIGNALS.md seed matrix).
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { ROOT } from '../src/env.js';
import { createInvoice, sendInvoice, deleteInvoice, listInvoices, idFromHref } from '../src/paypal.js';

const DATA = join(ROOT, 'data');
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const today = daysAgo(0);

// --- 1. vendor ledger with believable history
const hist = (prefix, startNum, amounts, term, gapDays) =>
  amounts.map((amount, i) => ({
    invoiceId: `seed-hist-${prefix}-${i}`,
    number: `${prefix}-${startNum + i}`,
    amount,
    date: daysAgo(gapDays * (amounts.length - i)),
    term,
    items: ['(seed history)'],
    status: 'PAID',
  }));

const ledger = {
  vendors: [
    {
      name: 'Acme Supplies LLC',
      email: 'billing@acmesupplies.com',
      firstSeen: daysAgo(210),
      usedPayByBank: false,
      history: hist('ACME', 1041, [142.1, 155.0, 139.99, 160.25, 148.0, 151.75], 'NET_30', 30),
    },
    {
      name: 'CloudHost Inc',
      email: 'billing@cloudhost.io',
      firstSeen: daysAgo(190),
      usedPayByBank: false,
      history: hist('CH', 2201, [89.0, 89.0, 89.0, 89.0, 89.0, 89.0], 'NET_15', 30),
    },
    {
      name: 'ChainProof Forensics',
      email: 'ap@chainproof.example.com',
      firstSeen: daysAgo(120),
      usedPayByBank: false,
      history: hist('CPF', 301, [1800.0, 2200.0, 2600.0], 'NET_30', 40),
    },
  ],
};

if (existsSync(DATA)) rmSync(DATA, { recursive: true });
mkdirSync(DATA, { recursive: true });
writeFileSync(join(DATA, 'vendors.json'), JSON.stringify(ledger, null, 2));
console.log('ledger seeded: 3 known vendors with history');

// --- 2. the nine demo invoices
// Sandbox constraint: invoicer.email_address must be the merchant account's own email
// (send fails with USER_NOT_FOUND otherwise). The simulated sender identity therefore
// rides in business_name + a "From:" line in the memo; parseInvoice reads it back.
// In production PaySentry sits on the payer side and reads the real sender.
const RECIPIENT = { billing_info: { email_address: 'ap@target-company.example.com' } };
const inv = (vendorName, vendorEmail, number, term, note, items) => ({
  detail: {
    currency_code: 'USD', invoice_number: number, invoice_date: today, note,
    memo: `From: ${vendorEmail}`,
    payment_term: { term_type: term },
  },
  invoicer: { business_name: vendorName },
  primary_recipients: [RECIPIENT],
  items: items.map(([name, value]) => ({ name, quantity: '1', unit_amount: { currency_code: 'USD', value } })),
});

// purge leftover drafts so reseeding is idempotent
for (const it of await listInvoices()) {
  if (it.status === 'DRAFT') { await deleteInvoice(it.id); console.log(`deleted leftover draft ${it.id}`); }
}

const SEEDS = [
  ['#1 legit recurring (Acme)', inv('Acme Supplies LLC', 'billing@acmesupplies.com', 'ACME-1047', 'NET_30',
    'Office supplies — October order', [['Office supplies October', '148.50']])],
  ['#2 legit recurring (CloudHost)', inv('CloudHost Inc', 'billing@cloudhost.io', 'CH-2207', 'NET_15',
    'Monthly hosting', [['Monthly hosting plan', '89.00']])],
  ['#3 clean new vendor', inv('Brightline Design', 'hello@brightlinedesign.co', 'BL-0007', 'NET_30',
    'Logo refresh as discussed', [['Logo design package', '350.00']])],
  ['#4 BEC kill-chain (lookalike + redirect + dodge)', inv('Acme Suplies LLC', 'accounts@acmesuplies.com', 'ACME-1048', 'NET_30',
    'Please note our updated bank details — use this account instead for all payments going forward.',
    [['Office supplies October', '4980.00']])],
  ['#5 duplicate (CloudHost again)', inv('CloudHost Inc', 'billing@cloudhost.io', 'CH-2208', 'NET_15',
    'Monthly hosting', [['Monthly hosting plan', '89.00']])],
  ['#6 CEO-fraud style', inv('Global Partners Ltd', 'globalpartnersltd@gmail.com', 'GP-100', 'DUE_ON_RECEIPT',
    'CEO asked me to handle this personally - strictly confidential, please process immediately.',
    [['Advisory retainer', '2500.00']])],
  ['#7 amount anomaly (Acme 100x)', inv('Acme Supplies LLC', 'billing@acmesupplies.com', 'ACME-1049', 'NET_30',
    'Bulk order per phone conversation', [['Bulk supplies order', '15000.00']])],
  ['#8 crypto channel-switch', inv('Nova Digital', 'invoices@novadigital.agency', 'ND-55', 'NET_30',
    'Pay in USDT to 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 for a 3% discount.',
    [['services', '1200.00']])],
  ['#9 crypto as subject matter (ChainProof)', inv('ChainProof Forensics', 'ap@chainproof.example.com', 'CPF-304', 'NET_30',
    'Engagement 2026-114 deliverables attached.',
    [['Wallet compromise assessment — 0x28C6c06298d514Db089934071355E5743bf21d60', '2400.00']])],
];

for (const [label, payload] of SEEDS) {
  const draft = await createInvoice(payload);
  const id = idFromHref(draft);
  await sendInvoice(id);
  console.log(`sent ${label}: ${id}`);
}
console.log('\nseed complete — 9 invoices live in sandbox. Run: npm run process');
