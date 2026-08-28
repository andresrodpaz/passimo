-- =============================================================================
-- 000018 — Row-level security realignment
-- =============================================================================
--
-- Migrations 1, 8, 11, 13, 15 and 16 enable row-level security on nine tables
-- and define thirty-odd policies in terms of the previous provider's `auth.uid()`
-- (now `app_current_user_id()`). This migration turns them off. That deserves a
-- long explanation, because "the migration that disabled RLS" is exactly the
-- line in a git log that should make a reviewer stop.
--
-- WHAT THOSE POLICIES ACTUALLY DID
--
-- Nothing, on any deployment this product has ever had. They were written for an
-- architecture where a browser holds a token and queries PostgreSQL directly
-- through a REST gateway; in that world a policy is the only thing between one
-- merchant and another's customer list, and it is essential.
--
-- Passimo has never worked that way. Every read and write goes through a Next.js
-- route handler which resolves an actor, resolves that actor's role on the target
-- business, and only then queries — over a connection that owns the schema. A
-- table owner bypasses its own policies unless the table is set to FORCE, and
-- none were. So the policies parsed, sat in `pg_policy`, and were evaluated for
-- zero queries.
--
-- WHY LEAVING THEM WOULD BE WORSE THAN REMOVING THEM
--
--   1. They read as protection that exists. The next person to add a table would
--      reasonably conclude tenant isolation is the database's job here, and write
--      a query without a `business_id` filter. It is not the database's job. It
--      is `lib/auth/context.ts` and an explicit filter on every query, and that
--      has to be legible.
--
--   2. They are a trap for least-privilege. The obvious future hardening — run
--      the application as a role that does not own the schema — would, with these
--      policies live and `app_current_user_id()` returning null, deny every
--      statement in the product. A team would hit that, not understand it, and
--      grant the role ownership again. The hardening step should not be gated on
--      first rewriting thirty policies.
--
--   3. `security definer` functions carry the loyalty engine's transactional
--      logic, and they already run as their owner. Half the product's writes were
--      outside the policies' reach whatever the connecting role.
--
-- WHAT ENFORCES ISOLATION NOW
--
-- Explicitly and only the application layer:
--
--   * `requireBusinessAccess(actor, businessId)` resolves the actor's row in
--     `team_members` and throws 403 when absent. Every tenant-scoped route runs
--     it before the handler body, via `defineRoute({ businessIdFrom })`.
--   * Every tenant-scoped query filters `business_id`, and `QueryBuilder` refuses
--     an `update` or `delete` with no filter at all.
--   * `tests/unit/tenant-isolation.test.ts` and the integration suite assert
--     cross-tenant reads and writes fail.
--
-- Documented in docs/SECURITY.md, including what it would take to reintroduce
-- real RLS (a per-request `set_local passimo.current_user_id`, which needs every
-- request to hold a transaction — a deliberate future trade, not a silent one).
--
-- Idempotent: safe to re-run.

do $$
declare
  policy_row record;
  table_row record;
  dropped int := 0;
  disabled int := 0;
begin
  for policy_row in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename
    );
    dropped := dropped + 1;
  end loop;

  for table_row in
    select n.nspname as schemaname, c.relname as tablename
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relrowsecurity
  loop
    execute format(
      'alter table %I.%I disable row level security',
      table_row.schemaname, table_row.tablename
    );
    disabled := disabled + 1;
  end loop;

  raise notice
    'row-level security realignment: dropped % policies, disabled RLS on % tables',
    dropped, disabled;
end $$;

-- -----------------------------------------------------------------------------
-- The access helpers the policies used
-- -----------------------------------------------------------------------------
--
-- Kept, not dropped. They answer "which businesses may this user act on?", which
-- is a genuine question — the admin console and any future reporting role need
-- it, and it is the exact predicate a reintroduced policy would use. Dropping
-- them would mean rewriting them from scratch on the day that happens.
--
-- Re-pointed at `app_users` semantics by migration 000008's port; nothing to
-- change here beyond stating that they are deliberate.

comment on function passimo_member_business_ids() is
  'Businesses the current actor (app_current_user_id()) is an active member of. '
  'Retained for the admin console and as the predicate a future row-level '
  'security policy would use. Not currently referenced by any policy — see the '
  'header of migration 000018.';
