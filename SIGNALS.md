# PaySentry fraud-signal catalog (draft for review)

Deterministic stage of the two-stage screen. Every signal is computable from (a) the PayPal invoice object and (b) PaySentry's own vendor ledger built from prior processed invoices. Nothing here uses licensed data or BU-proprietary methods; all patterns are public knowledge (FBI IC3 BEC advisories, AFP fraud guides).

Each signal: id, what it catches, exact logic, points. Points feed a 0-100 risk score (capped), which sets the deterministic band before the AI stage.

## Inputs

- **Invoice fields:** invoicer name + email, recipient, items[] (name, qty, unit_amount), amount, currency, detail.note, detail.memo, detail.payment_term, invoice_number, detail.invoice_date, payment method flags (e.g. PAY_BY_BANK)
- **Vendor ledger (vendors.json, maintained by PaySentry):** per vendor: canonical name, email + domain, invoice history (amounts, dates, invoice_numbers, payment_terms), lifetime count, first/last seen

## Signals

### A. Identity / payee

| id | catches | logic | pts |
|---|---|---|---|
| NEW_PAYEE | first-time sender | invoicer email not in ledger | 15 |
| LOOKALIKE_VENDOR | typosquatted vendor | invoicer name OR email domain has Damerau-Levenshtein distance 1-2 to a known vendor's, but is not an exact match (case/punctuation-normalized first) | 45 |
| DOMAIN_SWITCH | known vendor, new email | invoicer name matches known vendor exactly, email domain differs from ledger | 40 |
| FREEMAIL_CORP | company name, personal mailbox | invoicer name contains legal-entity token (LLC, Inc, Ltd, GmbH, Corp) AND email domain ∈ {gmail, outlook, hotmail, yahoo, proton, icloud} | 20 |

### B. Amount / behavior

| id | catches | logic | pts |
|---|---|---|---|
| AMOUNT_ANOMALY | inflated bill | known vendor AND amount > max(3x vendor median, vendor max + 50%) | 25 |
| THRESHOLD_DODGE | approval-limit gaming | amount in [0.9 × L, L) for any policy limit L (auto-pay limit, review limit) | 20 |
| DUPLICATE_INVOICE | double billing | same vendor AND same amount within 14 days, OR identical normalized item set within 30 days | 25 |
| INVOICE_SEQ_ANOMALY | hijacked numbering | vendor history has ≥3 parseable sequential invoice numbers AND new number regresses or jumps backward | 10 |
| TERM_PRESSURE | rushed terms | payment_term = DUE_ON_RECEIPT and vendor history mode is NET_15/30/45 (or new payee + DUE_ON_RECEIPT + amount ≥ $500) | 10 |

### C. Content / language (scanned over note + memo + item names, case-insensitive)

| id | catches | logic | pts |
|---|---|---|---|
| URGENCY | pressure tactics | ≥1 of: urgent(ly), immediately, today only, right away, final notice, act now, within 24 hours, wire (as payment verb) | 15 |
| SECRECY | BEC hallmark | ≥1 of: confidential, do not discuss, keep this between, CEO/CFO asked/requested, discreet | 30 |
| DETAIL_SWITCH | redirected payment | phrases matching: new bank/account details, updated payment info, pay to (new\|different\|below), use this account instead; OR PAY_BY_BANK newly enabled for a vendor who never used it | 45 |
| CRYPTO_DEMAND | off-ramp redirect | an address regex hit (EVM 0x[a-fA-F0-9]{40}; BTC bc1[a-z0-9]{20,}\|[13][1-9A-HJ-NP-Za-km-z]{25,34}) **AND** payment-redirect phrasing near it: pay in/with (crypto\|USDT\|USDC\|BTC\|bitcoin\|ETH), send to (this\|my) wallet, settle in crypto. Channel-switch demand: PayPal rail in, irreversible rail out | 35 |
| CRYPTO_CONTEXT | address as subject matter | address regex hit WITHOUT redirect phrasing (e.g. line item "wallet audit of 0x…"). Informational only; still fires the Wallet X-Ray lookup so the evidence/record gets the counterparty snapshot | 5 |
| VAGUE_HIGH | thin justification | single line item, item name ∈ {services, consulting, miscellaneous, fees, payment} (≤2 words), amount ≥ $1,000 | 10 |

### D. Combination multipliers (applied after summing)

