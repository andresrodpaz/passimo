-- =============================================================================
-- 004 — Subscriptions, plans and usage
--
-- What each workspace is being billed for, whether the stored plan is one the
-- application recognises, and whether anybody is over a limit their plan does
-- not allow.
--
-- The plan catalogue itself lives in `lib/billing/plans.ts`, not in the database:
-- plan shape is product strategy, identical for every tenant, and changes with a
-- deploy. So these queries assert the *column* against what the catalogue says,
-- and the catalogue values are inlined below. If they ever diverge, the inline
-- copy is the thing that is wrong.
--
-- Mirrors pricing v2: three purchasable tiers at $29 / $59 / $99, plus the two
-- lifecycle states. `business` is gone — migration 000024 folded it into `pro`,
-- which sits at the same $99 it used to.
-- =============================================================================

\pset pager off

\echo
\echo '=== The catalogue, as the application defines it =============================='
-- Mirrored from lib/billing/plans.ts. There is no free tier and the entry price
-- is $29; a row here with a price under 29 (other than the internal `lapsed`
-- state, which is not for sale) is a contradiction.

with catalogue(plan, monthly_usd, annual_usd, customers, locations, team_members, purchasable) as (
  values
    ('lapsed',   null::int, null::int, 0,     1,   1,    false),
    ('starter',  29,        290,       500,   1,   3,    true),
    ('growth',   59,        590,       5000,  3,   10,   true),
    ('pro',      99,        990,       20000, 10,  25,   true)
)
select
  case
    when not purchasable then 'PASS'
    when monthly_usd is null then 'FAIL'
    when monthly_usd < 29 then 'FAIL'
    -- Ten months for a year, on every tier. A different ratio on one of them
    -- would make the "two months free" badge a per-plan promotion.
    when annual_usd <> monthly_usd * 10 then 'FAIL'
    else 'PASS'
  end as status,
  plan,
  monthly_usd,
  annual_usd,
  case when annual_usd is not null and monthly_usd is not null
    then monthly_usd * 12 - annual_usd else null end as annual_saving,
  coalesce(customers::text, 'unlimited') as customers,
  coalesce(locations::text, 'unlimited') as locations,
  coalesce(team_members::text, 'unlimited') as team_members,
  purchasable
from catalogue
order by coalesce(monthly_usd, -1);

\echo
\echo '=== Stored plan values the application recognises ============================='
-- `businesses.plan` may hold `trial` (a lifecycle state, not a tier) plus the
-- three purchasable tiers and `lapsed`. Anything else is gated as lapsed by
-- `resolveEntitlements`, which silently downgrades a paying customer.

select
  case
    when count(*) filter (where plan not in ('trial','lapsed','starter','growth','pro')) = 0
      then 'PASS' else 'FAIL'
  end as status,
  count(*) as workspaces,
  coalesce(
    string_agg(distinct plan, ', ') filter (
      where plan not in ('trial','lapsed','starter','growth','pro')
    ),
    'none'
  ) as unrecognised_plans
from businesses;

\echo
\echo '=== No free tier in the data =================================================='
-- Migration 15 rewrote `free` and `enterprise`; migration 24 rewrote `business`.
-- A row holding any of the three means one of those migrations did not reach this
-- database, and the application is resolving it through the code alias instead.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as legacy_plan_rows,
  coalesce(string_agg(distinct plan, ', '), 'none') as values
from businesses
where plan in ('free', 'enterprise', 'business', 'basic', 'premium');

\echo
\echo '=== Every workspace''s billing state ==========================================='

select
  b.name,
  b.plan as stored_plan,
  /*
   * What the application will actually gate on. `resolveEntitlements` treats a
   * live trial as Growth and a `trial` row past its end date as lapsed, so the
   * stored value alone is not the answer — and reading it as one is what made
   * the admin console label every trial "Inactive".
   */
  case
    when b.plan = 'trial' and b.trial_ends_at > now() then 'growth (trial)'
    when b.plan = 'trial' then 'lapsed (trial expired)'
    else b.plan
  end as effective_plan,
  b.plan_interval as interval,
  b.subscription_status,
  b.cancel_at_period_end as cancelling,
  b.subscription_current_period_end::date as period_end,
  b.trial_ends_at::date as trial_ends,
  case
    when b.trial_ends_at is null then null
    else greatest(0, extract(day from b.trial_ends_at - now())::int)
  end as trial_days_left,
  (b.stripe_customer_id is not null) as has_stripe_customer,
  (b.stripe_subscription_id is not null) as has_stripe_subscription,
  b.referral_credit
from businesses b
order by b.name;

\echo
\echo '=== Billing states that contradict themselves ================================='

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as contradictions
from businesses b
where
  -- Being billed for a tier with no Stripe subscription behind it. Expected on a
  -- demo or self-hosted deployment; a finding on production.
  (b.plan in ('starter','growth','pro')
     and b.subscription_status = 'active'
     and b.stripe_subscription_id is null)
  -- A trial with no end date never ends.
  or (b.plan = 'trial' and b.trial_ends_at is null)
  -- Cancelling with nothing to cancel.
  or (b.cancel_at_period_end and b.stripe_subscription_id is null)
  -- Delinquent but still on a paid tier past the grace window.
  or (b.subscription_status in ('past_due','unpaid')
      and b.subscription_current_period_end < now() - interval '30 days');

