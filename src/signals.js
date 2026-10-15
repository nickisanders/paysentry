// Deterministic fraud-signal stage. Implements SIGNALS.md exactly.
// Pure functions: (parsed invoice, ledger, policy) -> { signals: [...], score, band }
import { findByEmail, findByName, normName, emailDomain, stats, paidCleanCount, termMode } from './ledger.js';

const FREEMAIL = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'proton.me', 'protonmail.com', 'icloud.com'];
const ENTITY_TOKENS = /\b(llc|inc|ltd|gmbh|corp|co)\b/i;

const URGENCY_RE = /\b(urgent(ly)?|immediately|today only|right away|final notice|act now|within 24 hours|wire (the|this|payment|funds))\b/i;
const SECRECY_RE = /\b(confidential|do not discuss|keep this between|(ceo|cfo) (asked|requested)|discreet(ly)?)\b/i;
const DETAIL_SWITCH_RE = /\b(new bank|new account details|updated (payment|bank|account) (info|details)|pay to (the )?(new|different|below)|use this account instead)\b/i;
const CRYPTO_REDIRECT_RE = /\b(pay (in|with) (crypto|usdt|usdc|btc|bitcoin|eth)|send to (this|my|our) wallet|settle in crypto)\b/i;
const EVM_RE = /0x[a-fA-F0-9]{40}/;
const BTC_RE = /\b(bc1[a-z0-9]{20,}|[13][1-9A-HJ-NP-Za-km-z]{25,34})\b/;
const VAGUE_ITEMS = ['services', 'consulting', 'miscellaneous', 'fees', 'payment', 'consulting services', 'professional services'];

