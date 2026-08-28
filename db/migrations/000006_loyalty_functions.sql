-- =============================================================================
-- 000006 — Atomic loyalty operations
--
-- The original implementation read a balance into JavaScript, added to it, and
-- wrote it back. Two concurrent taps at the till lose one award; a retried HTTP
-- request awards twice. Every balance mutation now happens inside one of these
-- functions: a single transaction, a row lock, and an idempotency key.
--
-- All functions are SECURITY DEFINER because they are called through the
-- service role after the API layer has already authorised the actor. They never
-- trust a business_id implicitly — every write is constrained to the
-- business_id passed in, and cross-tenant arguments raise.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Account bootstrap
-- -----------------------------------------------------------------------------

create or replace function fidelio_ensure_account(
  p_business_id uuid,
  p_program_id uuid,
  p_customer_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  -- Reject cross-tenant arguments before any write.
  if not exists (
    select 1 from loyalty_programs
    where id = p_program_id and business_id = p_business_id
  ) then
    raise exception 'Program % does not belong to business %', p_program_id, p_business_id
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from customers
    where id = p_customer_id and business_id = p_business_id
  ) then
    raise exception 'Customer % does not belong to business %', p_customer_id, p_business_id
      using errcode = 'check_violation';
  end if;

  insert into loyalty_accounts (business_id, program_id, customer_id)
  values (p_business_id, p_program_id, p_customer_id)
  on conflict (program_id, customer_id) do update set updated_at = now()
  returning id into v_account_id;

  return v_account_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tier evaluation
-- -----------------------------------------------------------------------------