\echo '--- Which, and how ---'
select
  b.name, b.plan, b.subscription_status,
  case
    when b.plan in ('starter','growth','pro')
      and b.subscription_status = 'active'
      and b.stripe_subscription_id is null
      then 'paid tier, active status, no Stripe subscription (normal for demo/self-host)'
    when b.plan = 'trial' and b.trial_ends_at is null then 'trial with no end date — never expires'
    when b.cancel_at_period_end and b.stripe_subscription_id is null then 'cancel_at_period_end with no subscription'
    else 'delinquent past the grace window: ' || b.subscription_current_period_end::date
  end as finding
from businesses b
where (b.plan in ('starter','growth','pro') and b.subscription_status = 'active' and b.stripe_subscription_id is null)
   or (b.plan = 'trial' and b.trial_ends_at is null)
   or (b.cancel_at_period_end and b.stripe_subscription_id is null)
   or (b.subscription_status in ('past_due','unpaid') and b.subscription_current_period_end < now() - interval '30 days')
order by b.name;

\echo
\echo '=== Live usage against the plan''s limits ======================================'
-- The same three countable limits the API enforces, measured the same way:
-- against live rows, not a counter that can drift.

with limits(plan, customers, locations, team_members) as (
  values
    ('lapsed',   0::int,    1::int,    1::int),
    ('starter',  500,       1,         3),
    ('growth',   5000,      3,         10),
    ('pro',      20000,     10,        25),
    -- A live trial is entitled to Growth, not to the top tier. Trials run on the
    -- plan we most want merchants to buy, and giving them Pro made the day-15
    -- decision a comparison of three products rather than a yes.
    ('trial',    5000,      3,         10)
)
select
  case
    /*
     * `lapsed` is over its limits by definition, and that is the state working
     * correctly rather than a finding. Its caps are 0 because they are what
     * refuses a *write*: reads are never gated, an existing customer standing at
     * the counter always gets their stamp, and nothing is deleted. Reporting
     * "60 / 0" as a failure would make the reactivation wall look broken every
     * time it worked.
     */
    when b.plan = 'lapsed' then 'PASS'
    when l.customers is not null and u.customers > l.customers then 'FAIL'
    when l.locations is not null and u.locations > l.locations then 'FAIL'
    when l.team_members is not null and u.team_members > l.team_members then 'FAIL'
    when l.customers is not null and u.customers > l.customers * 0.8 then 'WARNING'
    else 'PASS'
  end as status,
  b.name,
  b.plan,
  u.customers || ' / ' || coalesce(l.customers::text, '∞') as customers,
  u.locations || ' / ' || coalesce(l.locations::text, '∞') as locations,
  u.team_members || ' / ' || coalesce(l.team_members::text, '∞') as team_members
from businesses b
join limits l on l.plan = b.plan
join lateral (
  select
    (select count(*) from customers c where c.business_id = b.id and c.anonymized_at is null) as customers,
    (select count(*) from locations lo where lo.business_id = b.id and lo.archived_at is null) as locations,
    (select count(*) from team_members t where t.business_id = b.id and t.status = 'active') as team_members
) u on true
where b.archived_at is null
order by status desc, b.name;

\echo
\echo '=== Metered usage counters ====================================================='
-- Messages, AI actions and campaigns, reset per calendar month.

select
  b.name,
  uc.period,
  uc.metric,
  uc.used,
  uc.updated_at
from usage_counters uc
join businesses b on b.id = uc.business_id
where uc.period >= to_char(now() - interval '2 months', 'YYYY-MM')
order by uc.period desc, b.name, uc.metric;

\echo
\echo '=== Usage counters with no workspace =========================================='

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as orphan_counters
from usage_counters uc
where not exists (select 1 from businesses b where b.id = uc.business_id);

\echo
\echo '=== Subscription webhook events ==============================================='
-- Stripe delivers at-least-once, so the idempotency key matters. An event with
-- an `error` and no `processed_at` is money that changed hands without the plan
-- changing to match.

select
  case
    when count(*) filter (where error is not null and processed_at is null) = 0 then 'PASS'
    else 'FAIL'
  end as status,
  count(*) as events,
  count(*) filter (where processed_at is not null) as processed,
  count(*) filter (where error is not null) as errored,
  count(*) filter (where error is not null and processed_at is null) as failed_and_unprocessed
from subscription_events;

select
  b.name, se.provider, se.type, se.processed_at, left(se.error, 120) as error
from subscription_events se
left join businesses b on b.id = se.business_id
order by se.created_at desc
limit 20;

\echo
\echo '=== Duplicate webhook deliveries =============================================='
-- Two rows for one `provider_event_id` means the idempotency guard did not hold,
-- which for `invoice.paid` is a double credit.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as duplicated_events
from (
  select provider, provider_event_id
  from subscription_events
  where provider_event_id is not null
  group by provider, provider_event_id
  having count(*) > 1
) d;

\echo
\echo '=== Dunning state ============================================================='

select
  b.name, d.*
from billing_dunning d
join businesses b on b.id = d.business_id
order by b.name;
