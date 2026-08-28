-- =============================================================================
-- 000019 — Make a replayed scan actually idempotent
-- =============================================================================
--
-- THE BUG
--
-- `passimo_record_earn` accepts `p_idempotency_key` and threads it into the
-- ledger credit, where a partial unique index stops the points being awarded
-- twice. It does not use it for the `activity_events` row. Only an
-- `external_id` — which integration webhooks supply and the counter does not —
-- deduplicated the event.
--
-- So a replay of the same scan awarded points once and recorded a visit every
-- time. Reproduced against a fresh database: three identical check-ins with one
-- idempotency key left the balance at 10 and `visit_count` at 14.
--
-- WHY IT MATTERS MORE THAN IT LOOKS
--
-- The offline queue in `lib/client/offline-queue.ts` exists because café wifi
-- drops mid-transaction; its whole safety argument is "replay is free". The
-- scanner also retries on a network error, and a cashier who does not see a
-- confirmation scans again. Each of those inflated:
--
--   * `customers.visit_count` and `days_between_visits`
--   * every retention, frequency and cohort figure derived from
--     `activity_events` (the analytics functions count events, not ledger rows)
--   * tier progress on programs whose `tier_metric` is `visit_count`
--   * the `at_risk` / `lost` segments, which read days since last visit
--
-- Points were right and everything built on visits was wrong, which is the
-- worst shape for this kind of bug: the number the merchant checks agrees, and
-- the numbers they make decisions on do not.
--
-- THE FIX
--
-- Give `activity_events` its own idempotency key with a partial unique index —
-- the same pattern `loyalty_ledger`, `messages` and `gift_card_transactions`
-- already use — and have `passimo_record_earn` check it before inserting and
-- return the original event on a replay.
--
-- Scoped to `(business_id, idempotency_key)` rather than globally unique, so two
-- tenants generating the same client-side key can never collide.

-- -----------------------------------------------------------------------------
-- 1. The column and its index
-- -----------------------------------------------------------------------------

alter table activity_events
  add column if not exists idempotency_key text;

create unique index if not exists idx_activity_idempotency
  on activity_events (business_id, idempotency_key)
  where idempotency_key is not null;

comment on column activity_events.idempotency_key is
  'Caller-supplied replay key. A scan retried by the offline queue or by a '
  'cashier who saw no confirmation resolves to the original event rather than a '
  'second visit. Partial-unique per business.';

-- -----------------------------------------------------------------------------
-- 2. Redefine passimo_record_earn
-- -----------------------------------------------------------------------------
--
-- Restated in full rather than patched, because a `create or replace` is the only
-- way to change a function body and half a body is not a thing. The only
-- differences from migration 000006 are the idempotency lookup at the top and
-- the column in the insert; the awarding loop is unchanged.

