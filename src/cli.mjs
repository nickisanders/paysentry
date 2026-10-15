// PaySentry CLI: `process` runs the pipeline over all SENT sandbox invoices; `reset` clears the world.
import { rmSync, existsSync } from 'fs';
import { join } from 'path';
import { ROOT } from './env.js';
import { listInvoices, getInvoice, cancelInvoice } from './paypal.js';
import { processInvoice } from './engine.js';

const cmd = process.argv[2] || 'process';

if (cmd === 'reset') {
  // cancel outstanding SENT invoices and wipe local state so the demo can re-run
  const items = await listInvoices();
  for (const it of items) {
    if (['SENT','UNPAID'].includes(it.status)) {
      try { await cancelInvoice(it.id); console.log(`cancelled ${it.id}`); } catch (e) { console.log(`skip ${it.id}: ${e.message.slice(0, 80)}`); }
    }
  }
  if (existsSync(join(ROOT, 'data'))) rmSync(join(ROOT, 'data'), { recursive: true });
  console.log('local state cleared');
  process.exit(0);
}

if (cmd === 'process') {
  const items = await listInvoices();
  const sent = items.filter((i) => ['SENT','UNPAID'].includes(i.status)).reverse(); // oldest first
  if (!sent.length) { console.log('no SENT invoices to process'); process.exit(0); }
  console.log(`processing ${sent.length} invoice(s)…\n`);

  const rows = [];
  for (const item of sent) {
    const full = await getInvoice(item.id);
    const r = await processInvoice(full);
    if (r.skipped) { console.log(`- ${r.inv.id} already processed, skipping`); continue; }
    const sig = r.screen.signals.map((s) => s.id).join(',') || '-';
    rows.push({
      invoice: r.invoice.number || r.invoice.id,
      vendor: r.invoice.vendorName.slice(0, 22),
      amount: `$${r.invoice.amount.toFixed(2)}`,
      score: r.screen.score,
      band: r.screen.band,
      verdict: r.verdict.verdict,
      action: r.executed,
      mode: r.verdict.mode,
    });
    console.log(`\n■ ${r.invoice.number} — ${r.invoice.vendorName} — $${r.invoice.amount}`);
    console.log(`  signals: ${sig}`);
    console.log(`  score ${r.screen.score} (${r.screen.band}) -> verdict ${r.verdict.verdict}${r.policyReasons.length ? ` -> ${r.policyReasons.join('; ')}` : ''} -> executed: ${r.executed}`);
    console.log(`  rationale: ${r.verdict.rationale}`);
  }
  console.log('\nSUMMARY');
  console.table(rows);
}
