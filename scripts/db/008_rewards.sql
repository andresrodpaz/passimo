-- =============================================================================
-- 008 — Reward catalogue
--
-- Is the catalogue reachable, priced, in stock and in date? A reward a customer
-- can see but never claim is worse than no reward, because it is a promise the
-- merchant did not know they were breaking.
-- =============================================================================

\pset pager off

\echo
\echo '=== Every reward =============================================================='

select
  b.name as business,
  b.plan,
  r.name as reward,
  r.cost,
  p.goal_amount as program_goal,
  r.type,
  r.is_active as active,
  r.auto_grant_trigger as auto_grant,
  r.stock,
  r.redeemed_count as redeemed,
  r.usage_limit_per_customer as per_customer,
  r.min_tier_level as min_tier,
  r.valid_days,
  r.starts_at::date as starts,
  r.ends_at::date as ends,
  r.sort_order
from rewards r
join businesses b on b.id = r.business_id
left join loyalty_programs p on p.id = r.program_id
order by b.name, r.sort_order, r.cost;

\echo
\echo '=== Rewards nobody can claim =================================================='
-- Live rewards that will refuse every redemption attempt. Each one is a paywall
-- the merchant did not build on purpose.

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as unclaimable_active_rewards
from rewards r
where r.is_active
  and r.auto_grant_trigger is null
  and (
    r.stock = 0
    or (r.ends_at is not null and r.ends_at < now())
    or (r.starts_at is not null and r.starts_at > now() + interval '365 days')
    or r.cost <= 0
  );

select
  b.name as business, r.name as reward, r.cost, r.stock, r.starts_at::date, r.ends_at::date,
  case
    when r.stock = 0 then 'out of stock'
    when r.ends_at < now() then 'expired on ' || r.ends_at::date
    when r.starts_at > now() + interval '365 days' then 'does not start until ' || r.starts_at::date
    when r.cost <= 0 then 'costs ' || r.cost || ' — claimable by anyone, unlimited'
  end as finding
from rewards r
join businesses b on b.id = r.business_id
where r.is_active
  and r.auto_grant_trigger is null
  and (
    r.stock = 0
    or (r.ends_at is not null and r.ends_at < now())
    or (r.starts_at is not null and r.starts_at > now() + interval '365 days')
    or r.cost <= 0
  )
order by b.name;

\echo
\echo '=== Reward cost against what customers can actually reach ====================='
-- A reward priced above the highest balance any member has ever held is a reward
-- the merchant is advertising into a void. Not a bug — a pricing decision they
-- should be shown.

select
  b.name as business,
  r.name as reward,
  r.cost,
  stats.max_balance as highest_balance_held,
  stats.customers_who_can_afford_it,
  case
    when stats.customers_who_can_afford_it = 0 and r.redeemed_count = 0 then 'WARNING'
    else 'PASS'
  end as status
from rewards r
join businesses b on b.id = r.business_id
join lateral (
  select
    coalesce(max(a.balance), 0) as max_balance,
    count(*) filter (where a.balance >= r.cost) as customers_who_can_afford_it
  from loyalty_accounts a
  where a.business_id = r.business_id
    and (r.program_id is null or a.program_id = r.program_id)
) stats on true
where r.is_active and r.auto_grant_trigger is null and r.cost > 0
order by status desc, b.name, r.cost;

\echo
\echo '=== Auto-granted rewards ======================================================'
-- Welcome, birthday and win-back gifts. These are what the automations hand out,
-- so a workspace missing one has an automation that fires and grants nothing.

select
  b.name as business,
  string_agg(r.auto_grant_trigger, ', ' order by r.auto_grant_trigger) as triggers_with_a_reward
from businesses b
left join rewards r
  on r.business_id = b.id and r.auto_grant_trigger is not null and r.is_active
where b.archived_at is null
group by b.name
order by b.name;

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as automations_whose_granted_reward_does_not_exist
from automations a
join businesses b on b.id = a.business_id
where a.is_active
  and exists (
    select 1
    from jsonb_array_elements(a.actions) as action
    where action ->> 'type' = 'grant_reward'
      and not exists (
        select 1 from rewards r
        where r.business_id = a.business_id
          and r.is_active
          and r.auto_grant_trigger = action ->> 'trigger'
      )
  );

\echo
\echo '=== Duplicate rewards within a workspace ======================================'
-- Two live rewards with the same name is a merchant editing a copy instead of the
-- original; the customer sees the same thing twice at two prices.

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as duplicated_reward_names
from (
  select business_id, lower(name)
  from rewards
  where is_active
  group by business_id, lower(name)
  having count(*) > 1
) d;

select b.name as business, lower(r.name) as reward, count(*) as copies, string_agg(r.cost::text, ', ') as costs
from rewards r
join businesses b on b.id = r.business_id
where r.is_active
group by b.name, lower(r.name)
having count(*) > 1
order by b.name;

\echo
\echo '=== redeemed_count against the redemption table ================================'
-- A denormalised counter. The Rewards screen renders "never claimed" from it, so
-- drift shows the merchant the opposite of the truth.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as rewards_with_a_stale_redeemed_count
from rewards r
where r.redeemed_count <> (
  select count(*) from reward_redemptions rr where rr.reward_id = r.id
);

select
  b.name as business, r.name as reward, r.redeemed_count as counter,
  (select count(*) from reward_redemptions rr where rr.reward_id = r.id) as actual
from rewards r
join businesses b on b.id = r.business_id
where r.redeemed_count <> (select count(*) from reward_redemptions rr where rr.reward_id = r.id)
order by b.name
limit 20;

\echo
\echo '=== Rewards attached to a program in another workspace ========================'
-- A cross-tenant foreign key. Should be structurally impossible; if it is not,
-- it is the most serious kind of finding in this file.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as cross_tenant_reward_program_links
from rewards r
join loyalty_programs p on p.id = r.program_id
where p.business_id <> r.business_id;

\echo
\echo '=== Reward performance ========================================================'

select
  b.name as business,
  r.name as reward,
  r.cost,
  r.redeemed_count as claims,
  round(
    100.0 * r.redeemed_count / greatest((select sum(x.redeemed_count) from rewards x where x.business_id = b.id), 1),
    1
  ) as share_of_claims_pct,
  (select max(rr.created_at)::date from reward_redemptions rr where rr.reward_id = r.id) as last_claimed
from rewards r
join businesses b on b.id = r.business_id
where r.is_active
order by b.name, r.redeemed_count desc;
