-- Migration 20260420184646: Normalize orders.email to lowercase
--
-- Prevents case-variance bugs where "Foo@bar.com" and "foo@bar.com" resolve
-- to the same mailbox in practice but diverge as DB rows (duplicate
-- customers, mismatched unsubscribe state, etc.). email_unsubscribes
-- already keys by lower(email); this brings orders.email into alignment.
--
-- App normalizes at insert time via customerInfo.email.toLowerCase();
-- the CHECK is defense-in-depth.

alter table orders add constraint chk_orders_email_lowercase
  check (email = lower(email));
