-- Migration 20260420160831: Timestamp monotonicity invariants on orders
--
-- Two CHECK constraints, both null-safe (allow rows in-flight where later
-- stages haven't happened yet).
--
-- chk_shipped_after_confirmed: shipped_at requires confirmed_at and must be
--   at or after it. Both timestamps are ours (set by the app) so there's no
--   cross-clock drift — strict comparison is safe.
--
-- chk_delivered_after_shipped: delivered_at requires shipped_at and must be
--   at or after it, tolerating up to 1 hour of courier clock drift. The
--   courier API returns delivery timestamps from their system; fast pickups
--   + same-day delivery can produce delivered_at values slightly before our
--   shipped_at due to clock skew. 1h is generous enough to absorb real drift
--   while still rejecting rows where delivered_at predates shipped_at by
--   days (obvious bad writes).
--
-- Deliberately NOT adding:
--   - paid_at >= confirmed_at: too strict for edge cases (pre-capture card
--     refunds, COD settlement entered before app reads it back).
--   - refunded_at >= paid_at: same reason.
-- Those relationships are encoded in business meaning (validated in the
-- refund / settlement RPCs and admin UI), not as DB chronology checks.

alter table orders add constraint chk_shipped_after_confirmed
  check (
    shipped_at is null
    or (confirmed_at is not null and shipped_at >= confirmed_at)
  );

alter table orders add constraint chk_delivered_after_shipped
  check (
    delivered_at is null
    or (shipped_at is not null and delivered_at >= shipped_at - interval '1 hour')
  );
