// AI verdict stage. Claude reviews the invoice + fired signals + vendor history
// and returns { verdict, rationale, confidence }. Contract (SIGNALS.md):
//  - may escalate any band
//  - may de-escalate review -> clean with rationale
//  - may NOT de-escalate when LOOKALIKE_VENDOR / DETAIL_SWITCH / SECRECY fired
// Without an API key, falls back to the deterministic band (mode: 'deterministic').
import { ANTHROPIC_API_KEY, CLAUDE_MODEL } from './env.js';
import { stats, paidCleanCount } from './ledger.js';

const BAND_TO_VERDICT = { clean: 'approve', review: 'hold', 'high-risk': 'block' };
const RANK = { approve: 0, hold: 1, block: 2 };

export async function aiVerdict(inv, screen, vendor) {
  const detVerdict = BAND_TO_VERDICT[screen.band];
  if (!ANTHROPIC_API_KEY) {
    return {
      verdict: detVerdict,
      rationale: `Deterministic stage only (no AI key configured): score ${screen.score} (${screen.band}); signals: ${screen.signals.map((s) => s.id).join(', ') || 'none'}.`,
      confidence: 0.5,
      mode: 'deterministic',
    };
  }

  const vendorSummary = vendor
    ? { knownVendor: true, invoicesOnFile: vendor.history.length, paidClean: paidCleanCount(vendor), ...stats(vendor) }
    : { knownVendor: false };

  const prompt = `You are PaySentry, a payments-fraud analyst reviewing a single inbound invoice before payment.

INVOICE:
${JSON.stringify({ vendorName: inv.vendorName, vendorEmail: inv.vendorEmail, amount: inv.amount, currency: inv.currency, term: inv.term, number: inv.number, items: inv.items, note: inv.note, memo: inv.memo }, null, 2)}

VENDOR HISTORY: ${JSON.stringify(vendorSummary)}

DETERMINISTIC SCREEN: score ${screen.score}/100, band "${screen.band}", signals:
${screen.signals.map((s) => `- ${s.id} (${s.pts > 0 ? '+' : ''}${s.pts}): ${s.detail}`).join('\n') || '- none'}

Rules:
- Verdicts: "approve" | "hold" | "block".
- You may escalate above the band's default (${detVerdict}).
- You may de-escalate hold->approve ONLY if the evidence genuinely supports it.
- You may NEVER de-escalate if any of these fired: ${screen.floorSignals.join(', ') || '(none fired)'}.
- Judge like an investigator: who benefits, what changed, what would verification cost.

Reply with ONLY a JSON object: {"verdict": "...", "rationale": "<2-4 sentences, plain language>", "confidence": 0.0-1.0}`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const textOut = j.content?.map((c) => c.text || '').join('') || '';
  const m = textOut.match(/\{[\s\S]*\}/);
  let parsed;
  try { parsed = JSON.parse(m ? m[0] : textOut); } catch {
    return { verdict: detVerdict, rationale: `AI output unparseable; deterministic band kept. Raw: ${textOut.slice(0, 120)}`, confidence: 0.4, mode: 'fallback' };
  }

  let verdict = ['approve', 'hold', 'block'].includes(parsed.verdict) ? parsed.verdict : detVerdict;
  // enforce the de-escalation contract in code, not just in the prompt
  if (screen.floorSignals.length && RANK[verdict] < RANK[detVerdict]) verdict = detVerdict;
  if (screen.band === 'high-risk' && verdict === 'approve') verdict = 'hold';

  return { verdict, rationale: parsed.rationale || '(no rationale)', confidence: parsed.confidence ?? 0.6, mode: 'ai' };
}
