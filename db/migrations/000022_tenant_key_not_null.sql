-- =============================================================================
-- 000022 — Make the tenant key NOT NULL where it is genuinely required
-- =============================================================================
--
-- Tenant isolation in this schema is a `business_id` column on 58 tables plus an
-- application layer that filters on it. Eleven of those columns were nullable,
-- and a nullable tenant key is a specific, quiet hazard:
--
--   `where business_id = $1` excludes a null row.
--   `select count(*)` includes it.
--
-- So a row written without a tenant is invisible to every screen in the product
-- and present in every total — a customer nobody owns, who appears in the
-- platform count, cannot be found by the merchant who created them, and can
-- never be deleted by cascading their workspace away. Nothing errors. The only
-- symptom is two numbers that disagree.
--
-- Seven of the eleven become NOT NULL here. All seven are rows that cannot
-- meaningfully exist outside a workspace, and all seven currently have zero
-- nulls on every database this has been run against — the `do` block below
-- refuses to proceed otherwise rather than failing halfway through the `alter`.
--
-- FOUR ARE DELIBERATELY LEFT NULLABLE. Each is a real platform-scoped case, and
-- forcing a tenant onto them would mean inventing one:
--
--   `jobs`               Scheduled work with no owning workspace — the nightly
--                        sweep, gift-card delivery for a card bought before the
--                        recipient enrolled. `lib/jobs/queue.ts` writes
--                        `options.businessId ?? null` on purpose.
--   `audit_log`          Platform-level actions: an admin impersonating, a plan
--                        changed by support. The actor is not acting *as* a
--                        tenant.
--   `subscription_events`Stripe delivers before we have resolved which workspace
--                        an event belongs to; the row is stored first so the
--                        webhook is idempotent, then matched.
--   `message_templates`  A null `business_id` **is** the built-in template.
--                        `loadTemplate` in `lib/messaging/dispatch.ts` selects
--                        `business_id.eq.$1,business_id.is.null` and ranks the
--                        tenant's override above it. Making this NOT NULL would
--                        delete every default message the product sends.
--
-- No data is written or moved. Idempotent: `is_nullable` is checked first, so
-- re-running is a no-op.

-- -----------------------------------------------------------------------------
-- 1. Refuse to run if any of the target tables holds a null
-- -----------------------------------------------------------------------------
--
-- An `alter table ... set not null` on a table with nulls fails, and it fails
-- after earlier statements in the same migration have already succeeded. Failing
-- first, with the table named, is the difference between "fix these three rows"
-- and "work out which of seven statements ran".

do $$
declare
  target text;
  offenders bigint;
  problems text := '';
begin
  foreach target in array array[
    'customers', 'campaigns', 'team_members', 'reward_redemptions',
    'gift_cards', 'stamp_events', 'nps_responses'
  ]
  loop
    execute format('select count(*) from %I where business_id is null', target)
      into offenders;
    if offenders > 0 then
      problems := problems || format('%s: %s rows; ', target, offenders);
    end if;
  end loop;

  if problems <> '' then
    raise exception
      'Cannot set business_id NOT NULL — untenanted rows exist. %',
      problems
      using hint = 'Assign these rows to a workspace or delete them, then re-run. '
                   'scripts/db/014_tenant_isolation.sql lists them.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Set NOT NULL
-- -----------------------------------------------------------------------------
--
-- `information_schema` is consulted rather than using a bare `set not null`
-- because the statement takes an ACCESS EXCLUSIVE lock even when the column is
-- already constrained, and this migration runs on every deploy.

do $$
declare
  target text;
begin
  foreach target in array array[
    'customers', 'campaigns', 'team_members', 'reward_redemptions',
    'gift_cards', 'stamp_events', 'nps_responses'
  ]
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = target
        and column_name = 'business_id'
        and is_nullable = 'YES'
    ) then
      execute format('alter table %I alter column business_id set not null', target);
      raise notice 'business_id is now NOT NULL on %', target;
    end if;
  end loop;
end $$;

comment on column jobs.business_id is
  'Nullable on purpose: platform-scoped work has no owning workspace. See migration 000022.';
comment on column audit_log.business_id is
  'Nullable on purpose: platform-level actions are not taken as a tenant. See migration 000022.';
comment on column subscription_events.business_id is
  'Nullable on purpose: a Stripe event is stored before it is matched to a workspace. See migration 000022.';
comment on column message_templates.business_id is
  'Null means "built-in template". lib/messaging/dispatch.ts ranks a tenant override above it. See migration 000022.';

-- -----------------------------------------------------------------------------
-- 3. Verify
-- -----------------------------------------------------------------------------

do $$
declare
  still_nullable int;
begin
  select count(*) into still_nullable
    from information_schema.columns
   where table_schema = 'public'
     and column_name = 'business_id'
     and is_nullable = 'YES'
     and table_name in (
       'customers', 'campaigns', 'team_members', 'reward_redemptions',
       'gift_cards', 'stamp_events', 'nps_responses'
     );

  if still_nullable > 0 then
    raise exception 'Migration 000022 did not take: % columns are still nullable', still_nullable;
  end if;
end $$;