// Damerau-Levenshtein, small strings only
export function editDistance(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

export function runSignals(inv, ledger, policy) {
  const fired = [];
  const add = (id, pts, detail) => fired.push({ id, pts, detail });

  const text = [inv.note, inv.memo, ...inv.items.map((i) => i.name)].filter(Boolean).join(' \n ');
  const byEmail = findByEmail(ledger, inv.vendorEmail);
  const byName = findByName(ledger, inv.vendorName);
  const known = byEmail; // identity = email
  const vstats = stats(known);

  // --- A. identity / payee
  if (!known) add('NEW_PAYEE', 15, `first invoice from ${inv.vendorEmail}`);

  if (!known) {
    // lookalike: near-but-not-exact name or domain vs any known vendor
    for (const v of ledger.vendors) {
      const nd = editDistance(normName(inv.vendorName), normName(v.name));
      const dd = editDistance(emailDomain(inv.vendorEmail), emailDomain(v.email));
      const nameLike = nd > 0 && nd <= 2;
      const domainLike = dd > 0 && dd <= 2;
      if (nameLike || domainLike) {
        add('LOOKALIKE_VENDOR', 45, `resembles known vendor "${v.name}" (name dist ${nd}, domain dist ${dd})`);
        break;
      }
    }
  }

  if (!byEmail && byName) {
    add('DOMAIN_SWITCH', 40, `name matches known vendor "${byName.name}" but email ${inv.vendorEmail} differs from ${byName.email}`);
  }

  if (ENTITY_TOKENS.test(inv.vendorName) && FREEMAIL.includes(emailDomain(inv.vendorEmail))) {
    add('FREEMAIL_CORP', 20, `corporate name on free mailbox (${emailDomain(inv.vendorEmail)})`);
  }

  // --- B. amount / behavior
  if (known && vstats.count >= 2 && inv.amount > Math.max(3 * vstats.median, vstats.max * 1.5)) {
    add('AMOUNT_ANOMALY', 25, `$${inv.amount} vs median $${vstats.median} / max $${vstats.max}`);
  }

  for (const L of [policy.autoPayMax, policy.reviewMax].filter(Boolean)) {
    if (inv.amount >= 0.9 * L && inv.amount < L) {
      add('THRESHOLD_DODGE', 20, `$${inv.amount} sits just under the $${L} limit`);
      break;
    }
  }

  if (known) {
    const fourteenDays = 14 * 864e5, thirtyDays = 30 * 864e5;
    const now = new Date(inv.date || Date.now()).getTime();
    const itemsNorm = inv.items.map((i) => normName(i.name)).sort().join('|');
    for (const h of known.history) {
      const age = now - new Date(h.date).getTime();
      const sameAmount = Math.abs(h.amount - inv.amount) < 0.01 && age >= 0 && age <= fourteenDays;
      const sameItems = itemsNorm && (h.items || []).map(normName).sort().join('|') === itemsNorm && age >= 0 && age <= thirtyDays;
      if (sameAmount || sameItems) {
        add('DUPLICATE_INVOICE', 25, `matches ${h.invoiceId || h.number} (${sameAmount ? 'same amount within 14d' : 'same items within 30d'})`);
        break;
      }
    }
  }

  if (known) {
    const nums = known.history.map((h) => parseInt((h.number || '').replace(/\D/g, ''), 10)).filter(Number.isFinite);
    const mine = parseInt((inv.number || '').replace(/\D/g, ''), 10);
    if (nums.length >= 3 && Number.isFinite(mine)) {
      const ascending = nums.every((n, i) => i === 0 || n > nums[i - 1]);
      if (ascending && mine <= nums[nums.length - 1]) {
        add('INVOICE_SEQ_ANOMALY', 10, `number ${mine} regresses vs last ${nums[nums.length - 1]}`);
      }
    }
  }

  const mode = termMode(known);
  if (inv.term === 'DUE_ON_RECEIPT' && ((mode && mode !== 'DUE_ON_RECEIPT') || (!known && inv.amount >= 500))) {
    add('TERM_PRESSURE', 10, known ? `history mode is ${mode}` : 'new payee demanding immediate terms on $500+');
  }

  // --- C. content / language
  if (URGENCY_RE.test(text)) add('URGENCY', 15, text.match(URGENCY_RE)[0]);
  if (SECRECY_RE.test(text)) add('SECRECY', 30, text.match(SECRECY_RE)[0]);

  const newPayByBank = inv.payByBank && known && !known.usedPayByBank;
  if (DETAIL_SWITCH_RE.test(text) || newPayByBank) {
    add('DETAIL_SWITCH', 45, DETAIL_SWITCH_RE.test(text) ? text.match(DETAIL_SWITCH_RE)[0] : 'PAY_BY_BANK newly enabled');
  }

  const cryptoAddr = text.match(EVM_RE)?.[0] || text.match(BTC_RE)?.[0] || null;
  const cryptoRedirect = CRYPTO_REDIRECT_RE.test(text);
  if (cryptoAddr && cryptoRedirect) {
    add('CRYPTO_DEMAND', 35, `channel-switch demand: "${text.match(CRYPTO_REDIRECT_RE)[0]}" -> ${cryptoAddr.slice(0, 10)}…`);
  } else if (cryptoAddr) {
    add('CRYPTO_CONTEXT', 5, `address present as subject matter: ${cryptoAddr.slice(0, 10)}…`);
  }

  if (
    inv.items.length === 1 &&
    VAGUE_ITEMS.includes(normName(inv.items[0].name)) &&
    inv.amount >= 1000
  ) {
    add('VAGUE_HIGH', 10, `single vague line item "${inv.items[0].name}" at $${inv.amount}`);
  }

  // --- D. combinations
  const has = (id) => fired.some((s) => s.id === id);
  let score = fired.reduce((s, f) => s + f.pts, 0);

  if (has('NEW_PAYEE') && (has('URGENCY') || has('SECRECY') || has('DETAIL_SWITCH') || has('CRYPTO_DEMAND'))) {
    score += 15;
    add('COMBO_NEW_PAYEE_PRESSURE', 15, 'new payee + pressure/redirect signal');
  }
  let floor = 0;
  if (has('LOOKALIKE_VENDOR') && has('DETAIL_SWITCH')) {
    floor = 85;
    add('COMBO_BEC_KILLCHAIN', 0, 'lookalike vendor + payment redirect: score floored at 85');
  }
  if (known && paidCleanCount(known) >= 5 && fired.length === 0) {
    score -= 10;
    add('TRUST_CREDIT', -10, `${paidCleanCount(known)} clean paid invoices on file`);
  }

  score = Math.max(floor, Math.min(100, Math.max(0, score)));
  const band = score >= 60 ? 'high-risk' : score >= 25 ? 'review' : 'clean';
  const floorSignals = fired.filter((s) => ['LOOKALIKE_VENDOR', 'DETAIL_SWITCH', 'SECRECY'].includes(s.id)).map((s) => s.id);

  return { signals: fired, score, band, floorSignals, cryptoAddr };
}
