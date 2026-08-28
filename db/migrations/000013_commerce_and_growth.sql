-- Ported from the previous hosted-Postgres provider to standard PostgreSQL.
-- Transformations applied (see docs/POSTGRESQL.md):
--   auth.users            -> app_users            (an ordinary table we own)
--   auth.uid()            -> app_current_user_id()
--   grants to anon / authenticated / service_role -> removed (provider roles)

-- =============================================================================
-- 000013 — Commerce and growth
--
-- The schema up to 000012 describes a loyalty engine. This migration adds the
-- layer that turns it into a business:
--
--   * Subscription billing for us     — plan, seats, metered usage, Stripe events
--   * Gift cards for the merchant     — prepaid cash today, a new customer later
--   * Paid memberships                — the merchant's own recurring revenue
--   * Referral attribution            — both customer-to-customer and merchant-to-merchant
--   * The coalition directory         — the network effect, opt-in and revocable
--
-- Every money-moving operation is a SECURITY DEFINER function that locks its
-- row, honours an idempotency key and writes an immutable transaction record,
-- exactly like `fidelio_credit_account`. Nothing reads a balance into
-- JavaScript and writes it back.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Subscription billing (ours)
-- -----------------------------------------------------------------------------

-- `free` joins the ladder: a trial that ends without a card must land somewhere
-- that still works, because a merchant whose stamp cards stopped scanning will
-- never come back to buy.
alter table businesses drop constraint if exists businesses_plan_check;
alter table businesses add constraint businesses_plan_check
  check (plan in ('trial', 'free', 'starter', 'growth', 'pro', 'enterprise'));

alter table businesses add column if not exists plan_interval text not null default 'month';
alter table businesses add column if not exists cancel_at_period_end boolean not null default false;
alter table businesses add column if not exists trial_extended_days int not null default 0;
-- Credit earned by referring other merchants, spent automatically at renewal.
alter table businesses add column if not exists referral_credit numeric(12, 2) not null default 0;

do $$ begin
  alter table businesses add constraint businesses_plan_interval_check
    check (plan_interval in ('month', 'year'));
exception when duplicate_object then null; end $$;

-- Opt-in presence in the local partner directory. Off by default: a merchant's
-- participation in the network is theirs to grant, never assumed.
alter table businesses add column if not exists network_opt_in boolean not null default false;
alter table businesses add column if not exists network_bio text;

create index if not exists idx_businesses_network
  on businesses (city, category) where network_opt_in;

/**
 * Every Stripe event we have processed, keyed by the provider's event id.
 *
 * Stripe guarantees at-least-once delivery, so the webhook must be idempotent.
 * Inserting here first — and letting the unique constraint reject a replay — is
 * what makes "charge applied twice" impossible rather than unlikely.
 */
create table if not exists subscription_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses (id) on delete cascade,
  provider text not null default 'stripe',
  provider_event_id text not null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_subscription_events_provider_id
  on subscription_events (provider, provider_event_id);
create index if not exists idx_subscription_events_business
  on subscription_events (business_id, created_at desc);

/**
 * Metered usage, one row per business / metric / calendar month.
 *
 * Limits are enforced against this table rather than by counting the source
 * rows: counting 400,000 messages on every send is how a plan check becomes
 * the slowest part of a campaign.
 */