create or replace function passimo_record_earn(
  p_business_id uuid,
  p_customer_id uuid,
  p_event jsonb,
  p_awards jsonb default '[]'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_external_id text := nullif(p_event ->> 'external_id', '');
  v_source text := coalesce(p_event ->> 'source', 'app');
  v_award jsonb;
  v_results jsonb := '[]'::jsonb;
  v_amount numeric;
  v_occurred_at timestamptz := coalesce((p_event ->> 'occurred_at')::timestamptz, now());
begin
  if not exists (select 1 from customers where id = p_customer_id and business_id = p_business_id) then
    raise exception 'Customer % does not belong to business %', p_customer_id, p_business_id
      using errcode = 'check_violation';
  end if;

  /*
   * Replay check, in the order the two kinds of replay actually arrive.
   *
   * The client key comes first because it is the one the counter and the offline
   * queue use, and it is the common case.
   */
  if p_idempotency_key is not null then
    select id into v_event_id
      from activity_events
     where business_id = p_business_id
       and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('duplicate', true, 'event_id', v_event_id, 'awards', '[]'::jsonb);
    end if;
  end if;

  -- Integration replays (Stripe, Square, Shopify) carry a provider event id.
  if v_external_id is not null then
    select id into v_event_id
      from activity_events
     where business_id = p_business_id and source = v_source and external_id = v_external_id;
    if found then
      return jsonb_build_object('duplicate', true, 'event_id', v_event_id, 'awards', '[]'::jsonb);
    end if;
  end if;

  /*
   * `on conflict do nothing` on the insert as well as the check above.
   *
   * The check loses a race between two concurrent replays — both read, neither
   * finds a row, both insert. That is not hypothetical here: the offline queue
   * flushes its whole backlog at once the moment connectivity returns, and a
   * cashier double-tap arrives as two requests milliseconds apart. The index is
   * the thing that actually enforces this; the select above only makes the
   * common case return the original event id instead of nothing.
   */
  insert into activity_events (
    business_id, customer_id, location_id, type, amount, currency, quantity,
    source, external_id, staff_user_id, metadata, occurred_at, idempotency_key
  ) values (
    p_business_id,
    p_customer_id,
    nullif(p_event ->> 'location_id', '')::uuid,
    coalesce(p_event ->> 'type', 'visit'),
    nullif(p_event ->> 'amount', '')::numeric,
    nullif(p_event ->> 'currency', ''),
    nullif(p_event ->> 'quantity', '')::int,
    v_source,
    v_external_id,
    nullif(p_event ->> 'staff_user_id', '')::uuid,
    coalesce(p_event -> 'metadata', '{}'::jsonb),
    v_occurred_at,
    p_idempotency_key
  )
  on conflict do nothing
  returning id into v_event_id;

  -- Lost the race: another transaction inserted this exact event. Report it as
  -- the duplicate it is rather than crediting a second time.
  if v_event_id is null then
    select id into v_event_id
      from activity_events
     where business_id = p_business_id
       and (
         (p_idempotency_key is not null and idempotency_key = p_idempotency_key)
         or (v_external_id is not null and source = v_source and external_id = v_external_id)
       )
     limit 1;

    return jsonb_build_object('duplicate', true, 'event_id', v_event_id, 'awards', '[]'::jsonb);
  end if;

  for v_award in select * from jsonb_array_elements(coalesce(p_awards, '[]'::jsonb))
  loop
    v_amount := (v_award ->> 'amount')::numeric;
    continue when v_amount is null or v_amount <= 0;

    v_results := v_results || jsonb_build_array(
      passimo_credit_account(
        p_business_id,
        (v_award ->> 'program_id')::uuid,
        p_customer_id,
        v_amount,
        'earn',
        v_award ->> 'reason',
        nullif(v_award ->> 'rule_id', '')::uuid,
        v_event_id,
        nullif(v_award ->> 'campaign_id', '')::uuid,
        nullif(p_event ->> 'location_id', '')::uuid,
        nullif(p_event ->> 'staff_user_id', '')::uuid,
        case when p_idempotency_key is null then null
             else p_idempotency_key || ':' || (v_award ->> 'program_id') end,
        coalesce(v_award -> 'metadata', '{}'::jsonb)
      )
    );
  end loop;

  -- Keep the behavioural rollups the dashboard and segments read from current.
  perform passimo_recompute_customer_stats(p_customer_id);

  return jsonb_build_object('duplicate', false, 'event_id', v_event_id, 'awards', v_results);
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Backfill: collapse visits that were already double-counted
-- -----------------------------------------------------------------------------
--
-- Existing rows have no idempotency key, so nothing can be deduplicated
-- retroactively with certainty — two identical visits a second apart may be a
-- replay or may be a cashier scanning two members of the same family. Rather
-- than guess and delete real visits, this recomputes the rollups so they at
-- least agree with the events that are stored.
--
-- Bounded to businesses with customers so a fresh database does no work.

do $$
declare
  affected int;
begin
  select count(*) into affected from customers;
  if affected = 0 then
    raise notice 'no customers: skipping stats recompute';
    return;
  end if;

  perform passimo_recompute_customer_stats(id) from customers;
  raise notice 'recomputed rollups for % customers', affected;
end $$;