- NEW_PAYEE + (URGENCY or SECRECY or DETAIL_SWITCH or CRYPTO_DEMAND): +15
- LOOKALIKE_VENDOR + DETAIL_SWITCH: score floor 85 (this is the canonical BEC kill-chain; never let it look mild)
- Known vendor, clean history ≥5 paid invoices, zero signals: -10 (trust credit, floor 0)

## Scoring bands (deterministic stage output)

| score | band | default action before AI stage |
|---|---|---|
| 0-24 | clean | eligible for auto-pay (policy permitting) |
| 25-59 | review | hold, queue for human |
| 60-100 | high-risk | block recommended |

**AI stage contract:** Claude receives invoice + fired signals + vendor history and returns `{verdict, rationale, confidence}`. It may escalate any band. It may de-escalate review→clean with stated rationale, but may NOT de-escalate anything containing LOOKALIKE_VENDOR, DETAIL_SWITCH, or SECRECY (deterministic floor; the rationale still gets recorded). Final action = min(AI verdict, policy engine): e.g. clean verdict still holds if amount > auto-pay limit or payee is new and policy says new payees always hold.

## Seed matrix (what the demo batch triggers)

| # | seed invoice | signals fired | expected outcome |
|---|---|---|---|
| 1 | Acme Supplies LLC, $148.50, NET_30, item "Office supplies March" (5 prior paid) | none (trust credit) | auto-paid under policy |
| 2 | CloudHost Inc, $89.00, monthly recurring, matches history | none | auto-paid |
| 3 | New vendor "Brightline Design", $350, clean invoice | NEW_PAYEE | hold (policy: new payees hold), AI notes it looks legitimate |
| 4 | "Acme Supplies LLC." (trailing dot), $4,980, note "updated bank details, use account below" | LOOKALIKE_VENDOR, DETAIL_SWITCH, THRESHOLD_DODGE → floor 85 | block + evidence pack (demo centerpiece) |
| 5 | Known vendor CloudHost, $89.00 again 3 days later | DUPLICATE_INVOICE | hold, AI flags double-bill |
| 6 | "Global Partners Ltd" from gmail, $2,500, DUE_ON_RECEIPT, note "CEO asked to keep this confidential, process immediately" | NEW_PAYEE, FREEMAIL_CORP, SECRECY, URGENCY, TERM_PRESSURE, combo bonus | block + evidence pack |
| 7 | Known vendor, $15,000 vs median $400 | AMOUNT_ANOMALY | hold, AI asks for verification |
| 8 | New vendor, $1,200, item "services", note "pay in USDT to 0xd8dA…6045" | NEW_PAYEE, CRYPTO_DEMAND, VAGUE_HIGH, combo bonus → 75 | block via combo scoring (no hard rule) + Wallet X-Ray snapshot in evidence pack (stretch) |
| 9 | "ChainProof Forensics", $2,400, line item "Wallet compromise assessment — 0x28C6…1d60", clean history | CRYPTO_CONTEXT only (5) | auto-pay or hold per payee-newness policy; demo line: "it knows an invoice *about* a wallet from an invoice *demanding payment to* one" |

Ledger bootstrap: seed script writes vendors.json directly with synthetic history (5-8 prior invoices for Acme + CloudHost) rather than creating 30 paid sandbox invoices. Faster, deterministic, and judges can read it.

## Open questions for Nicki (tune from the day job)

1. AMOUNT_ANOMALY: is 3x median / max+50% the right shape, or do you prefer stddev-based for vendors with volatile billing?
2. Phrase lists: additions from real BEC cases you've seen? (Generic/public phrasing only; nothing from client casework.)
3. Points and the 25/60 band cuts: sane, or tune after seeing seed-batch scores?
4. Trust credit (-10 after 5 clean paid invoices): keep, or does it offend the investigator instinct?
5. ~~CRYPTO_DEMAND hard-block?~~ Resolved 2026-10-15: no hard block. Split into CRYPTO_DEMAND (redirect phrasing + address, 35 pts; new-payee combo already reaches block band) and CRYPTO_CONTEXT (address as subject matter, 5 pts, still triggers Wallet X-Ray enrichment). Rationale: address-presence alone would block legitimate forensics/crypto-industry invoices, and a known vendor demanding crypto should hold-for-verification (possible account compromise), not silently block.
