-- =============================================================================
-- 013 — Analytics
--
-- Do the numbers on the dashboard come from the data, and do they move?
--
-- The failure this file is written to catch is a metric that is *stable* — a
-- retention rate that reads 56.8% on a database with four rows and on one with
-- four million, because it is computed from a constant somewhere. Every check
-- here recomputes the figure independently and compares.
-- =============================================================================

\pset pager off

\echo
\echo '=== The overview function, per workspace ======================================'
-- Exactly what `GET /api/v1/analytics/overview` returns. If this errors, the
-- analytics screen is a spinner.

select
  b.name as business,
  b.plan,
  jsonb_pretty(passimo_analytics_overview(b.id, 30)) as overview_30d
from businesses b
where b.archived_at is null
order by b.plan
limit 2;

\echo
\echo '=== Headline figures side by side =============================================='

select
  b.name as business,
  b.plan,
  (o -> 'customers' ->> 'total')::int as customers,
  (o -> 'customers' ->> 'active')::int as active,
  (o -> 'customers' ->> 'lapsed')::int as lapsed,
  (o -> 'customers' ->> 'new')::int as new_in_period,
  (o -> 'customers' ->> 'vip')::int as vip,
  (o -> 'customers' ->> 'retention_rate')::numeric as retention_pct,
  (o -> 'customers' ->> 'churn_rate')::numeric as churn_pct,
  (o -> 'customers' ->> 'repeat_rate')::numeric as repeat_pct,
  (o -> 'revenue' ->> 'period')::numeric as revenue_period,
  (o -> 'revenue' ->> 'lifetime')::numeric as revenue_lifetime,
  (o -> 'revenue' ->> 'average_ticket')::numeric as avg_ticket,
  (o -> 'revenue' ->> 'average_clv')::numeric as avg_clv,
  (o -> 'engagement' ->> 'visits')::int as visits,
  (o -> 'engagement' ->> 'redemptions')::int as redemptions,
  (o -> 'engagement' ->> 'balance_outstanding')::numeric as outstanding
from businesses b
join lateral (select passimo_analytics_overview(b.id, 30) as o) a on true
where b.archived_at is null
order by b.plan;

\echo
\echo '=== Analytics must agree with the tables ======================================='
-- The independent recount. A mismatch means the function and the data have
-- diverged, and the dashboard is showing something no query can reproduce.

select
  case
    when count(*) filter (where fn_customers <> real_customers) = 0
     and count(*) filter (where fn_redemptions <> real_redemptions) = 0
      then 'PASS' else 'FAIL'
  end as status,
  count(*) as workspaces_checked,
  count(*) filter (where fn_customers <> real_customers) as customer_count_mismatches,
  count(*) filter (where fn_redemptions <> real_redemptions) as redemption_count_mismatches
from (
  select
    b.id,
    ((select passimo_analytics_overview(b.id, 30)) -> 'customers' ->> 'total')::int as fn_customers,
    (select count(*) from customers c where c.business_id = b.id and c.anonymized_at is null)::int as real_customers,
    ((select passimo_analytics_overview(b.id, 30)) -> 'engagement' ->> 'redemptions')::int as fn_redemptions,
    (select count(*) from reward_redemptions rr
      where rr.business_id = b.id and rr.created_at > now() - interval '30 days')::int as real_redemptions
  from businesses b
  where b.archived_at is null
) checks;

\echo '--- Where they disagree ---'
select
  b.name as business,
  ((select passimo_analytics_overview(b.id, 30)) -> 'customers' ->> 'total')::int as fn_customers,
  (select count(*) from customers c where c.business_id = b.id and c.anonymized_at is null) as real_customers,
  ((select passimo_analytics_overview(b.id, 30)) -> 'engagement' ->> 'redemptions')::int as fn_redemptions,
  (select count(*) from reward_redemptions rr where rr.business_id = b.id and rr.created_at > now() - interval '30 days') as real_redemptions
from businesses b
where b.archived_at is null
  and (
    ((select passimo_analytics_overview(b.id, 30)) -> 'customers' ->> 'total')::int
      <> (select count(*) from customers c where c.business_id = b.id and c.anonymized_at is null)
    or ((select passimo_analytics_overview(b.id, 30)) -> 'engagement' ->> 'redemptions')::int
      <> (select count(*) from reward_redemptions rr where rr.business_id = b.id and rr.created_at > now() - interval '30 days')
  );

\echo
\echo '=== Revenue must equal the sum of purchase events =============================='

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as workspaces_whose_period_revenue_does_not_match_their_events
from (
  select
    b.id,
    ((select passimo_analytics_overview(b.id, 30)) -> 'revenue' ->> 'period')::numeric as fn_revenue,
    coalesce((
      select sum(e.amount) from activity_events e
      where e.business_id = b.id and e.type = 'purchase' and e.occurred_at > now() - interval '30 days'
    ), 0) as real_revenue
  from businesses b
  where b.archived_at is null
) checks
where abs(fn_revenue - real_revenue) > 0.05;

