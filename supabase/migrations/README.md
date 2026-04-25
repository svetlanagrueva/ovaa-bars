# Database migrations

Schema changes live in this directory as numbered SQL files. Each file is a
single migration, applied in filename order.

## Naming convention

```
YYYYMMDDHHMMSS_<snake_case_description>.sql
```

- Timestamp prefix (14 digits, UTC) determines apply order.
- Description is a short snake_case summary of the change.
- Format matches Supabase CLI so the directory is adoptable by `supabase db push` later without renaming.

Examples:
- `20260420120000_initial_schema.sql` — the first migration
- `20260421093000_add_order_items_table.sql`
- `20260422141500_enforce_delivery_mode_check.sql`

## Creating a new migration

1. Pick the current UTC timestamp: `date -u +%Y%m%d%H%M%S`
2. Create a file with that prefix + a short description.
3. Put DDL + DML for the change only — never retroactively edit an earlier migration that has already been applied to any environment other than your own local dev DB (see "Pre-launch" note below).
4. Commit to git alongside the code that depends on the change.

## Applying migrations

### Supabase SQL Editor (current workflow)

1. Open the migration file.
2. Paste into Supabase Dashboard → SQL Editor → New query.
3. Run.
4. Note the filename applied somewhere persistent (a team doc or a `applied_migrations` table you maintain manually).

### `psql`

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260420120000_initial_schema.sql
```

Apply in filename order.

### Supabase CLI (future)

When adopted, `supabase migration up` will apply any pending migrations automatically by tracking which have been applied in the `supabase_migrations.schema_migrations` table.

## Rules

- **Never edit a migration that has been applied to a shared environment** (prod, staging). Write a new migration to correct.
- **Never rename a committed migration file.** Apply order is determined by filename; renaming rewrites history.
- **One logical change per migration.** Makes review and rollback easier.
- **Prefer idempotent DDL** (`create table if not exists`, `create or replace function`) so reruns on a partially-applied DB don't fail loudly.
- **Never skip hooks (`--no-verify`) or force-push migrations.**

## Pre-launch note

As of 2026-04-20, the site is pre-launch and the DB has no real customer data.
While pre-launch:
- Migrations can be squashed (collapse many small ones into one `initial_schema.sql`) if the list gets unwieldy.
- The DB can be dropped and re-applied from scratch.
- Once the first real customer order lands, the rules above apply strictly — no more squashing, no more editing applied migrations.

## Squash history

The 26-file migration series from the `db-modifications` branch was
consolidated into the single `20260420120000_initial_schema.sql` on
2026-04-25, before launch. The pre-squash version of each migration
remains accessible via the merge commit on the squash PR (and any
branch that still holds the original step-by-step files) for forensic
look-back if needed. From this point forward the rules above apply —
new schema changes go in their own dated file, never edit
`initial_schema.sql` post-launch.
