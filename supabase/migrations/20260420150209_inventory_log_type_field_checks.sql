-- Migration 20260420150209: Enforce type↔field requirements on inventory_log
--
-- Each movement type has structural requirements previously enforced only
-- in the server actions (addInventoryBatch, recordStockMovement) and the
-- reserve_inventory/restore_inventory RPCs. Moving to DB CHECKs gives
-- defense-in-depth: any future insert path (imports, data repair scripts,
-- direct SQL) must produce well-formed rows or be rejected.
--
-- Each CHECK is named per movement type so a violation's error message
-- points directly at the problem type.

-- batch_in requires batch_id (non-empty) and expiry_date.
alter table inventory_log add constraint chk_inventory_log_batch_in
  check (
    type <> 'batch_in'
    or (batch_id is not null and btrim(batch_id) <> '' and expiry_date is not null)
  );

-- order_out and cancellation require order_id (reservation trail).
alter table inventory_log add constraint chk_inventory_log_order_linked
  check (
    type not in ('order_out', 'cancellation')
    or order_id is not null
  );

-- wholesale_out requires reference_type='invoice' + reference_id.
alter table inventory_log add constraint chk_inventory_log_wholesale_out
  check (
    type <> 'wholesale_out'
    or (reference_type = 'invoice' and reference_id is not null)
  );

-- return_in requires reference_type='return' + reference_id.
alter table inventory_log add constraint chk_inventory_log_return_in
  check (
    type <> 'return_in'
    or (reference_type = 'return' and reference_id is not null)
  );

-- sample_out requires reference_type='internal' + reference_id.
alter table inventory_log add constraint chk_inventory_log_sample_out
  check (
    type <> 'sample_out'
    or (reference_type = 'internal' and reference_id is not null)
  );

-- damaged requires notes (non-empty), reference_type in ('internal','return'),
-- and reference_id. Both reference_types are legitimate: 'internal' for an
-- internal protocol number, 'return' for items damaged during returns handling.
alter table inventory_log add constraint chk_inventory_log_damaged
  check (
    type <> 'damaged'
    or (
      notes is not null and btrim(notes) <> ''
      and reference_type in ('internal', 'return')
      and reference_id is not null
    )
  );

-- adjustment_gain and adjustment_loss require notes (non-empty),
-- reference_type='internal', and reference_id (the reconciliation protocol).
-- Mandatory notes prevent silent stock adjustments hiding bad accounting.
alter table inventory_log add constraint chk_inventory_log_adjustments
  check (
    type not in ('adjustment_gain', 'adjustment_loss')
    or (
      notes is not null and btrim(notes) <> ''
      and reference_type = 'internal'
      and reference_id is not null
    )
  );