\echo
\echo '=== Metrics that are suspiciously identical across workspaces =================='
-- Four businesses of wildly different sizes reporting the same retention rate to
-- one decimal place is not a coincidence; it is a constant.

select
  case when count(distinct retention) > 1 or count(*) <= 1 then 'PASS' else 'FAIL' end as status,
  count(*) as workspaces,
  count(distinct retention) as distinct_retention_rates,
  count(distinct churn) as distinct_churn_rates,
  count(distinct avg_ticket) as distinct_average_tickets
from (
  select
    ((select passimo_analytics_overview(b.id, 30)) -> 'customers' ->> 'retention_rate')::numeric as retention,
    ((select passimo_analytics_overview(b.id, 30)) -> 'customers' ->> 'churn_rate')::numeric as churn,
    ((select passimo_analytics_overview(b.id, 30)) -> 'revenue' ->> 'average_ticket')::numeric as avg_ticket
  from businesses b
  where b.archived_at is null
) m;

\echo
\echo '=== The daily series has to be dense =========================================='
-- The chart plots one point per day. A sparse series draws a line that skips
-- quiet days, which makes every quiet week look like an outage.

select
  b.name as business,
  jsonb_array_length((select passimo_analytics_overview(b.id, 30)) -> 'daily') as daily_points,
  case
    when jsonb_array_length((select passimo_analytics_overview(b.id, 30)) -> 'daily') between 28 and 32 then 'PASS'
    else 'WARNING'
  end as status
from businesses b
where b.archived_at is null
order by b.name;

\echo
\echo '=== Cohort retention =========================================================='
-- The function behind the retention grid. Six monthly cohorts; an empty result
-- means the grid renders as an empty state on a database with a year of history.

select
  b.name as business,
  jsonb_array_length(coalesce(to_jsonb(passimo_cohort_retention(b.id, 6)), '[]'::jsonb)) as cohort_rows
from businesses b
where b.archived_at is null
order by b.name;

\echo
\echo '=== Growth series ============================================================='

select
  b.name as business,
  month,
  (entry ->> 'visits')::int as visits,
  (entry ->> 'revenue')::numeric as revenue,
  (entry ->> 'customers')::int as customers
from businesses b
join lateral (
  select entry, entry ->> 'month' as month
  from jsonb_array_elements((select passimo_analytics_overview(b.id, 30)) -> 'growth') as entry
) g on true
where b.archived_at is null and b.plan = 'business'
order by month;

\echo
\echo '=== Top rewards and top customers ============================================='

select
  b.name as business,
  (entry ->> 'name') as reward,
  (entry ->> 'redemptions')::int as redemptions
from businesses b
join lateral (
  select entry from jsonb_array_elements((select passimo_analytics_overview(b.id, 90)) -> 'top_rewards') as entry
) t on true
where b.archived_at is null
order by b.name, redemptions desc nulls last;

\echo
\echo '=== Proximity analytics ======================================================='

-- Takes a window rather than a day count, and returns a row rather than jsonb,
-- unlike the other two analytics functions.
select b.name as business, p.*
from businesses b
join lateral passimo_proximity_analytics(b.id, now() - interval '30 days', now()) p on true
where b.archived_at is null and b.plan in ('pro', 'business')
order by b.name;

\echo
\echo '=== Platform-wide overview ===================================================='
-- What the admin console reads. `mrr_cents` here counts `subscription_status in
-- ('active','trialing')`, which includes trials — the TypeScript layer recomputes
-- MRR itself and excludes them, so this column is informational only.

select * from passimo_platform_overview();

\echo
\echo '=== Nightly rollups actually ran =============================================='
-- `stats_updated_at` is stamped by `passimo_recompute_customer_stats`. All null
-- means the cron has never run, and every derived metric is whatever the seed or
-- the last scan left behind.

select
  b.name as business,
  count(*) as customers,
  count(*) filter (where c.stats_updated_at is not null) as stats_computed,
  max(c.stats_updated_at) as most_recent_recompute,
  case
    when count(*) filter (where c.stats_updated_at is null) = 0 then 'PASS'
    when count(*) filter (where c.stats_updated_at is not null) = 0 then 'FAIL'
    else 'WARNING'
  end as status
from customers c
join businesses b on b.id = c.business_id
where c.anonymized_at is null
group by b.name
order by status desc, b.name;

\echo
\echo '=== Job queue health =========================================================='
-- Analytics, wallet pushes and campaign sends all run through this queue. A
-- backlog here is a dashboard that is quietly out of date.

select
  status,
  count(*) as jobs,
  min(created_at) as oldest,
  max(created_at) as newest
from jobs
group by status
order by count(*) desc;

select
  case
    when count(*) filter (where status = 'failed') > 0 then 'WARNING'
    when count(*) filter (where status = 'pending' and created_at < now() - interval '1 hour') > 0 then 'WARNING'
    else 'PASS'
  end as status,
  count(*) filter (where status = 'failed') as failed,
  count(*) filter (where status = 'pending' and created_at < now() - interval '1 hour') as pending_over_an_hour
from jobs;
