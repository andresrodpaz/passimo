-- =============================================================================
-- 000017 — Brand rename: Fidelio → Passimo
-- =============================================================================
--
-- The product shipped its database objects under a `fidelio_` prefix. This
-- migration moves every one of them to `passimo_` and rewrites the two values
-- the old brand leaked into actual customer rows.
--
-- Migrations 1–16 are deliberately left untouched. Migration history is a
-- ledger, not a source file: rewriting it would make a fresh database and an
-- already-deployed one reach this state by different routes, which is the class
-- of difference nobody finds until a production restore. Instead, a fresh
-- database creates `fidelio_*` in 1–16 and renames here; a deployed one just
-- renames here. Both converge on exactly the same catalogue.
--
-- Three things have to happen, in this order, and the order is the whole point:
--
--   1. **Rename the functions.** Triggers, column defaults and RLS policies all
--      reference functions through `pg_depend` by OID, so a rename carries them
--      along untouched. Grants and ownership follow the OID too.
--
--   2. **Rewrite the bodies.** This is the step a rename alone would miss.
--      `LANGUAGE plpgsql` bodies are opaque text to the planner: a body that
--      says `perform fidelio_recompute_customer_stats(...)` resolves that name
--      at *call* time, so after step 1 it would raise "function does not exist"
--      the first time a merchant merged two customers. Eight such cross-calls
--      exist. Re-executing each definition with the names substituted is what
--      makes the rename actually complete.
--
--   3. **Migrate the data.** Two synthetic email domains were written into
--      `customers.email` by the merge and erasure paths, and application code
--      tests for them to decide whether a customer has a real address.
--
-- Idempotent throughout: every step is a no-op on a database that has already
-- run it, so a re-run during a botched deploy is safe.

-- -----------------------------------------------------------------------------
-- 1. Rename every fidelio_* routine to passimo_*
-- -----------------------------------------------------------------------------
--
-- Driven off `pg_proc` rather than a hand-written list of 57 `ALTER FUNCTION`
-- statements. `oid::regprocedure` renders the full argument signature, which is
-- what disambiguates the overloaded ones, and a catalogue-driven loop cannot
-- drift from the catalogue the way a transcribed list does.

do $$
declare
  fn record;
  target_name text;
begin
  for fn in
    select p.oid,
           p.oid::regprocedure::text as signature,
           p.proname                 as name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'fidelio\_%'
     order by p.proname
  loop
    target_name := 'passimo_' || substring(fn.name from length('fidelio_') + 1);

    /*
     * Skip when the destination is already taken by an identical signature —
     * that is a re-run, not a collision. Comparing argument types rather than
     * just the name keeps a genuine clash (two different overloads colliding)
     * loud instead of silently skipped.
     */
    if exists (
      select 1
        from pg_proc p2
        join pg_namespace n2 on n2.oid = p2.pronamespace
       where n2.nspname = 'public'
         and p2.proname = target_name
         and p2.proargtypes = (select proargtypes from pg_proc where oid = fn.oid)
    ) then
      raise notice 'skipping %: % already exists', fn.signature, target_name;
      continue;
    end if;

    execute format('alter function %s rename to %I', fn.signature, target_name);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Rewrite function bodies that still name the old identifiers
-- -----------------------------------------------------------------------------
--
-- `pg_get_functiondef` reproduces a complete `CREATE OR REPLACE FUNCTION`
-- statement — signature, volatility, `security definer`, `set search_path` and
-- body — so executing a string-substituted copy redefines the function in place
-- without this file having to restate 3,000 lines of PL/pgSQL that migrations
-- 2–16 already own. Keeping the bodies out of here means this migration cannot
-- silently revert a fix made in an earlier one.
--
-- Two passes' worth of substitution happen together: the `fidelio_` prefix on
-- called routines, and the `@fidelio.invalid` literal that the merge and erasure
-- functions write.

do $$
declare
  fn record;
  definition text;
  rewritten text;
  changed int := 0;
begin
  for fn in
    select p.oid, p.oid::regprocedure::text as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname like 'passimo\_%'
  loop
    definition := pg_get_functiondef(fn.oid);

    if position('fidelio' in definition) = 0 then
      continue;
    end if;

    rewritten := replace(definition, '@fidelio.invalid', '@passimo.invalid');
    rewritten := replace(rewritten, 'fidelio_', 'passimo_');

    execute rewritten;
    changed := changed + 1;
  end loop;

  raise notice 'rewrote % function bodies', changed;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Migrate the synthetic email domains in customer rows
-- -----------------------------------------------------------------------------
--
-- `customers.email` is `not null` and unique per business, so the merge and
-- erasure paths cannot blank it — they write a deliberately undeliverable
-- address instead. Application code reads the domain to decide whether to show
-- an email or fall back to a phone number, and to decide whether a customer is
-- contactable at all.
--
-- Both spellings are recognised in code during the transition (a wallet pass or
-- an export produced before this migration may still carry the old one), but the
-- stored rows are moved so the sentinel has exactly one spelling going forward.
--
-- `citext`, so the comparison is already case-insensitive.

update customers
   set email = (replace(email::text, '@fidelio.invalid', '@passimo.invalid'))::citext
 where email::text like '%@fidelio.invalid';

update customers
   set email = (replace(email::text, '@fidelio.test', '@passimo.test'))::citext
 where email::text like '%@fidelio.test';

-- -----------------------------------------------------------------------------
-- 4. Verify
-- -----------------------------------------------------------------------------
--
-- A rename that half-succeeded is worse than one that failed: the product would
-- run until the first merge, then raise from inside a `security definer`
-- function. Failing the migration is the cheap version of that discovery.

do $$
declare
  leftover_routines int;
  leftover_bodies int;
begin
  select count(*) into leftover_routines
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname like 'fidelio\_%';

  if leftover_routines > 0 then
    raise exception 'brand rename incomplete: % routines still named fidelio_*', leftover_routines;
  end if;

  select count(*) into leftover_bodies
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and p.proname like 'passimo\_%'
     and position('fidelio_' in pg_get_functiondef(p.oid)) > 0;

  if leftover_bodies > 0 then
    raise exception 'brand rename incomplete: % function bodies still call fidelio_*', leftover_bodies;
  end if;
end $$;
