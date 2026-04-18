# Return Policy & Consumer Rights

## Legal Framework
Bulgarian consumer protection law (ЗЗП) and EU Directive 2011/83/EU apply. The site sells protein bars (6-12 month shelf life) via distance contracts to Bulgarian consumers.

## Withdrawal Right (Право на отказ)
- **14-day withdrawal right** (Чл. 50 ЗЗП) for online purchases, no reason needed
- Period starts from the day the consumer receives the goods
- If seller fails to inform consumer about the right, period extends to **12 months + 14 days**
- **Model withdrawal form** (Приложение № 6 към ЗЗП) is legally required on the site — lives on `/returns` page Section 9

## Legal Exceptions — Must Cite Both
Two exceptions from Чл. 57, ал. 1 ЗЗП apply to food products:
- **т. 4**: goods that deteriorate or expire rapidly (perishability)
- **т. 5**: sealed goods opened after delivery, unsuitable for return for hygiene/health reasons

Both must be cited together. Do not pick just one. Do not blanket-exclude all food products.

Practical clarification uses soft language: "на практика може да бъде упражнено, когато продуктът е неотворен" — not "може само ако". The law defines the exceptions; we explain the practical outcome.

## Wording Rules (Legally Critical)
- **"право на отказ"** = the legal right (withdrawal). **"връщане"** = only the logistics step (shipping goods back)
- Return conditions framed as "Когато правото на отказ е приложимо, стоката следва да бъде:" — conditions are execution-level, not redefining the right
- 48-hour defect report is a **recommendation**, not a legal deadline — 2-year statutory guarantee unaffected
- "в състояние, позволяващо повторна продажба" is subordinate to the statutory diminished-value rule (Чл. 55, ал. 4) — cannot standalone reject a valid withdrawal
- Defect resolution: "в съответствие със законовите права на потребителя" — seller has right to repair/replace first; do NOT give unconditional consumer choice
- No invented thresholds (e.g. ">3 months shelf life") or fixed percentages (e.g. "up to 50% devaluation") without legal basis
- No self-imposed SLAs in legal text (e.g. "confirms in 2 business days") — they create breach risk

## Refund Rules
- Refund within **14 days**, same payment method (Чл. 55 ЗЗП)
- Seller may withhold refund until goods received or proof of shipment (Чл. 55, ал. 5)
- Card payments: Stripe refund to same card
- COD payments: consumer provides IBAN for bank transfer
- Delivery costs refunded only up to the cheapest standard option
- Consumer bears return shipping costs **only if** informed before purchase (checkout disclosure); otherwise seller pays
- Defective/incorrect/damaged goods: seller always covers return shipping

## EU ODR Platform — Discontinued
The EU Online Dispute Resolution platform (ec.europa.eu/consumers/odr) was shut down July 2025. Do NOT reference it anywhere. Use КЗП + Помирителни комисии only for ADR/dispute resolution.

## Pages & Implementation
- `/returns` — dedicated 9-section return policy page (created April 2026)
- `/terms` Section 7 — dual-exception framing with cross-link to /returns
- `/terms` Section 12 — КЗП + Помирителни комисии (no EU ODR)
- Footer — "Право на отказ и връщане" link under "Правна информация"
- Checkout — return shipping cost disclosure between terms and marketing checkboxes

## Competitor Reference (April 2026)
- **FitSpo Zone** — best BG reference: correct т. 5 exception, model form with IBAN, 3-tier complaints
- **BornWinner** — uses only т. 4 (blanket food exemption) — legally risky
- **Pure Gains** — uses both exceptions correctly, simple conditions, but wrong 30-day refund timeline
- **XFuel** — generic Shopify template, no law citations — weakest compliance

## Operational Prerequisites (Must Be Ready Before Pages Go Live)
- Withdrawal notice handling via info@eggorigin.com
- COD refunds by IBAN (manual bank transfer)
- 14-day refund clock tracking
- Complaints register (регистър на рекламациите) with date and reference numbers
- Fiscal handling: bank transfer refunds don't trigger storno; cash refunds would need storno process (НАП)
- Future: `refunded_at`, `refund_amount`, `refund_reason` columns + admin UI for tracking
