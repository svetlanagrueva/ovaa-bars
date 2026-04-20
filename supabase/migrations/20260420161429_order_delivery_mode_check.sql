-- Migration 20260420161429: Delivery mode consistency CHECK on orders
--
-- logistics_partner is constrained to the three supported methods, and each
-- mode has field requirements covering all partner-specific columns. The
-- checkout client and server actions already produce conforming rows; this
-- CHECK is defense-in-depth against future code paths, direct DB writes, or
-- malicious clients.
--
-- Supported modes (per app validation VALID_DELIVERY_METHODS):
--   econt-office   — Econt partner office delivery
--   speedy-office  — Speedy partner office delivery
--   speedy-address — Speedy home-address delivery
--
-- econt-address is deliberately excluded.
--
-- Null logistics_partner is allowed (legacy/grandfathered rows; none expected
-- pre-launch but the clause is cheap insurance). New rows always set it.
--
-- Note: the `city` column stays NOT NULL for all modes. Office delivery flows
-- populate city from the office's city; this CHECK does not re-validate it.
-- `address` and `postal_code` default to '' in the schema, so for office modes
-- they may be empty strings (from stale state of prior mode switch) — the
-- CHECK does not forbid that, it only enforces non-empty for speedy-address.

alter table orders add constraint chk_logistics_partner_enum
  check (
    logistics_partner is null
    or logistics_partner in ('econt-office', 'speedy-office', 'speedy-address')
  );

alter table orders add constraint chk_delivery_fields_consistent check (
  logistics_partner is null
  or (
    logistics_partner = 'econt-office'
    and econt_office_id is not null
    and econt_office_code is not null
    and econt_office_name is not null
    and econt_office_address is not null
    and speedy_office_id is null
    and speedy_office_name is null
    and speedy_office_address is null
  )
  or (
    logistics_partner = 'speedy-office'
    and speedy_office_id is not null
    and speedy_office_name is not null
    and speedy_office_address is not null
    and econt_office_id is null
    and econt_office_code is null
    and econt_office_name is null
    and econt_office_address is null
  )
  or (
    logistics_partner = 'speedy-address'
    and address is not null and address <> ''
    and postal_code is not null and postal_code <> ''
    and econt_office_id is null
    and econt_office_code is null
    and econt_office_name is null
    and econt_office_address is null
    and speedy_office_id is null
    and speedy_office_name is null
    and speedy_office_address is null
  )
);