create or replace function fidelio_evaluate_tier(p_account_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account loyalty_accounts;
  v_program loyalty_programs;
  v_metric numeric;
  v_tier_id uuid;
  v_current_level int;
  v_new_level int;
begin
  select * into v_account from loyalty_accounts where id = p_account_id;
  if not found then return null; end if;

  select * into v_program from loyalty_programs where id = v_account.program_id;
  if not found or not v_program.tier_enabled then return v_account.tier_id; end if;

  -- Choose the metric the program ranks on. A rolling window keeps tiers
  -- meaningful: "spent €500 in the last year", not "once, in 2019".
  if v_program.tier_metric = 'lifetime_spend' then
    if v_program.tier_window_days is null then
      select coalesce(sum(amount), 0) into v_metric
        from activity_events
       where customer_id = v_account.customer_id
         and business_id = v_account.business_id
         and type = 'purchase';
    else
      select coalesce(sum(amount), 0) into v_metric
        from activity_events
       where customer_id = v_account.customer_id
         and business_id = v_account.business_id
         and type = 'purchase'
         and occurred_at >= now() - make_interval(days => v_program.tier_window_days);
    end if;
  elsif v_program.tier_metric = 'visit_count' then
    if v_program.tier_window_days is null then
      select count(*) into v_metric
        from activity_events
       where customer_id = v_account.customer_id
         and business_id = v_account.business_id
         and type in ('visit', 'purchase');
    else
      select count(*) into v_metric
        from activity_events
       where customer_id = v_account.customer_id
         and business_id = v_account.business_id
         and type in ('visit', 'purchase')
         and occurred_at >= now() - make_interval(days => v_program.tier_window_days);
    end if;
  else
    v_metric := v_account.lifetime_earned;
  end if;

  select id, level into v_tier_id, v_new_level
    from program_tiers
   where program_id = v_account.program_id
     and threshold <= v_metric
   order by threshold desc, level desc
   limit 1;

  select level into v_current_level from program_tiers where id = v_account.tier_id;

  -- Respect allow_downgrade on the tier the customer currently holds.
  if v_current_level is not null and v_new_level is not null and v_new_level < v_current_level then
    if not coalesce((select allow_downgrade from program_tiers where id = v_account.tier_id), true) then
      return v_account.tier_id;
    end if;
  end if;

  if v_tier_id is distinct from v_account.tier_id then
    update loyalty_accounts
       set tier_id = v_tier_id,
           tier_since = now()
     where id = p_account_id;

    insert into activity_events (business_id, customer_id, type, source, metadata)
    values (
      v_account.business_id,
      v_account.customer_id,
      'tier_change',
      'app',
      jsonb_build_object(
        'program_id', v_account.program_id,
        'from_tier_id', v_account.tier_id,
        'to_tier_id', v_tier_id,
        'direction', case
          when v_current_level is null then 'granted'
          when coalesce(v_new_level, 0) > v_current_level then 'upgrade'
          else 'downgrade' end
      )
    );
  end if;

  return v_tier_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Credit
-- -----------------------------------------------------------------------------

create or replace function fidelio_credit_account(
  p_business_id uuid,
  p_program_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_entry_type text default 'earn',
  p_reason text default null,
  p_rule_id uuid default null,
  p_event_id uuid default null,
  p_campaign_id uuid default null,
  p_location_id uuid default null,
  p_staff_user_id uuid default null,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account loyalty_accounts;
  v_program loyalty_programs;
  v_account_id uuid;
  v_entry loyalty_ledger;
  v_existing loyalty_ledger;
  v_expires_at timestamptz;
  v_new_balance numeric;
  v_tier_before uuid;
  v_tier_after uuid;
begin
  if p_amount <= 0 then
    raise exception 'Credit amount must be positive (got %)', p_amount
      using errcode = 'check_violation';
  end if;

  -- Idempotency: a retried request returns the original result unchanged.
  if p_idempotency_key is not null then
    select * into v_existing
      from loyalty_ledger
     where business_id = p_business_id and idempotency_key = p_idempotency_key;
    if found then
      select * into v_account from loyalty_accounts where id = v_existing.account_id;
      return jsonb_build_object(
        'duplicate', true,
        'entry_id', v_existing.id,
        'account_id', v_existing.account_id,
        'amount', v_existing.amount,
        'balance', v_account.balance,
        'lifetime_earned', v_account.lifetime_earned,
        'tier_id', v_account.tier_id
      );
    end if;
  end if;

  v_account_id := fidelio_ensure_account(p_business_id, p_program_id, p_customer_id);

  -- Serialise concurrent writers on this one account.
  select * into v_account from loyalty_accounts where id = v_account_id for update;
  select * into v_program from loyalty_programs where id = p_program_id;
  v_tier_before := v_account.tier_id;

  if v_program.expiry_months is not null then
    v_expires_at := now() + make_interval(months => v_program.expiry_months);
  end if;

  v_new_balance := v_account.balance + p_amount;

  insert into loyalty_ledger (
    business_id, program_id, customer_id, account_id, entry_type, amount,
    balance_after, remaining, expires_at, reason, rule_id, event_id, campaign_id,
    location_id, staff_user_id, idempotency_key, metadata
  ) values (
    p_business_id, p_program_id, p_customer_id, v_account_id, p_entry_type, p_amount,
    v_new_balance, p_amount, v_expires_at, p_reason, p_rule_id, p_event_id, p_campaign_id,
    p_location_id, p_staff_user_id, p_idempotency_key, coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_entry;

  update loyalty_accounts
     set balance = v_new_balance,
         lifetime_earned = lifetime_earned + case when p_entry_type in ('earn', 'adjust', 'transfer_in') then p_amount else 0 end,
         last_earn_at = now(),
         next_expiry_at = (
           select min(l.expires_at) from loyalty_ledger l
            where l.account_id = v_account_id
              and l.remaining > 0
              and l.expires_at is not null
         )
   where id = v_account_id;

  v_tier_after := fidelio_evaluate_tier(v_account_id);

  select * into v_account from loyalty_accounts where id = v_account_id;

  return jsonb_build_object(
    'duplicate', false,
    'entry_id', v_entry.id,
    'account_id', v_account_id,
    'program_id', p_program_id,
    'amount', p_amount,
    'balance', v_account.balance,
    'lifetime_earned', v_account.lifetime_earned,
    'tier_id', v_account.tier_id,
    'tier_changed', v_tier_after is distinct from v_tier_before,
    'goal_amount', v_program.goal_amount,
    'reward_available', v_program.goal_amount is not null and v_account.balance >= v_program.goal_amount,
    'expires_at', v_expires_at
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Debit (FIFO across open credits so the oldest / soonest-expiring goes first)
-- -----------------------------------------------------------------------------

create or replace function fidelio_debit_account(
  p_business_id uuid,
  p_program_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_entry_type text default 'redeem',
  p_reason text default null,
  p_reward_id uuid default null,
  p_event_id uuid default null,
  p_location_id uuid default null,
  p_staff_user_id uuid default null,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account loyalty_accounts;
  v_account_id uuid;
  v_entry loyalty_ledger;
  v_existing loyalty_ledger;
  v_remaining_to_consume numeric := p_amount;
  v_credit record;
  v_take numeric;
  v_new_balance numeric;
begin
  if p_amount <= 0 then
    raise exception 'Debit amount must be positive (got %)', p_amount
      using errcode = 'check_violation';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing
      from loyalty_ledger
     where business_id = p_business_id and idempotency_key = p_idempotency_key;
    if found then
      select * into v_account from loyalty_accounts where id = v_existing.account_id;
      return jsonb_build_object(
        'duplicate', true,
        'entry_id', v_existing.id,
        'account_id', v_existing.account_id,
        'amount', v_existing.amount,
        'balance', v_account.balance
      );
    end if;
  end if;

  v_account_id := fidelio_ensure_account(p_business_id, p_program_id, p_customer_id);
  select * into v_account from loyalty_accounts where id = v_account_id for update;

  if v_account.balance < p_amount then
    raise exception 'Insufficient balance: have %, need %', v_account.balance, p_amount
      using errcode = 'check_violation', hint = 'insufficient_balance';
  end if;

  -- Consume open credits oldest-first so expiring balance is spent before
  -- balance that would still be valid next month.
  for v_credit in
    select id, remaining
      from loyalty_ledger
     where account_id = v_account_id
       and entry_type in ('earn', 'adjust', 'transfer_in')
       and remaining > 0
     order by expires_at asc nulls last, created_at asc
     for update
  loop
    exit when v_remaining_to_consume <= 0;
    v_take := least(v_credit.remaining, v_remaining_to_consume);
    update loyalty_ledger
       set remaining = remaining - v_take,
           consumed_at = case when remaining - v_take <= 0 then now() else consumed_at end
     where id = v_credit.id;
    v_remaining_to_consume := v_remaining_to_consume - v_take;
  end loop;

  v_new_balance := v_account.balance - p_amount;

  insert into loyalty_ledger (
    business_id, program_id, customer_id, account_id, entry_type, amount,
    balance_after, remaining, reason, reward_id, event_id, location_id,
    staff_user_id, idempotency_key, metadata
  ) values (
    p_business_id, p_program_id, p_customer_id, v_account_id, p_entry_type, -p_amount,
    v_new_balance, 0, p_reason, p_reward_id, p_event_id, p_location_id,
    p_staff_user_id, p_idempotency_key, coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_entry;

  update loyalty_accounts
     set balance = v_new_balance,
         lifetime_redeemed = lifetime_redeemed + case when p_entry_type = 'redeem' then p_amount else 0 end,
         rewards_earned = rewards_earned + case when p_entry_type = 'redeem' then 1 else 0 end,
         last_redeem_at = case when p_entry_type = 'redeem' then now() else last_redeem_at end,
         next_expiry_at = (
           select min(l.expires_at) from loyalty_ledger l
            where l.account_id = v_account_id and l.remaining > 0 and l.expires_at is not null
         )
   where id = v_account_id;

  return jsonb_build_object(
    'duplicate', false,
    'entry_id', v_entry.id,
    'account_id', v_account_id,
    'amount', -p_amount,
    'balance', v_new_balance
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Record activity + apply pre-computed awards, atomically
--
-- Rule *matching* lives in TypeScript (testable, easy to reason about);
-- rule *application* lives here so the event and every resulting balance change
-- either all commit or none do.
-- -----------------------------------------------------------------------------

create or replace function fidelio_record_earn(
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

  -- Integration replays (Stripe, Square, Shopify) carry a provider event id.
  -- The partial unique index makes this the idempotency boundary for them.
  if v_external_id is not null then
    select id into v_event_id
      from activity_events
     where business_id = p_business_id and source = v_source and external_id = v_external_id;
    if found then
      return jsonb_build_object('duplicate', true, 'event_id', v_event_id, 'awards', '[]'::jsonb);
    end if;
  end if;

  insert into activity_events (
    business_id, customer_id, location_id, type, amount, currency, quantity,
    source, external_id, staff_user_id, metadata, occurred_at
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
    v_occurred_at
  )
  returning id into v_event_id;

  for v_award in select * from jsonb_array_elements(coalesce(p_awards, '[]'::jsonb))
  loop
    v_amount := (v_award ->> 'amount')::numeric;
    continue when v_amount is null or v_amount <= 0;

    v_results := v_results || jsonb_build_array(
      fidelio_credit_account(
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
  perform fidelio_recompute_customer_stats(p_customer_id);

  return jsonb_build_object('duplicate', false, 'event_id', v_event_id, 'awards', v_results);
end;
$$;

-- -----------------------------------------------------------------------------
-- Reward redemption
-- -----------------------------------------------------------------------------

create or replace function fidelio_redeem_reward(
  p_business_id uuid,
  p_customer_id uuid,
  p_reward_id uuid,
  p_location_id uuid default null,
  p_staff_user_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reward rewards;
  v_account loyalty_accounts;
  v_debit jsonb;
  v_redemption reward_redemptions;
  v_existing reward_redemptions;
  v_tier_level int;
  v_used int;
begin
  if p_idempotency_key is not null then
    select * into v_existing
      from reward_redemptions
     where business_id = p_business_id
       and metadata ->> 'idempotency_key' = p_idempotency_key;
    if found then
      return jsonb_build_object('duplicate', true, 'redemption_id', v_existing.id, 'code', v_existing.code);
    end if;
  end if;

  select * into v_reward from rewards where id = p_reward_id and business_id = p_business_id for update;
  if not found then
    raise exception 'Reward not found' using errcode = 'no_data_found';
  end if;
  if not v_reward.is_active then
    raise exception 'Reward is not active' using errcode = 'check_violation', hint = 'reward_inactive';
  end if;
  if v_reward.starts_at is not null and v_reward.starts_at > now() then
    raise exception 'Reward is not available yet' using errcode = 'check_violation', hint = 'reward_not_started';
  end if;
  if v_reward.ends_at is not null and v_reward.ends_at < now() then
    raise exception 'Reward has expired' using errcode = 'check_violation', hint = 'reward_ended';
  end if;
  if v_reward.stock is not null and v_reward.stock <= 0 then
    raise exception 'Reward is out of stock' using errcode = 'check_violation', hint = 'out_of_stock';
  end if;

  if v_reward.usage_limit_per_customer is not null then
    select count(*) into v_used
      from reward_redemptions
     where reward_id = p_reward_id
       and customer_id = p_customer_id
       and status in ('claimed', 'fulfilled');
    if v_used >= v_reward.usage_limit_per_customer then
      raise exception 'Redemption limit reached for this customer'
        using errcode = 'check_violation', hint = 'per_customer_limit';
    end if;
  end if;

  if v_reward.program_id is null then
    raise exception 'Reward is not attached to a program' using errcode = 'check_violation';
  end if;

  if v_reward.min_tier_level is not null then
    select t.level into v_tier_level
      from loyalty_accounts a
      left join program_tiers t on t.id = a.tier_id
     where a.program_id = v_reward.program_id and a.customer_id = p_customer_id;
    if coalesce(v_tier_level, 0) < v_reward.min_tier_level then
      raise exception 'Customer tier is too low for this reward'
        using errcode = 'check_violation', hint = 'tier_too_low';
    end if;
  end if;

  if v_reward.cost > 0 then
    v_debit := fidelio_debit_account(
      p_business_id, v_reward.program_id, p_customer_id, v_reward.cost,
      'redeem', v_reward.name, p_reward_id, null, p_location_id, p_staff_user_id,
      case when p_idempotency_key is null then null else p_idempotency_key || ':debit' end
    );
  end if;

  insert into reward_redemptions (
    business_id, customer_id, program_id, reward_id, redeemed_by, location_id,
    ledger_entry_id, cost, status, expires_at, fulfilled_at, metadata
  ) values (
    p_business_id, p_customer_id, v_reward.program_id, p_reward_id, p_staff_user_id, p_location_id,
    nullif(v_debit ->> 'entry_id', '')::uuid,
    v_reward.cost,
    'fulfilled',
    now() + make_interval(days => v_reward.valid_days),
    now(),
    jsonb_strip_nulls(jsonb_build_object('idempotency_key', p_idempotency_key))
  )
  returning * into v_redemption;

  update rewards
     set redeemed_count = redeemed_count + 1,
         stock = case when stock is null then null else stock - 1 end
   where id = p_reward_id;

  insert into activity_events (
    business_id, customer_id, location_id, type, source, staff_user_id, metadata
  ) values (
    p_business_id, p_customer_id, p_location_id, 'redeem', 'app', p_staff_user_id,
    jsonb_build_object('reward_id', p_reward_id, 'reward_name', v_reward.name, 'cost', v_reward.cost)
  );

  select * into v_account
    from loyalty_accounts
   where program_id = v_reward.program_id and customer_id = p_customer_id;

  -- A classic punch card resets simply because the debit above removed exactly
  -- goal_amount from the balance; no separate reset step is needed.

  return jsonb_build_object(
    'duplicate', false,
    'redemption_id', v_redemption.id,
    'code', v_redemption.code,
    'reward_name', v_reward.name,
    'cost', v_reward.cost,
    'balance', coalesce(v_account.balance, 0),
    'expires_at', v_redemption.expires_at
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Balance expiry sweep (run nightly)
-- -----------------------------------------------------------------------------

create or replace function fidelio_expire_balances(p_business_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credit record;
  v_expired_total numeric := 0;
  v_entries int := 0;
  v_account loyalty_accounts;
begin
  for v_credit in
    select l.id, l.account_id, l.business_id, l.program_id, l.customer_id, l.remaining
      from loyalty_ledger l
     where l.remaining > 0
       and l.expires_at is not null
       and l.expires_at <= now()
       and (p_business_id is null or l.business_id = p_business_id)
     order by l.expires_at
     limit 5000
  loop
    select * into v_account from loyalty_accounts where id = v_credit.account_id for update;

    update loyalty_ledger
       set remaining = 0, consumed_at = now()
     where id = v_credit.id;

    insert into loyalty_ledger (
      business_id, program_id, customer_id, account_id, entry_type, amount,
      balance_after, remaining, reason, reverses_entry_id
    ) values (
      v_credit.business_id, v_credit.program_id, v_credit.customer_id, v_credit.account_id,
      'expire', -v_credit.remaining,
      greatest(0, v_account.balance - v_credit.remaining), 0,
      'Balance expired', v_credit.id
    );

    update loyalty_accounts
       set balance = greatest(0, balance - v_credit.remaining),
           next_expiry_at = (
             select min(l.expires_at) from loyalty_ledger l
              where l.account_id = v_credit.account_id and l.remaining > 0 and l.expires_at is not null
           )
     where id = v_credit.account_id;

    v_expired_total := v_expired_total + v_credit.remaining;
    v_entries := v_entries + 1;
  end loop;

  return jsonb_build_object('entries', v_entries, 'expired_total', v_expired_total);
end;
$$;

-- -----------------------------------------------------------------------------
-- Customer behavioural rollups
--
-- Recomputed on every recorded event. Cheap because it is bounded to one
-- customer, and it keeps segment/analytics queries index-friendly instead of
-- forcing a scan over the whole event table at read time.
-- -----------------------------------------------------------------------------

create or replace function fidelio_recompute_customer_stats(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first timestamptz;
  v_last timestamptz;
  v_visits int;
  v_spend numeric;
  v_purchases int;
  v_last_purchase timestamptz;
begin
  select min(occurred_at),
         max(occurred_at) filter (where type in ('visit', 'purchase', 'earn')),
         count(*) filter (where type in ('visit', 'purchase')),
         coalesce(sum(amount) filter (where type = 'purchase'), 0),
         count(*) filter (where type = 'purchase'),
         max(occurred_at) filter (where type = 'purchase')
    into v_first, v_last, v_visits, v_spend, v_purchases, v_last_purchase
    from activity_events
   where customer_id = p_customer_id;

  update customers
     set first_visit_at = v_first,
         last_visit = greatest(v_last, last_visit),
         visit_count = coalesce(v_visits, 0),
         lifetime_spend = coalesce(v_spend, 0),
         average_ticket = case when coalesce(v_purchases, 0) > 0
                               then round(v_spend / v_purchases, 2) else 0 end,
         last_purchase_at = v_last_purchase,
         days_between_visits = case
           when coalesce(v_visits, 0) > 1 and v_first is not null and v_last is not null
           then round(extract(epoch from (v_last - v_first)) / 86400.0 / (v_visits - 1), 2)
           else null end,
         stats_updated_at = now()
   where id = p_customer_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RFM scoring — quintile ranking per business, the backbone of segmentation
-- -----------------------------------------------------------------------------

create or replace function fidelio_recompute_rfm(p_business_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with scored as (
    select c.id,
           ntile(5) over (order by coalesce(c.last_visit, c.created_at) asc) as r_rank,
           ntile(5) over (order by c.visit_count asc) as f_rank,
           ntile(5) over (order by c.lifetime_spend asc) as m_rank
      from customers c
     where c.business_id = p_business_id
       and c.status = 'active'
       and c.merged_into_customer_id is null
  )
  update customers c
     set rfm_recency = s.r_rank,
         rfm_frequency = s.f_rank,
         rfm_monetary = s.m_rank,
         rfm_segment = case
           when s.r_rank >= 4 and s.f_rank >= 4 and s.m_rank >= 4 then 'champion'
           when s.r_rank >= 4 and s.f_rank >= 3 then 'loyal'
           when s.r_rank >= 4 and s.f_rank <= 2 then 'new'
           when s.r_rank = 3 and s.f_rank >= 3 then 'potential_loyalist'
           when s.r_rank <= 2 and s.f_rank >= 4 then 'at_risk'
           when s.r_rank <= 2 and s.m_rank >= 4 then 'cant_lose'
           when s.r_rank <= 2 and s.f_rank <= 2 then 'hibernating'
           else 'needs_attention'
         end,
         stats_updated_at = now()
    from scored s
   where c.id = s.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Duplicate merge — every merchant's customer list has "ana@" and "Ana@"
-- -----------------------------------------------------------------------------

create or replace function fidelio_merge_customers(
  p_business_id uuid,
  p_primary_id uuid,
  p_duplicate_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary customers;
  v_duplicate customers;
  v_program record;
  v_moved numeric := 0;
begin
  if p_primary_id = p_duplicate_id then
    raise exception 'Cannot merge a customer into itself' using errcode = 'check_violation';
  end if;

  select * into v_primary from customers
   where id = p_primary_id and business_id = p_business_id for update;
  if not found then raise exception 'Primary customer not found' using errcode = 'no_data_found'; end if;

  select * into v_duplicate from customers
   where id = p_duplicate_id and business_id = p_business_id for update;
  if not found then raise exception 'Duplicate customer not found' using errcode = 'no_data_found'; end if;

  -- History follows the surviving record.
  update activity_events set customer_id = p_primary_id where customer_id = p_duplicate_id;
  update customer_notes set customer_id = p_primary_id where customer_id = p_duplicate_id;
  update reward_redemptions set customer_id = p_primary_id where customer_id = p_duplicate_id;
  update survey_responses set customer_id = p_primary_id where customer_id = p_duplicate_id;
  update messages set customer_id = p_primary_id where customer_id = p_duplicate_id;
  update referrals set referrer_customer_id = p_primary_id where referrer_customer_id = p_duplicate_id;
  update referrals set referred_customer_id = p_primary_id where referred_customer_id = p_duplicate_id;
  update customers set referred_by = p_primary_id where referred_by = p_duplicate_id;

  insert into customer_tags (customer_id, tag_id, business_id)
  select p_primary_id, tag_id, business_id from customer_tags where customer_id = p_duplicate_id
  on conflict do nothing;
  delete from customer_tags where customer_id = p_duplicate_id;

  -- Balances are transferred through the ledger so the audit trail stays intact.
  for v_program in
    select a.program_id, a.balance
      from loyalty_accounts a
     where a.customer_id = p_duplicate_id and a.balance > 0
  loop
    perform fidelio_debit_account(
      p_business_id, v_program.program_id, p_duplicate_id, v_program.balance,
      'transfer_out', 'Merged into primary customer'
    );
    perform fidelio_credit_account(
      p_business_id, v_program.program_id, p_primary_id, v_program.balance,
      'transfer_in', 'Merged from duplicate customer'
    );
    v_moved := v_moved + v_program.balance;
  end loop;

  -- Fill gaps on the primary record from the duplicate.
  update customers
     set name = coalesce(name, v_duplicate.name),
         first_name = coalesce(first_name, v_duplicate.first_name),
         last_name = coalesce(last_name, v_duplicate.last_name),
         phone = coalesce(phone, v_duplicate.phone),
         birthday = coalesce(birthday, v_duplicate.birthday),
         anniversary = coalesce(anniversary, v_duplicate.anniversary),
         apple_push_token = coalesce(apple_push_token, v_duplicate.apple_push_token),
         is_vip = is_vip or v_duplicate.is_vip,
         custom_fields = v_duplicate.custom_fields || custom_fields
   where id = p_primary_id;

  update customers
     set status = 'anonymized',
         merged_into_customer_id = p_primary_id,
         email = ('merged+' || p_duplicate_id::text || '@fidelio.invalid')::citext,
         phone = null,
         apple_push_token = null,
         web_push_subscription = null,
         anonymized_at = now()
   where id = p_duplicate_id;

  perform fidelio_recompute_customer_stats(p_primary_id);

  return jsonb_build_object(
    'primary_id', p_primary_id,
    'merged_id', p_duplicate_id,
    'balance_moved', v_moved
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- GDPR erasure — keep aggregate history, destroy personal data
-- -----------------------------------------------------------------------------

create or replace function fidelio_anonymize_customer(
  p_business_id uuid,
  p_customer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update customers
     set email = ('erased+' || p_customer_id::text || '@fidelio.invalid')::citext,
         name = null,
         first_name = null,
         last_name = null,
         phone = null,
         birthday = null,
         anniversary = null,
         avatar_url = null,
         apple_push_token = null,
         apple_pass_serial = null,
         apple_device_library_id = null,
         google_wallet_object_id = null,
         web_push_subscription = null,
         wallet_auth_token = null,
         external_ids = '{}'::jsonb,
         custom_fields = '{}'::jsonb,
         consent_email = false,
         consent_sms = false,
         consent_whatsapp = false,
         consent_push = false,
         consent_marketing = false,
         status = 'anonymized',
         anonymized_at = now()
   where id = p_customer_id and business_id = p_business_id;

  delete from customer_notes where customer_id = p_customer_id;
  delete from customer_tags where customer_id = p_customer_id;
  update messages set recipient = '[erased]', body_preview = null, subject = null
   where customer_id = p_customer_id;
  update survey_responses set comment = null where customer_id = p_customer_id;
end;
$$;
