-- Enrolment: reject a signup location that belongs to another business.
--
-- WHAT WAS BROKEN
--
-- `passimo_enroll_customer` wrote `p_location_id` straight into
-- `customers.signup_location_id` and `activity_events.location_id` without ever
-- checking that the location belongs to `p_business_id`. The foreign keys on
-- both columns point at `locations(id)` and prove only that the row exists —
-- not whose it is.
--
-- `POST /api/v1/public/join` is unauthenticated by design (it is the QR landing
-- page) and takes `locationId` from the request body, so the value is fully
-- attacker-controlled. Reproduced against a running instance:
--
--   POST /api/v1/public/join
--   { "businessSlug": "madrid-coffee",
--     "email": "…",
--     "acceptedTerms": true,
--     "locationId": "<a Barcelona Barber location uuid>" }
--   → 200 OK
--
--   select … from customers c
--     join businesses cb on cb.id = c.business_id
--     left join locations l on l.id = c.signup_location_id
--     left join businesses lb on lb.id = l.business_id
--    where c.email = '…';
--   → customer_business=madrid-coffee | signup_location_business=barcelona-barber
--
-- Two rows in Madrid Coffee's tenant — one `customers` row and its `signup`
-- `activity_events` row — now referenced a location Madrid Coffee does not own.
--
-- WHY IT MATTERS EVEN THOUGH NOTHING READS IT TODAY
--
-- No query in the application currently joins `signup_location_id` to render a
-- location name, so this is data corruption rather than an active disclosure.
-- That is a property of today's feature set, not of the schema: per-location
-- signup reporting is an obvious next feature, and the moment one is written
-- that joins `locations` without re-asserting `business_id`, the other tenant's
-- location name and address surface inside this merchant's dashboard. The row
-- is already written and waiting.
--
-- WHY NULL RATHER THAN AN EXCEPTION
--
-- `passimo_ensure_account` raises `check_violation` for cross-tenant arguments,
-- and consistency argues for doing the same here. It is the wrong trade on this
-- particular function. The public join endpoint is the product's single
-- conversion point — a customer standing at a counter with their phone out —
-- and the route deliberately refuses to turn that person away even when the
-- merchant is over their plan limit ("enrol them, then tell the owner"). Failing
-- a signup over an optional analytics field would be a worse outcome than
-- losing the field, and `location_id` is nullable on both tables precisely
-- because it is optional.
--
-- So a foreign location is coerced to NULL: the enrolment completes, the
-- attribution is simply absent, and no cross-tenant reference is ever written.
-- A merchant's own UI passing a stale location degrades the same benign way.
--
-- This also fixes every other caller at once — `POST /api/v1/customers`,
-- gift-card and membership enrolment all reach the same function.

-- -----------------------------------------------------------------------------
-- Rewrite passimo_enroll_customer with a tenant guard on the location
-- -----------------------------------------------------------------------------
--
-- Reproduced from the catalogue and patched in place rather than restated, for
-- the same reason migrations 000017 and 000020 did it: this function's ~90 lines
-- of PL/pgSQL are owned by migration 000010, and copying them into a file whose
-- only change is a four-line guard would fork the definition.
--
-- The guard is inserted immediately after `begin`, so it normalises the
-- parameter once and both write sites downstream pick it up. PL/pgSQL permits
-- assigning to an input parameter; it behaves as a local variable.
--
-- Idempotent: on a re-run the guard is already present and the `position` check
-- returns early.

do $$
declare
  definition text;
  rewritten  text;
  anchor text := 'begin
  insert into customers (';
  guard text := 'begin
  /*
   * A location that belongs to a different business is dropped rather than
   * stored. `p_location_id` arrives from an unauthenticated request body on the
   * public join endpoint, and the foreign key proves only that the location
   * exists — not that it is this tenant''s. See migration 000026.
   */
  if p_location_id is not null and not exists (
    select 1 from locations
     where id = p_location_id and business_id = p_business_id
  ) then
    p_location_id := null;
  end if;

  insert into customers (';
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

  if position('See migration 000026' in definition) > 0 then
    raise notice 'passimo_enroll_customer already guards the signup location';
    return;
  end if;

  if position(anchor in definition) = 0 then
    raise exception
      'passimo_enroll_customer no longer opens with the expected customers insert; '
      'the location guard must be applied by hand';
  end if;

  rewritten := replace(definition, anchor, guard);
  execute rewritten;

  raise notice 'passimo_enroll_customer now drops cross-tenant signup locations';
end
$$;
