// Vendor ledger: PaySentry's memory of who has billed before and how.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ROOT } from './env.js';

const DATA = join(ROOT, 'data');
const FILE = join(DATA, 'vendors.json');

export function loadLedger() {
  if (!existsSync(FILE)) return { vendors: [] };
  return JSON.parse(readFileSync(FILE, 'utf8'));
}

export function saveLedger(ledger) {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(FILE, JSON.stringify(ledger, null, 2));
}

export function normName(s) {
  return (s || '').toLowerCase().replace(/[.,'’\-]/g, '').replace(/\s+/g, ' ').trim();
}

export const emailDomain = (e) => (e || '').toLowerCase().split('@')[1] || '';

// find vendor by exact email; separately expose name-based lookups for identity signals
export function findByEmail(ledger, email) {
  const lc = (email || '').toLowerCase();
  return ledger.vendors.find((v) => v.email.toLowerCase() === lc) || null;
}

export function findByName(ledger, name) {
  const n = normName(name);
  return ledger.vendors.find((v) => normName(v.name) === n) || null;
}

export function stats(vendor) {
  const amounts = (vendor?.history || []).map((h) => h.amount).sort((a, b) => a - b);
  if (!amounts.length) return { count: 0, median: 0, max: 0 };
  const mid = Math.floor(amounts.length / 2);
  const median = amounts.length % 2 ? amounts[mid] : (amounts[mid - 1] + amounts[mid]) / 2;
  return { count: amounts.length, median, max: amounts[amounts.length - 1] };
}

export function paidCleanCount(vendor) {
  return (vendor?.history || []).filter((h) => h.status === 'PAID').length;
}

export function termMode(vendor) {
  const terms = (vendor?.history || []).map((h) => h.term).filter(Boolean);
  if (!terms.length) return null;
  const freq = {};
  for (const t of terms) freq[t] = (freq[t] || 0) + 1;
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
}

export function recordOutcome(ledger, invoice, outcome) {
  let v = findByEmail(ledger, invoice.vendorEmail);
  if (!v) {
    v = { name: invoice.vendorName, email: invoice.vendorEmail, firstSeen: new Date().toISOString(), history: [], usedPayByBank: false };
    ledger.vendors.push(v);
  }
  v.history.push({
    invoiceId: invoice.id,
    number: invoice.number,
    amount: invoice.amount,
    date: invoice.date,
    term: invoice.term,
    items: invoice.items.map((i) => i.name),
    status: outcome, // PAID | CANCELLED | HOLD
  });
  if (invoice.payByBank) v.usedPayByBank = true;
  saveLedger(ledger);
}
