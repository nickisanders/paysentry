// Orchestrates one invoice through: parse -> signals -> AI verdict -> policy -> action.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ROOT } from './env.js';
import { runSignals } from './signals.js';
import { aiVerdict } from './verdict.js';
import { loadLedger, findByEmail, recordOutcome } from './ledger.js';
import { recordPayment, cancelInvoice } from './paypal.js';

const DATA = join(ROOT, 'data');
const RESULTS = join(DATA, 'results.json');

export function loadResults() {
  return existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : { processed: {}, spentToday: { date: null, total: 0 } };
}
export function saveResults(res) {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(RESULTS, JSON.stringify(res, null, 2));
}

export function parseInvoice(raw) {
  // raw = PayPal /v2/invoicing invoice object
  const inv = raw.detail ? raw : null;
  const invoicer = raw.invoicer || {};
  const name = invoicer.business_name || [invoicer.name?.given_name, invoicer.name?.surname].filter(Boolean).join(' ');
  // sandbox simulation: sender email rides in memo ("From: x@y"); production reads the real sender
  const memoFrom = (raw.detail?.memo || '').match(/from:\s*([^\s@]+@[^\s]+)/i)?.[1];
  return {
    id: raw.id,
    number: raw.detail?.invoice_number || '',
    vendorName: name || '(unknown)',
    vendorEmail: (memoFrom || invoicer.email_address || '').toLowerCase(),
    amount: parseFloat(raw.amount?.value || '0'),
    currency: raw.amount?.currency_code || 'USD',
    term: raw.detail?.payment_term?.term_type || null,
    note: raw.detail?.note || '',
    memo: raw.detail?.memo || '',
    date: raw.detail?.invoice_date || new Date().toISOString().slice(0, 10),
    items: (raw.items || []).map((i) => ({ name: i.name, qty: i.quantity, value: parseFloat(i.unit_amount?.value || '0') })),
    payByBank: JSON.stringify(raw.detail?.payment_options || {}).includes('PAY_BY_BANK') || /PAY_BY_BANK/.test(JSON.stringify(raw.configuration || {})),
    status: raw.status,
  };
}

function applyPolicy(verdict, inv, screen, policy, vendor, results) {
  const reasons = [];
  let action = verdict.verdict;
  if (action === 'approve') {
    const today = new Date().toISOString().slice(0, 10);
    if (results.spentToday.date !== today) results.spentToday = { date: today, total: 0 };
    if (policy.newPayeeAlwaysHold && !vendor) { action = 'hold'; reasons.push('policy: new payees always hold'); }
    else if (inv.amount > policy.autoPayMax) { action = 'hold'; reasons.push(`policy: $${inv.amount} exceeds auto-pay limit $${policy.autoPayMax}`); }
    else if (results.spentToday.total + inv.amount > policy.dailyAutoPayTotal) { action = 'hold'; reasons.push('policy: daily auto-pay budget exhausted'); }
  }
  return { action, policyReasons: reasons };
}

export async function processInvoice(raw, { execute = true } = {}) {
  const policy = JSON.parse(readFileSync(join(ROOT, 'policy.json'), 'utf8'));
  const ledger = loadLedger();
  const results = loadResults();
  const inv = parseInvoice(raw);

  if (results.processed[inv.id]) return { inv, skipped: true, prior: results.processed[inv.id] };

  const screen = runSignals(inv, ledger, policy);
  const vendor = findByEmail(ledger, inv.vendorEmail);
  const verdict = await aiVerdict(inv, screen, vendor);
  const { action, policyReasons } = applyPolicy(verdict, inv, screen, policy, vendor, results);

  let executed = 'none';
  if (execute) {
    if (action === 'approve') {
      await recordPayment(inv.id, inv.amount.toFixed(2), inv.currency);
      results.spentToday.total += inv.amount;
      recordOutcome(ledger, inv, 'PAID');
      executed = 'paid';
    } else if (action === 'block') {
      await cancelInvoice(inv.id);
      recordOutcome(ledger, inv, 'CANCELLED');
      executed = 'cancelled';
    } else {
      recordOutcome(ledger, inv, 'HOLD');
      executed = 'held';
    }
  }

  const record = {
    invoice: inv,
    screen: { score: screen.score, band: screen.band, signals: screen.signals },
    verdict,
    action,
    policyReasons,
    executed,
    at: new Date().toISOString(),
  };
  results.processed[inv.id] = record;
  saveResults(results);
  return record;
}
