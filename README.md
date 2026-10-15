# PaySentry

An AI payments-fraud analyst that sits between "invoice received" and "money sent."

PaySentry watches a PayPal inbox of inbound invoices, screens each one through a two-stage pipeline, pays the safe ones autonomously within policy limits you set, holds the questionable ones for a human, and blocks the fraudulent ones with a documented rationale.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/). Invoice fraud and business email compromise cost businesses billions every year ([FBI IC3](https://www.ic3.gov/) tracks BEC as one of the largest loss categories); almost all of it is catchable with the context a machine can hold and a human skips when busy.

## How it works

```
PayPal invoices (sandbox) ──▶ 1. Signal stage (deterministic)   15 fraud signals, scored 0–100
                              2. AI stage (Claude)              reasoned verdict + rationale
                              3. Policy engine                  your limits always win
                              └▶ action: pay / hold / block     executed via PayPal API
```

- **Signal stage** ([SIGNALS.md](SIGNALS.md)): lookalike-vendor detection (edit distance), payment-redirect language, amount anomalies vs vendor history, threshold dodging, duplicate billing, urgency/secrecy phrasing, crypto channel-switch demands, and more. Combination rules floor the canonical BEC kill-chain (lookalike vendor + "updated bank details") at 85/100.
- **AI stage**: Claude reviews the invoice, fired signals, and vendor history, and returns a verdict with a written rationale. It may escalate anything; it may never talk the system down off a lookalike, payment-redirect, or secrecy signal (enforced in code, not just in the prompt). With no API key configured, the deterministic band stands on its own.
- **Policy engine**: auto-pay ceiling, daily budget, new-payees-always-hold. A clean AI verdict still can't spend past your limits.
- **Vendor ledger**: PaySentry remembers every processed invoice, so trust is earned (clean history lowers scores) and anomalies have a baseline.

It knows the difference between an invoice *about* a wallet and an invoice *demanding payment to* one.

## Run it

```bash
# 1. PayPal sandbox app (developer.paypal.com) with the Invoicing feature enabled
cp .env.example .env   # add PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET
                       # optional: ANTHROPIC_API_KEY for the AI stage

# 2. seed the demo world: 3 known vendors with history + 9 live invoices
#    (2 legit, 4 that should hold, 3 frauds)
npm run seed

# 3. run the analyst
npm run process

# rewind everything
npm run reset
```

Zero npm dependencies. Node 20+.

## Sandbox note

PayPal pins an invoice's `invoicer.email_address` to the sandbox account, so the seed script carries each simulated sender in `business_name` plus a `From:` line in the memo, which the parser reads back. In production, PaySentry sits on the payer side and reads the real sender identity.

## Tools

PayPal Invoicing v2 REST API (sandbox) · Claude (Anthropic API) for the verdict stage.