create table if not exists usage_counters (
  business_id uuid not null references businesses (id) on delete cascade,
  period text not null,
  metric text not null,
  used numeric(14, 2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (business_id, period, metric)
);

create index if not exists idx_usage_counters_period on usage_counters (period);

/** Atomic increment. Concurrent sends cannot lose an update. */
create or replace function fidelio_track_usage(
  p_business_id uuid,
  p_metric text,
  p_amount numeric default 1,
  p_period text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period text := coalesce(p_period, to_char(now() at time zone 'utc', 'YYYY-MM'));
  v_used numeric;
begin
  insert into usage_counters (business_id, period, metric, used)
  values (p_business_id, v_period, p_metric, p_amount)
  on conflict (business_id, period, metric)
  do update set used = usage_counters.used + excluded.used, updated_at = now()
  returning used into v_used;

  return v_used;
end;
$$;

-- -----------------------------------------------------------------------------
-- Gift cards
-- -----------------------------------------------------------------------------

alter table gift_cards add column if not exists purchaser_name text;
alter table gift_cards add column if not exists recipient_name text;
alter table gift_cards add column if not exists design text not null default 'classic';
-- Scheduled delivery: "email this to my mother on her birthday".
alter table gift_cards add column if not exists deliver_at timestamptz;
alter table gift_cards add column if not exists delivered_at timestamptz;
alter table gift_cards add column if not exists source text not null default 'manual';
alter table gift_cards add column if not exists stripe_payment_intent_id text;
alter table gift_cards add column if not exists location_id uuid references locations (id) on delete set null;

do $$ begin
  alter table gift_cards add constraint gift_cards_source_check
    check (source in ('manual', 'online', 'pos', 'import', 'promo'));
exception when duplicate_object then null; end $$;

create index if not exists idx_gift_cards_delivery
  on gift_cards (deliver_at) where delivered_at is null and deliver_at is not null;
create index if not exists idx_gift_cards_recipient
  on gift_cards (business_id, recipient_customer_id) where recipient_customer_id is not null;

/**
 * Issues a gift card and records the opening transaction in one statement.
 *
 * Returns the full card so the caller never has to re-select it, and honours an
 * idempotency key so a double-submitted purchase form issues one card, not two.
 */
create or replace function fidelio_issue_gift_card(
  p_business_id uuid,
  p_amount numeric,
  p_purchaser_email text default null,
  p_purchaser_name text default null,
  p_recipient_email text default null,
  p_recipient_name text default null,
  p_message text default null,
  p_design text default 'classic',
  p_expires_at timestamptz default null,
  p_deliver_at timestamptz default null,
  p_source text default 'manual',
  p_issued_by uuid default null,
  p_location_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card gift_cards;
  v_existing gift_card_transactions;
  v_currency text;
  v_customer_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Gift card amount must be positive' using errcode = 'check_violation';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing
      from gift_card_transactions
     where business_id = p_business_id and idempotency_key = p_idempotency_key;
    if found then
      select * into v_card from gift_cards where id = v_existing.gift_card_id;
      return jsonb_build_object(
        'duplicate', true,
        'gift_card_id', v_card.id,
        'code', v_card.code,
        'initial_value', v_card.initial_value,
        'remaining_value', v_card.remaining_value
      );
    end if;
  end if;

  select currency into v_currency from businesses where id = p_business_id;

  -- Link the card to a known customer when the recipient is already a member,
  -- so the balance shows up on their card and in their timeline.
  if p_recipient_email is not null then
    select id into v_customer_id
      from customers
     where business_id = p_business_id and email = p_recipient_email::citext
     limit 1;
  end if;

  insert into gift_cards (
    business_id, initial_value, remaining_value, currency,
    purchaser_email, purchaser_name, recipient_email, recipient_name,
    recipient_customer_id, message, design, expires_at, deliver_at,
    source, issued_by, location_id, status
  ) values (
    p_business_id, p_amount, p_amount, coalesce(v_currency, 'EUR'),
    p_purchaser_email, p_purchaser_name, p_recipient_email, p_recipient_name,
    v_customer_id, p_message, coalesce(p_design, 'classic'), p_expires_at, p_deliver_at,
    coalesce(p_source, 'manual'), p_issued_by, p_location_id, 'active'
  )
  returning * into v_card;

  insert into gift_card_transactions (
    business_id, gift_card_id, amount, balance_after, kind,
    location_id, staff_user_id, idempotency_key
  ) values (
    p_business_id, v_card.id, p_amount, p_amount, 'issue',
    p_location_id, p_issued_by, p_idempotency_key
  );

  if v_customer_id is not null then
    insert into activity_events (
      business_id, customer_id, location_id, type, amount, source, metadata
    ) values (
      p_business_id, v_customer_id, p_location_id, 'gift_card', p_amount,
      coalesce(p_source, 'manual'), jsonb_build_object('gift_card_id', v_card.id, 'kind', 'received')
    );
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'gift_card_id', v_card.id,
    'code', v_card.code,
    'initial_value', v_card.initial_value,
    'remaining_value', v_card.remaining_value,
    'recipient_customer_id', v_customer_id
  );
end;
$$;

/** Voids the unspent remainder of a card, e.g. after a refund or a fraud report. */
create or replace function fidelio_void_gift_card(
  p_business_id uuid,
  p_gift_card_id uuid,
  p_staff_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card gift_cards;
begin
  select * into v_card
    from gift_cards
   where id = p_gift_card_id and business_id = p_business_id
   for update;

  if not found then
    raise exception 'Gift card not found' using errcode = 'no_data_found';
  end if;
  if v_card.status = 'void' then
    return jsonb_build_object('already_void', true, 'gift_card_id', v_card.id);
  end if;

  update gift_cards
     set status = 'void', remaining_value = 0
   where id = v_card.id;

  insert into gift_card_transactions (
    business_id, gift_card_id, amount, balance_after, kind, staff_user_id
  ) values (
    p_business_id, v_card.id, -v_card.remaining_value, 0, 'void', p_staff_user_id
  );

  return jsonb_build_object(
    'already_void', false,
    'gift_card_id', v_card.id,
    'voided_value', v_card.remaining_value
  );
end;
$$;

/** Portfolio view: outstanding liability is the number an accountant asks for. */
create or replace function fidelio_gift_card_stats(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'issued_count', count(*),
    'active_count', count(*) filter (where status = 'active'),
    'issued_value', coalesce(sum(initial_value), 0),
    'outstanding_value', coalesce(sum(remaining_value) filter (where status = 'active'), 0),
    'redeemed_value', coalesce(sum(initial_value - remaining_value) filter (where status <> 'void'), 0),
    'issued_30d', count(*) filter (where created_at > now() - interval '30 days'),
    'issued_value_30d', coalesce(sum(initial_value) filter (where created_at > now() - interval '30 days'), 0),
    'breakage_value', coalesce(sum(remaining_value) filter (where status = 'expired'), 0)
  )
  from gift_cards
  where business_id = p_business_id;
$$;

-- -----------------------------------------------------------------------------
-- Paid memberships
-- -----------------------------------------------------------------------------

alter table membership_plans add column if not exists trial_days int not null default 0;
alter table membership_plans add column if not exists max_members int;
alter table membership_plans add column if not exists member_count int not null default 0;
alter table membership_plans add column if not exists sort_order int not null default 0;
-- A free tier the merchant hands out (staff, founders) still needs a plan row.
alter table membership_plans add column if not exists is_public boolean not null default true;

alter table customer_memberships add column if not exists cancel_at_period_end boolean not null default false;
alter table customer_memberships add column if not exists last_grant_at timestamptz;
alter table customer_memberships add column if not exists periods_billed int not null default 0;
alter table customer_memberships add column if not exists lifetime_value numeric(14, 2) not null default 0;
alter table customer_memberships add column if not exists source text not null default 'manual';

/**
 * Enrols a customer on a plan and grants the first period's balance.
 *
 * Re-enrolling a cancelled member reactivates the existing row rather than
 * failing on the unique constraint — churned-then-returned is the common case,
 * and their history should survive it.
 */
create or replace function fidelio_enroll_membership(
  p_business_id uuid,
  p_customer_id uuid,
  p_plan_id uuid,
  p_source text default 'manual',
  p_stripe_subscription_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan membership_plans;
  v_membership customer_memberships;
  v_period_end timestamptz;
  v_credit jsonb;
  v_reactivated boolean := false;
begin
  select * into v_plan
    from membership_plans
   where id = p_plan_id and business_id = p_business_id and is_active
   for update;

  if not found then
    raise exception 'Membership plan not found or inactive' using errcode = 'no_data_found';
  end if;

  if v_plan.max_members is not null and v_plan.member_count >= v_plan.max_members then
    raise exception 'This membership is full'
      using errcode = 'check_violation', hint = 'membership_full';
  end if;

  v_period_end := now()
    + (case when v_plan.interval = 'year' then interval '1 year' else interval '1 month' end)
    + (v_plan.trial_days || ' days')::interval;

  select * into v_membership
    from customer_memberships
   where customer_id = p_customer_id and plan_id = p_plan_id
   for update;

  if found then
    if v_membership.status = 'active' then
      return jsonb_build_object(
        'already_member', true,
        'membership_id', v_membership.id,
        'current_period_end', v_membership.current_period_end
      );
    end if;
    update customer_memberships
       set status = 'active',
           cancelled_at = null,
           cancel_at_period_end = false,
           current_period_end = v_period_end,
           stripe_subscription_id = coalesce(p_stripe_subscription_id, stripe_subscription_id),
           source = coalesce(p_source, source),
           last_grant_at = now(),
           periods_billed = v_membership.periods_billed + 1
     where id = v_membership.id
     returning * into v_membership;
    v_reactivated := true;
  else
    insert into customer_memberships (
      business_id, customer_id, plan_id, status, stripe_subscription_id,
      current_period_end, last_grant_at, periods_billed, source
    ) values (
      p_business_id, p_customer_id, p_plan_id, 'active', p_stripe_subscription_id,
      v_period_end, now(), 1, coalesce(p_source, 'manual')
    )
    returning * into v_membership;
  end if;

  update membership_plans
     set member_count = (
       select count(*) from customer_memberships
        where plan_id = p_plan_id and status = 'active'
     )
   where id = p_plan_id;

  -- Included balance is granted through the ledger like any other credit, so
  -- membership value shows up in the same reports as everything else.
  if v_plan.included_balance > 0 and v_plan.program_id is not null then
    v_credit := fidelio_credit_account(
      p_business_id := p_business_id,
      p_customer_id := p_customer_id,
      p_program_id := v_plan.program_id,
      p_amount := v_plan.included_balance,
      p_entry_type := 'earn',
      p_reason := 'Membership: ' || v_plan.name,
      p_idempotency_key := 'membership:' || v_membership.id::text || ':' || v_membership.periods_billed::text
    );
  end if;

  insert into activity_events (business_id, customer_id, type, amount, source, metadata)
  values (
    p_business_id, p_customer_id, 'custom', v_plan.price, coalesce(p_source, 'manual'),
    jsonb_build_object(
      'kind', 'membership_started',
      'plan_id', v_plan.id,
      'plan_name', v_plan.name,
      'reactivated', v_reactivated
    )
  );

  return jsonb_build_object(
    'already_member', false,
    'reactivated', v_reactivated,
    'membership_id', v_membership.id,
    'plan_name', v_plan.name,
    'current_period_end', v_membership.current_period_end,
    'granted_balance', coalesce(v_plan.included_balance, 0)
  );
end;
$$;

/**
 * Rolls active memberships whose period has ended into the next one.
 *
 * Run daily. Members flagged `cancel_at_period_end` lapse instead of renewing;
 * members without a Stripe subscription (cash / in-person plans) renew on trust
 * because the merchant collects payment at the counter.
 */
create or replace function fidelio_renew_memberships(p_business_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_renewed int := 0;
  v_expired int := 0;
  v_period_end timestamptz;
begin
  for v_row in
    select m.*, p.name as plan_name, p.interval, p.included_balance, p.program_id, p.price
      from customer_memberships m
      join membership_plans p on p.id = m.plan_id
     where m.status = 'active'
       and m.current_period_end is not null
       and m.current_period_end <= now()
       and (p_business_id is null or m.business_id = p_business_id)
     order by m.current_period_end
     limit 5000
  loop
    if v_row.cancel_at_period_end then
      update customer_memberships
         set status = 'expired', cancelled_at = coalesce(cancelled_at, now())
       where id = v_row.id;
      v_expired := v_expired + 1;
      continue;
    end if;

    v_period_end := v_row.current_period_end
      + (case when v_row.interval = 'year' then interval '1 year' else interval '1 month' end);
    -- A membership that lapsed while the worker was down catches up rather
    -- than renewing into the past.
    while v_period_end <= now() loop
      v_period_end := v_period_end
        + (case when v_row.interval = 'year' then interval '1 year' else interval '1 month' end);
    end loop;

    update customer_memberships
       set current_period_end = v_period_end,
           periods_billed = v_row.periods_billed + 1,
           lifetime_value = v_row.lifetime_value + coalesce(v_row.price, 0),
           last_grant_at = now()
     where id = v_row.id;

    if v_row.included_balance > 0 and v_row.program_id is not null then
      perform fidelio_credit_account(
        p_business_id := v_row.business_id,
        p_customer_id := v_row.customer_id,
        p_program_id := v_row.program_id,
        p_amount := v_row.included_balance,
        p_entry_type := 'earn',
        p_reason := 'Membership renewal: ' || v_row.plan_name,
        p_idempotency_key := 'membership:' || v_row.id::text || ':' || (v_row.periods_billed + 1)::text
      );
    end if;

    v_renewed := v_renewed + 1;
  end loop;

  return jsonb_build_object('renewed', v_renewed, 'expired', v_expired);
end;
$$;

/**
 * The multiplier a customer's membership adds on top of their tier.
 *
 * Read by the earning engine on every award, so it is a single indexed lookup
 * returning the best active multiplier rather than a join over all plans.
 */
create or replace function fidelio_membership_multiplier(p_customer_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(p.earn_multiplier), 1)
    from customer_memberships m
    join membership_plans p on p.id = m.plan_id
   where m.customer_id = p_customer_id
     and m.status = 'active'
     and (m.current_period_end is null or m.current_period_end > now());
$$;

create or replace function fidelio_membership_stats(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'active_members', count(*) filter (where m.status = 'active'),
    'cancelled_members', count(*) filter (where m.status in ('cancelled', 'expired')),
    'mrr', coalesce(sum(
      case when m.status = 'active'
        then case when p.interval = 'year' then p.price / 12 else p.price end
        else 0 end
    ), 0),
    'lifetime_revenue', coalesce(sum(m.lifetime_value), 0),
    'churn_rate', case
      when count(*) = 0 then 0
      else round(
        count(*) filter (where m.status in ('cancelled', 'expired'))::numeric
        / count(*)::numeric * 100, 1)
    end,
    'renewing_30d', count(*) filter (
      where m.status = 'active' and m.current_period_end < now() + interval '30 days'
    )
  )
  from customer_memberships m
  join membership_plans p on p.id = m.plan_id
  where m.business_id = p_business_id;
$$;

-- -----------------------------------------------------------------------------
-- Referrals — reporting over the attribution that 000010 already records
-- -----------------------------------------------------------------------------

create or replace function fidelio_referral_stats(p_business_id uuid, p_days int default 90)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select * from referrals
     where business_id = p_business_id
       and created_at > now() - (p_days || ' days')::interval
  ),
  referred as (
    select c.id, c.lifetime_spend, c.visit_count
      from customers c
     where c.business_id = p_business_id
       and c.referred_by is not null
       and c.created_at > now() - (p_days || ' days')::interval
  )
  select jsonb_build_object(
    'total', (select count(*) from scoped),
    'pending', (select count(*) from scoped where status = 'pending'),
    'qualified', (select count(*) from scoped where status in ('qualified', 'rewarded')),
    'rejected', (select count(*) from scoped where status = 'rejected'),
    'conversion_rate', case
      when (select count(*) from scoped) = 0 then 0
      else round(
        (select count(*) from scoped where status in ('qualified', 'rewarded'))::numeric
        / (select count(*) from scoped)::numeric * 100, 1)
    end,
    'referred_customers', (select count(*) from referred),
    'referred_revenue', (select coalesce(sum(lifetime_spend), 0) from referred),
    'referred_avg_visits', (select coalesce(round(avg(visit_count), 1), 0) from referred),
    'advocates', (select count(distinct referrer_customer_id) from scoped)
  );
$$;

-- Merchant-to-merchant referrals ------------------------------------------
--
-- Local owners talk to each other constantly, and a recommendation from the
-- café two doors down converts better than any ad. Credit is granted only when
-- the referred business actually starts paying, so throwaway signups earn
-- nothing.

alter table businesses add column if not exists referral_credited_at timestamptz;

create index if not exists idx_businesses_referred_by
  on businesses (referred_by_business_id) where referred_by_business_id is not null;

/**
 * Pays the referrer once, when their referral converts to a paid plan.
 *
 * The `referral_credited_at` stamp is set inside the same statement that adds
 * the credit and is checked under a row lock, so the fifty subscription-updated
 * webhooks Stripe sends over a customer's lifetime pay out exactly once.
 */
create or replace function fidelio_credit_merchant_referral(
  p_referred_business_id uuid,
  p_amount numeric default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referred businesses;
  v_referrer_id uuid;
begin
  select * into v_referred
    from businesses
   where id = p_referred_business_id
   for update;

  if not found then
    raise exception 'Business not found' using errcode = 'no_data_found';
  end if;
  if v_referred.referral_credited_at is not null then
    return jsonb_build_object('already_credited', true);
  end if;
  if v_referred.referred_by_business_id is null then
    return jsonb_build_object('no_referrer', true);
  end if;

  v_referrer_id := v_referred.referred_by_business_id;

  update businesses set referral_credited_at = now() where id = p_referred_business_id;

  update businesses
     set referral_credit = referral_credit + p_amount
   where id = v_referrer_id;

  insert into notifications (business_id, user_id, kind, title, body, url, severity)
  select v_referrer_id, tm.user_id, 'billing',
         'You earned ' || p_amount::text || ' in credit',
         v_referred.name || ' upgraded to a paid plan. Your credit applies to the next invoice.',
         '/dashboard/growth', 'success'
    from team_members tm
   where tm.business_id = v_referrer_id
     and tm.status = 'active'
     and tm.role in ('owner', 'admin');

  return jsonb_build_object(
    'already_credited', false,
    'referrer_business_id', v_referrer_id,
    'amount', p_amount
  );
end;
$$;

/** Top advocates. Merchants reward these people by name; that is the whole point. */
create or replace function fidelio_referral_leaderboard(
  p_business_id uuid,
  p_limit int default 10
)
returns table (
  customer_id uuid,
  name text,
  email text,
  referral_code text,
  total int,
  qualified int,
  revenue_generated numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
         coalesce(nullif(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''), c.name),
         c.email::text,
         c.referral_code,
         count(r.id)::int,
         count(r.id) filter (where r.status in ('qualified', 'rewarded'))::int,
         coalesce((
           select sum(rc.lifetime_spend)
             from customers rc
            where rc.referred_by = c.id and rc.business_id = p_business_id
         ), 0)
    from customers c
    join referrals r on r.referrer_customer_id = c.id
   where r.business_id = p_business_id
   group by c.id, c.first_name, c.last_name, c.name, c.email, c.referral_code
  having count(r.id) > 0
   order by count(r.id) filter (where r.status in ('qualified', 'rewarded')) desc, count(r.id) desc
   limit greatest(1, least(p_limit, 100));
$$;

-- -----------------------------------------------------------------------------
-- Coalition — cross-business offers and their redemptions
-- -----------------------------------------------------------------------------

alter table coalition_offers add column if not exists per_customer_limit int not null default 1;
alter table coalition_offers add column if not exists image_url text;
alter table coalition_offers add column if not exists terms text;
alter table coalition_offers add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_coalition_offers_updated_at on coalition_offers;
create trigger trg_coalition_offers_updated_at before update on coalition_offers
  for each row execute function fidelio_touch_updated_at();

/**
 * A redemption of one business's offer by another business's member.
 *
 * `business_id` is the business that *published* the offer (and honours it);
 * `redeeming_business_id` is where the customer came from. Both sides need to
 * see the flow to know whether the partnership is worth keeping.
 */
create table if not exists coalition_redemptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  offer_id uuid not null references coalition_offers (id) on delete cascade,
  partnership_id uuid references business_partnerships (id) on delete set null,
  customer_id uuid references customers (id) on delete set null,
  redeeming_business_id uuid references businesses (id) on delete set null,
  amount numeric(12, 2),
  idempotency_key text,
  created_at timestamptz not null default now()
);

create index if not exists idx_coalition_redemptions_offer
  on coalition_redemptions (offer_id, created_at desc);
create index if not exists idx_coalition_redemptions_business
  on coalition_redemptions (business_id, created_at desc);
create unique index if not exists idx_coalition_redemptions_idempotency
  on coalition_redemptions (business_id, idempotency_key) where idempotency_key is not null;

/**
 * Redeems a coalition offer, enforcing both the global and per-customer limits
 * under a row lock so a popular offer cannot be over-redeemed by a race.
 */
create or replace function fidelio_redeem_coalition_offer(
  p_offer_id uuid,
  p_customer_id uuid,
  p_redeeming_business_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer coalition_offers;
  v_existing coalition_redemptions;
  v_used int;
begin
  select * into v_offer from coalition_offers where id = p_offer_id for update;
  if not found then
    raise exception 'Offer not found' using errcode = 'no_data_found';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing
      from coalition_redemptions
     where business_id = v_offer.business_id and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('duplicate', true, 'redemption_id', v_existing.id);
    end if;
  end if;

  if not v_offer.is_active then
    raise exception 'This offer is no longer available'
      using errcode = 'check_violation', hint = 'offer_inactive';
  end if;
  if v_offer.starts_at is not null and v_offer.starts_at > now() then
    raise exception 'This offer has not started yet'
      using errcode = 'check_violation', hint = 'offer_not_started';
  end if;
  if v_offer.ends_at is not null and v_offer.ends_at < now() then
    raise exception 'This offer has ended'
      using errcode = 'check_violation', hint = 'offer_ended';
  end if;
  if v_offer.redemption_limit is not null and v_offer.redeemed_count >= v_offer.redemption_limit then
    raise exception 'This offer has been fully claimed'
      using errcode = 'check_violation', hint = 'offer_exhausted';
  end if;

  select count(*) into v_used
    from coalition_redemptions
   where offer_id = p_offer_id and customer_id = p_customer_id;

  if v_used >= v_offer.per_customer_limit then
    raise exception 'You have already claimed this offer'
      using errcode = 'check_violation', hint = 'already_claimed';
  end if;

  update coalition_offers set redeemed_count = redeemed_count + 1 where id = p_offer_id;

  insert into coalition_redemptions (
    business_id, offer_id, partnership_id, customer_id, redeeming_business_id, idempotency_key
  ) values (
    v_offer.business_id, p_offer_id, v_offer.partnership_id, p_customer_id,
    p_redeeming_business_id, p_idempotency_key
  )
  returning * into v_existing;

  if p_customer_id is not null then
    insert into activity_events (business_id, customer_id, type, source, metadata)
    values (
      coalesce(p_redeeming_business_id, v_offer.business_id), p_customer_id, 'custom', 'coalition',
      jsonb_build_object('kind', 'coalition_redemption', 'offer_id', p_offer_id, 'title', v_offer.title)
    );
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'redemption_id', v_existing.id,
    'title', v_offer.title,
    'reward_id', v_offer.reward_id
  );
end;
$$;

/**
 * Partners of a business, from either side of the invitation, with the traffic
 * each one has actually produced. A partnership that sends nobody should be
 * visibly worthless.
 */
create or replace function fidelio_partner_summary(p_business_id uuid)
returns table (
  partnership_id uuid,
  partner_id uuid,
  partner_name text,
  partner_slug text,
  partner_logo_url text,
  partner_category text,
  partner_city text,
  status text,
  direction text,
  allow_cross_earn boolean,
  allow_cross_redeem boolean,
  share_audience boolean,
  offers_live int,
  redemptions_in int,
  redemptions_out int,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id,
         other.id,
         other.name,
         other.slug,
         other.logo_url,
         other.category,
         other.city,
         p.status,
         case when p.business_id = p_business_id then 'sent' else 'received' end,
         p.allow_cross_earn,
         p.allow_cross_redeem,
         p.share_audience,
         (select count(*)::int from coalition_offers o
           where o.partnership_id = p.id and o.is_active),
         (select count(*)::int from coalition_redemptions r
           where r.partnership_id = p.id and r.business_id = p_business_id),
         (select count(*)::int from coalition_redemptions r
           where r.partnership_id = p.id and r.redeeming_business_id = p_business_id),
         p.created_at
    from business_partnerships p
    join businesses other
      on other.id = case when p.business_id = p_business_id
                         then p.partner_business_id else p.business_id end
   where p.business_id = p_business_id or p.partner_business_id = p_business_id
   order by p.created_at desc;
$$;

-- -----------------------------------------------------------------------------
-- Review funnel — measure the loop, not just the send
-- -----------------------------------------------------------------------------

alter table survey_responses add column if not exists review_prompted_at timestamptz;
alter table survey_responses add column if not exists review_clicked_at timestamptz;
alter table survey_responses add column if not exists resolved_at timestamptz;
alter table survey_responses add column if not exists resolved_by uuid references app_users (id) on delete set null;
alter table survey_responses add column if not exists resolution_note text;

create index if not exists idx_survey_responses_unresolved
  on survey_responses (business_id, responded_at desc)
  where resolved_at is null;

-- -----------------------------------------------------------------------------
-- Notifications — severity so the bell can rank, not just list
-- -----------------------------------------------------------------------------

alter table notifications add column if not exists severity text not null default 'info';

do $$ begin
  alter table notifications add constraint notifications_severity_check
    check (severity in ('info', 'success', 'warning', 'critical'));
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- RLS for the new tables
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
  tenant_tables text[] := array['usage_counters', 'coalition_redemptions', 'subscription_events'];
begin
  foreach t in array tenant_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "tenant read" on %I', t);
    execute format('drop policy if exists "tenant write" on %I', t);
    execute format(
      'create policy "tenant read" on %I for select using (fidelio_has_business_access(business_id))', t
    );
  end loop;
end $$;

-- Billing records are written by the service role only; a merchant reading
-- their own usage is fine, a merchant writing it is not.
drop policy if exists "tenant read" on subscription_events;
create policy "billing read" on subscription_events
  for select using (fidelio_has_business_role(business_id, array['owner', 'admin']));

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- Membership renewal reminder
--
-- Routed through the automation engine like every other lifecycle message, so
-- a merchant can edit, pause or re-time it. A surprise charge is the single
-- largest driver of membership chargebacks, and a chargeback costs the merchant
-- the fee *and* the customer.
-- -----------------------------------------------------------------------------

insert into message_templates (business_id, key, name, channel, subject, body, locale, variables)
values
  (null, 'membership_renewal', 'Membership renewal', 'email',
   'Your {{plan_name}} renews on {{renewal_date}}',
   'Hi {{customer_first_name}}, your {{plan_name}} at {{business_name}} renews on {{renewal_date}} for {{renewal_amount}}. Nothing to do — we just did not want it to be a surprise.',
   'en', array['business_name','customer_first_name','plan_name','renewal_date','renewal_amount']),
  (null, 'membership_renewal', 'Renovación de membresía', 'email',
   'Tu {{plan_name}} se renueva el {{renewal_date}}',
   'Hola {{customer_first_name}}, tu {{plan_name}} en {{business_name}} se renueva el {{renewal_date}} por {{renewal_amount}}. No tienes que hacer nada — solo queríamos avisarte.',
   'es', array['business_name','customer_first_name','plan_name','renewal_date','renewal_amount'])
on conflict do nothing;

-- Add the automation to every existing business, and to the provisioning
-- function so new workspaces get it too.
insert into automations (
  business_id, name, description, is_active, trigger, trigger_config,
  delay_minutes, cooldown_days, actions
)
select b.id,
       'Membership renewal reminder',
       'Tells members three days before they are charged, so a renewal is never a surprise',
       true, 'membership_renewal', '{}'::jsonb, 0, 20,
       '[{"type":"send_message","channel":"auto","template":"membership_renewal"}]'::jsonb
from businesses b
where not exists (
  select 1 from automations a
   where a.business_id = b.id and a.trigger = 'membership_renewal'
);

-- -----------------------------------------------------------------------------
-- Automation context
--
-- Some triggers carry facts the template needs and the customer record does not
-- hold: which plan is renewing, on what date, for how much. Storing it on the
-- run means the value is the one that was true at enrolment, not whatever it
-- has become by the time the delayed action fires.
-- -----------------------------------------------------------------------------

alter table automation_runs add column if not exists context jsonb not null default '{}'::jsonb;

create or replace function fidelio_enroll_automation(
  p_business_id uuid,
  p_automation_id uuid,
  p_customer_id uuid,
  p_scheduled_for timestamptz,
  p_event_id uuid default null,
  p_context jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_automation automations;
  v_run_id uuid;
begin
  select * into v_automation from automations where id = p_automation_id and is_active;
  if not found then return null; end if;

  -- Respect the cooldown: never re-enrol someone we contacted recently.
  if exists (
    select 1 from automation_runs
     where automation_id = p_automation_id
       and customer_id = p_customer_id
       and status in ('scheduled', 'running', 'completed')
       and created_at > now() - make_interval(days => v_automation.cooldown_days)
  ) then
    return null;
  end if;

  insert into automation_runs (
    business_id, automation_id, customer_id, scheduled_for, trigger_event_id, context
  ) values (
    p_business_id, p_automation_id, p_customer_id, p_scheduled_for, p_event_id,
    coalesce(p_context, '{}'::jsonb)
  )
  returning id into v_run_id;

  update automations set enrolled_count = enrolled_count + 1 where id = p_automation_id;

  return v_run_id;
end;
$$;

