# Sandbox spike — findings & runbook

## Resolved before running (from PayPal Agent Toolkit docs, 2026-10-15)

- **Buyer-payment simulation: solved.** The Invoicing API (and toolkit tool `record_payment_for_invoice`) records an external payment against a sent invoice. No sandbox buyer login needed for the demo loop.
- **Ingest: polling wins for MVP.** `GET /v2/invoicing/invoices` (toolkit `list_invoices`) with status filtering; no webhook plumbing required.
- **Toolkit:** `@paypal/agent-toolkit` (npm, Node 18+, TS) takes PAYPAL_CLIENT_ID/SECRET and exposes the full invoice lifecycle + orders + disputes as agent tools. Spike uses raw REST (zero deps) to verify the platform; build phase layers the toolkit for the agent loop.
- **Sandbox base:** `https://api-m.sandbox.paypal.com`, OAuth2 client-credentials.

## Nicki's 5-minute step (the only blocker)

1. Log in at [developer.paypal.com](https://developer.paypal.com/dashboard/) (PayPal account works; create a developer account if prompted)
2. Apps & Credentials → **Sandbox** tab → Create App (name: `paysentry`, type: Merchant)
3. Copy the **Client ID** and **Secret** into `~/paypal-sentry/.env` (copy `.env.example`)

## Then run

```bash
node spike/run.mjs
```

Expected output: six numbered steps ending in `SPIKE COMPLETE`. That proves token → create → send → poll → record-payment → cancel, i.e. every PayPal interaction the MVP needs.

## Spike result (2026-10-15): COMPLETE — all six steps pass

Verified live against sandbox: token → create (INV2-TZF6…) → send → poll/list → record payment (status MARKED_AS_PAID) → cancel second invoice (status CANCELLED).

Gotchas found (already handled in spike/run.mjs):
1. **Sandbox apps don't get Invoicing by default.** Enable it per app: dashboard → app → Features → Invoicing. Without it every /v2/invoicing call 403s NOT_AUTHORIZED.
2. **PayPal caches OAuth tokens (~9h).** After changing app features, the cached token keeps the old scopes. Pass `ignoreCache=true` in the token request body.

## Open items for Weekend 1 (not blockers)

- Layer `@paypal/agent-toolkit` into the agent loop (ai-sdk flavor) and confirm its tool schemas match the REST behavior verified here
- Check sandbox rate limits while seeding ~20 invoices
- Confirm `detail.note` + item names give enough text surface for fraud-signal demo data (fallback: memo/terms fields)
