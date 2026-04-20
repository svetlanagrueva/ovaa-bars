-- Migration 20260420163455: Orders sanity CHECKs
--
-- Three business-meaning invariants, each backstop to server-action validation.

-- Refund amount cannot exceed the order total. Overages should be
-- handled as a separate adjustment (goodwill credit), not tacked onto
-- this order's refund_amount.
alter table orders add constraint chk_refund_amount_le_total
  check (refund_amount is null or refund_amount <= total_amount);

-- Stripe refunds require a PaymentIntent to refund against. If the
-- original payment was COD (no PI) or card not processed through Stripe,
-- refund_method must be 'bank_transfer' or null.
alter table orders add constraint chk_refund_method_stripe_requires_pi
  check (
    refund_method is distinct from 'stripe'
    or stripe_payment_intent_id is not null
  );

-- COD surcharge belongs only on COD orders. One-way only: card orders
-- must have cod_fee=0; COD orders may have 0 (free-COD promo) or positive.
alter table orders add constraint chk_cod_fee_implies_cod
  check (cod_fee = 0 or payment_method = 'cod');
