# PaySentry — scope (PayPal AI Hackathon entry)

**One-liner:** An AI payments-fraud analyst that sits between "invoice received" and "money sent." PaySentry triages every inbound PayPal invoice, scores it for fraud, pays the safe ones autonomously within user-set policy limits, holds the suspicious ones, and generates a professional evidence pack for anything it blocks or disputes.

**Why this entry wins attention:** invoice fraud / business email compromise is a multi-billion-dollar FBI IC3 category, every judge has seen a fake invoice, and the builder runs a fraud-investigation firm. Nobody else in the field has the evidence-pack instinct.

---

## Hackathon facts (verified on Devpost, 2026-10-15)

- Deadline: **Nov 12, 2026, 12:00pm PST**. Winners ~Dec 21.
- Online, solo OK, new or existing projects OK ("meaningful progress during hackathon").
- Must meaningfully use **PayPal sandbox + any AI**; working build judges can run (**hosted demo URL satisfies this**); public open-source repo **with LICENSE visible**; **<3 min YouTube demo**; text description naming the AI tools used.
- Prizes (stackable targets, in priority order):
  1. **Best Use of Agentic Commerce, $5K** — agent autonomously operating payments within policy = the core concept
  2. **Best Use of PayPal + AI, $5K** — same build, second ticket
  3. **Best Demo Delivery, $5K** — we already make good demo videos
  4. **AG Grid awards, $5K/$2K/$1Kx3** — build the triage dashboard on AG Grid (we'd want a grid anyway)
  5. Overall 1st/2nd/3rd ($12K/$8K/$5K) and Most Impactful ($5K) — fraud angle is the impact story

## Product scope (MVP)

**Flow:** sandbox PayPal account receives invoices → PaySentry polls/lists them via PayPal Agent Toolkit → each invoice goes through a two-stage screen → verdict drives an action → everything lands in the dashboard queue.

1. **Signal stage (deterministic):** first-time payee vs known vendor list; amount vs historical range for that payee; lookalike vendor-name detection (edit distance vs known vendors); bank-detail/payment-method changes; urgency/pressure language flags; round-number + threshold-dodging amounts; invoice-number sequence anomalies; free-mail sender vs corporate domain mismatch.
2. **AI stage (Claude):** full invoice JSON + signal hits + vendor history go to the model for a reasoned verdict (`approve | hold | block`) with a written rationale. Model output is structured JSON.
3. **Policy engine:** user-set limits (max auto-pay amount, daily total, new-payee always-hold) — the "agent with money, bounded by policy" story that the Agentic Commerce award wants. Mirrors the Agentic Wallet policy concept.
4. **Actions via PayPal Agent Toolkit (sandbox):** approve → pay/record payment; hold → send vendor a verification request (invoice reminder with questions); block → cancel invoice + generate evidence pack.
5. **Evidence pack (the differentiator):** one-click PDF/HTML report per blocked invoice: timeline, signals fired, model rationale, payee history, recommended next steps. Investigation-firm DNA; demo gold.
6. **Dashboard:** AG Grid queue (status, risk score, amount, payee, verdict), detail drawer with the AI rationale, policy settings panel. Dark theme, same aesthetic family as Wallet X-Ray.

**Stretch (only if time):** crypto-invoice tie-in — when an invoice mentions a crypto address, call the live Wallet X-Ray API for counterparty intel (cross-promotes the OKX agent in the same demo).

## Architecture

- **Node/TS service** (matches wallet-xray pattern): PayPal Agent Toolkit TS SDK (or sandbox MCP server) + Claude API (claude-sonnet-5-5 for verdicts; claude-haiku-5-5 if cost matters).
- **Frontend:** single-page dashboard, AG Grid Community, served by the same service.
- **Hosting:** DO App Platform, "Nicki's stuff" team, OKX AI-style sibling project (~$5/mo) → hosted demo URL for judges.
- **Repo:** new public `nickisanders/paysentry`, MIT license at root (explicit requirement).
- **Seed script:** creates the sandbox vendor history + a mixed batch of legit and fraudulent invoices (lookalike vendor, bank-switch, urgency scam) so judges can reproduce the whole demo in one command.

## Demo video (<3 min, aim at Best Demo Delivery)

1. 0:00 hook: "Last year businesses lost $2.9B to fake invoices. This agent reads yours before you pay." 
2. Seed batch arrives → dashboard fills → agent auto-pays a small legit invoice (show the policy that allowed it).
3. The lookalike-vendor invoice gets blocked → open the AI rationale → generate the evidence pack on screen.
4. Policy screen: raise the limit, show behavior change. Close with the live URL + repo.

## Build plan (fits around BU freeze/demo)

- **Weekend 1 (Oct 25-26, ~1.5 days):** sandbox app + toolkit wiring, invoice ingest, signal stage, Claude verdict loop, seed script.
- **Weekend 2 (Nov 1-2, ~1.5 days):** policy engine + actions, AG Grid dashboard, evidence pack, deploy to DO.
- **Nov 3-9 evenings:** polish, seed-data tuning, video, Devpost form. Buffer to Nov 12 deadline.

## Risks / open questions

- PayPal sandbox quirks (invoice webhooks vs polling; buyer-side payment simulation) — resolve in first hour of Weekend 1 with a spike.
- Agent Toolkit tool names vary across docs — treat PayPal dev docs as source of truth, not directories.
- Open-source requirement: keep all fraud heuristics generic/public-knowledge — nothing BU-proprietary in the repo.
- Decide: enter solo as Nicki (creator brand) — assumed yes.
- AI disclosure on the form: Claude (Anthropic API) named as the model.

## Submission checklist

- [ ] Repo public, MIT LICENSE visible in About
- [ ] Hosted demo URL live (judges must be able to interact)
- [ ] Seed/run instructions reproduce demo locally
- [ ] <3 min YouTube video, public
- [ ] Devpost text description naming PayPal products + AI tools used
- [ ] Submitted before Nov 12, 12:00pm PST
