-- =============================================================================
-- 005 — Loyalty programs, earning rules and tiers
--
-- Is each workspace's loyalty engine configured coherently? A program can be
-- syntactically valid and still be unable to reward anybody — a goal with no
-- reward that reaches it, a rule whose window has closed, a cashback percentage
-- on a stamp card.
-- =============================================================================

\pset pager off

\echo
\echo '=== Every program ============================================================='

select
  b.name as business,
  b.plan,
  p.name as program,
  p.type,
  p.is_default as is_def,
  p.is_active as active,
  p.goal_amount as goal,
  p.unit_singular || '/' || p.unit_plural as unit,
  p.reward_description as goal_reward,
  p.point_value,
  p.cashback_percent as cashback_pct,
  p.expiry_months as expiry_mo,
  p.earn_cooldown_minutes as cooldown_min,
  p.max_earn_per_day,
  p.reset_on_reward as resets,
  p.tier_enabled as tiers,
  p.tier_metric,
  (select count(*) from earning_rules r where r.program_id = p.id and r.is_active) as active_rules,
  (select count(*) from rewards rw where rw.program_id = p.id and rw.is_active) as active_rewards,
  (select count(*) from loyalty_accounts a where a.program_id = p.id) as accounts
from loyalty_programs p
join businesses b on b.id = p.business_id
order by b.name, p.is_default desc, p.name;

\echo
\echo '=== Programs that cannot reward anybody ======================================='
-- Each of these is a program a customer can earn into and never get anything out
-- of, which is the one failure a loyalty product must not have.

select
  case
    when not p.is_active then 'PASS'
    when p.goal_amount is null and reachable_rewards = 0 then 'FAIL'
    when reachable_rewards = 0 then 'FAIL'
    when p.goal_amount is not null and cheapest_reward > p.goal_amount then 'WARNING'
    else 'PASS'
  end as status,
  b.name as business,
  p.name as program,
  p.type,
  p.goal_amount as goal,
  reachable_rewards,
  cheapest_reward,
  case
    when not p.is_active then 'inactive — skipped'
    when reachable_rewards = 0 then 'no active reward attached: earning leads nowhere'
    when p.goal_amount is not null and cheapest_reward > p.goal_amount
      then 'cheapest reward (' || cheapest_reward || ') costs more than the advertised goal (' || p.goal_amount || ')'
    else 'ok'
  end as finding
from loyalty_programs p
join businesses b on b.id = p.business_id
join lateral (
  select
    count(*) as reachable_rewards,
    min(cost) as cheapest_reward
  from rewards rw
  where rw.program_id = p.id
    and rw.is_active
    and rw.auto_grant_trigger is null
    and (rw.stock is null or rw.stock > 0)
    and (rw.ends_at is null or rw.ends_at > now())
) r on true
order by status desc, b.name;

\echo
\echo '=== Program configuration that contradicts its type ==========================='
-- A stamp card with a cashback percentage, or a points program with no point
-- value, is a configuration the UI can produce and the engine will ignore.

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as contradictions
from loyalty_programs p
where p.is_active
  and (
    (p.type = 'stamps' and p.cashback_percent is not null and p.cashback_percent > 0)
    or (p.type = 'cashback' and (p.cashback_percent is null or p.cashback_percent = 0))
    or (p.type = 'points' and p.goal_amount is not null and p.goal_amount <= 1)
    or (p.goal_amount is not null and p.goal_amount <= 0)
  );

select b.name as business, p.name as program, p.type, p.goal_amount, p.cashback_percent, p.point_value
from loyalty_programs p
join businesses b on b.id = p.business_id
where p.is_active
  and (
    (p.type = 'stamps' and p.cashback_percent is not null and p.cashback_percent > 0)
    or (p.type = 'cashback' and (p.cashback_percent is null or p.cashback_percent = 0))
    or (p.type = 'points' and p.goal_amount is not null and p.goal_amount <= 1)
    or (p.goal_amount is not null and p.goal_amount <= 0)
  );

\echo
\echo '=== Earning rules ============================================================='

select
  b.name as business,
  r.name as rule,
  r.trigger,
  r.award_type,
  r.award_amount as award,
  r.per_amount,
  r.min_purchase as min_spend,
  r.priority,
  r.stackable,
  r.is_active as active,
  r.cooldown_minutes as cooldown,
  r.usage_limit_per_customer as per_customer_limit,
  r.total_usage_limit,
  r.usage_count as used,
  r.starts_at::date as starts,
  r.ends_at::date as ends,
  r.days_of_week,
  r.time_from,
  r.time_to
from earning_rules r
join businesses b on b.id = r.business_id
order by b.name, r.priority, r.name;

\echo
\echo '=== Rules that can never fire ================================================='
-- Live rules that will award nothing: the window has closed, the total cap is
-- reached, or the time range is inverted.

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as dead_rules
from earning_rules r
where r.is_active
  and (
    (r.ends_at is not null and r.ends_at < now())
    or (r.total_usage_limit is not null and r.usage_count >= r.total_usage_limit)
    or (r.time_from is not null and r.time_to is not null and r.time_from >= r.time_to)
    or (r.days_of_week is not null and cardinality(r.days_of_week) = 0)
    or r.award_amount <= 0
  );

select
  b.name as business, r.name as rule, r.trigger,
  case
    when r.ends_at < now() then 'window closed on ' || r.ends_at::date
    when r.total_usage_limit is not null and r.usage_count >= r.total_usage_limit
      then 'total cap reached (' || r.usage_count || '/' || r.total_usage_limit || ')'
    when r.time_from >= r.time_to then 'inverted time window ' || r.time_from || '–' || r.time_to
    when r.days_of_week is not null and cardinality(r.days_of_week) = 0 then 'empty weekday list'
    when r.award_amount <= 0 then 'awards ' || r.award_amount
  end as finding
from earning_rules r
join businesses b on b.id = r.business_id
where r.is_active
  and (
    (r.ends_at is not null and r.ends_at < now())
    or (r.total_usage_limit is not null and r.usage_count >= r.total_usage_limit)
    or (r.time_from is not null and r.time_to is not null and r.time_from >= r.time_to)
    or (r.days_of_week is not null and cardinality(r.days_of_week) = 0)
    or r.award_amount <= 0
  )
order by b.name;

\echo
\echo '=== Every trigger has a rule =================================================='
-- Which earn triggers are actually wired up per workspace. A workspace with only
-- a `visit` rule cannot reward spend, referral or birthday, and the merchant has
-- no way to know that from the dashboard.

select
  b.name as business,
  string_agg(distinct r.trigger, ', ' order by r.trigger) as triggers_with_active_rules
from businesses b
left join earning_rules r on r.business_id = b.id and r.is_active
where b.archived_at is null
group by b.name
order by b.name;

\echo
\echo '=== Tiers ====================================================================='

select
  b.name as business,
  p.name as program,
  t.*
from program_tiers t
join loyalty_programs p on p.id = t.program_id
join businesses b on b.id = t.business_id
order by b.name, t.business_id;

\echo
\echo '=== Tier configuration ========================================================'
-- A program with tiers enabled and no tier rows shows a tier badge nobody can
-- ever earn.

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as programs_with_tiers_but_no_tier_rows
from loyalty_programs p
where p.tier_enabled
  and p.is_active
  and not exists (select 1 from program_tiers t where t.program_id = p.id);
