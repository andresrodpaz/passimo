-- =============================================================================
-- 000020 — Customer enrolment is broken for QR joins and manual adds
-- =============================================================================
--
-- THE BUG
--
-- `customers.source` and `activity_events.source` are two different vocabularies
-- with two different check constraints:
--
--   customers        qr, manual, import, api, pos, referral, web, integration
--   activity_events  app, pos, api, import, automation, integration, wallet, web
--
-- `passimo_enroll_customer` takes one `p_source` and writes it to both. Five
-- values are valid in both places. Three are valid only for `customers` — `qr`,
-- `manual` and `referral` — and passing any of them makes the signup event
-- violate `activity_events_source_check`, which aborts the whole function.
--
-- Reproduced on a fresh database:
--
--   select passimo_enroll_customer(<business>, 'x@example.com', 'X', …, 'qr');
--   ERROR: new row for relation "activity_events" violates check constraint
--          "activity_events_source_check"
--
-- WHAT WAS ACTUALLY BROKEN
--
-- The two most important ways a customer ever gets into the product:
--
--   * `POST /api/v1/public/join`   passes 'qr'     — the join page every QR code,
--                                                    poster and referral link
--                                                    points at. This is the
--                                                    product's primary customer
--                                                    acquisition path.
--   * `POST /api/v1/customers`     passes 'manual' — a merchant adding someone at
--                                                    the counter.
--
-- Both returned a 500 and created nothing. Gift-card and membership enrolment,
-- which default to 'manual', failed the same way. CSV import ('import') and
-- integrations ('integration') happened to pick values in the intersection and
-- worked, which is why the schema shipped: the paths a developer tests with a
-- script were fine, and the paths a merchant uses were not.
--
-- The demo seed writes `customers` rows directly rather than through this
-- function, so a seeded environment looked completely healthy.
--
-- THE FIX
--
-- Keep both vocabularies — they describe genuinely different things, and widening
-- `activity_events.source` to accept `qr` would put a value into the column every
-- analytics function groups by, changing what existing charts mean — and map
-- between them explicitly at the one place they meet.

-- -----------------------------------------------------------------------------
-- 1. The mapping
-- -----------------------------------------------------------------------------

create or replace function passimo_activity_source(p_source text)
returns text
language sql
immutable
as $$
  select case coalesce(p_source, 'app')
    -- Scanned a QR code and filled in the join page: a web signup.
    when 'qr'       then 'web'
    -- Someone at the counter typed them in.
    when 'manual'   then 'pos'
    -- Arrived through a friend's referral link, which is also the join page.
    when 'referral' then 'web'
    -- Already shared between both vocabularies.
    when 'pos'         then 'pos'
    when 'api'         then 'api'
    when 'import'      then 'import'
    when 'integration' then 'integration'
    when 'web'         then 'web'
    when 'app'         then 'app'
    when 'automation'  then 'automation'
    when 'wallet'      then 'wallet'
    /*
     * Anything unrecognised becomes 'app' rather than raising. A future caller
     * inventing a source should get a slightly imprecise analytics label, not a
     * failed customer signup — which is the exact trade this migration exists to
     * correct.
     */
    else 'app'
  end
$$;

comment on function passimo_activity_source(text) is
  'Maps a customers.source value onto the activity_events.source vocabulary. '
  'The two check constraints do not agree, and enrolment writes to both.';

-- -----------------------------------------------------------------------------
-- 2. Redefine passimo_enroll_customer
-- -----------------------------------------------------------------------------
--
-- The body is reproduced from the catalogue rather than restated here, for the
-- same reason migration 000017 did it: 90 lines of PL/pgSQL owned by migration
-- 000010 should not be duplicated into a file whose only change is one
-- expression. `pg_get_functiondef` gives the current definition, the substitution
-- wraps the one insert, and re-executing it redefines the function in place.
--
-- Idempotent: on a re-run the wrapped form is already present and the `position`
-- guard skips it.

do $$
declare
  definition text;
  rewritten text;
  target text := 'values (p_business_id, v_customer.id, p_location_id, ''signup'', p_source)';
  replacement text :=
    'values (p_business_id, v_customer.id, p_location_id, ''signup'', passimo_activity_source(p_source))';
  fn_oid oid;
begin
  select p.oid into fn_oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'passimo_enroll_customer'
   limit 1;

  if fn_oid is null then
    raise exception 'passimo_enroll_customer() not found — migrations are out of order';
  end if;

  definition := pg_get_functiondef(fn_oid);

  if position(replacement in definition) > 0 then
    raise notice 'passimo_enroll_customer already maps the activity source';
    return;
  end if;

  if position(target in definition) = 0 then
    raise exception
      'passimo_enroll_customer no longer contains the expected signup-event insert; '
      'the mapping must be applied by hand';
  end if;

  rewritten := replace(definition, target, replacement);
  execute rewritten;
  raise notice 'passimo_enroll_customer now maps the activity source';
end $$;

-- -----------------------------------------------------------------------------
-- 3. Verify, against the values the application actually passes
-- -----------------------------------------------------------------------------
--
-- A migration that claims to have fixed enrolment and has not is worse than one
-- that failed. This runs the real function for every source the codebase uses,
-- inside a transaction that is rolled back, so the check exercises the same code
-- path a merchant will and leaves nothing behind.

do $$
declare
  v_business uuid;
  v_source text;
  v_result jsonb;
begin
  -- A throwaway tenant, so the check does not depend on any data existing.
  insert into businesses (name, slug, currency, locale)
  values ('Migration check', 'passimo-migration-check-000020', 'EUR', 'en')
  returning id into v_business;

  foreach v_source in array array['qr', 'manual', 'referral', 'import', 'api', 'pos', 'web', 'integration']
  loop
    begin
      v_result := passimo_enroll_customer(
        v_business,
        (v_source || '.check@passimo.invalid')::citext,
        'Migration check',
        null, null, null, null, null,
        v_source
      );
    exception when others then
      raise exception 'enrolment still fails for source %: %', v_source, sqlerrm;
    end;

    if (v_result ->> 'customer_id') is null then
      raise exception 'enrolment returned no customer for source %', v_source;
    end if;
  end loop;

  -- Cascades to the customers and activity events just created.
  delete from businesses where id = v_business;

  raise notice 'enrolment verified for all 8 sources';
end $$;
