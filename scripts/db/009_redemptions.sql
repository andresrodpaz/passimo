-- =============================================================================
-- 009 — Redemptions
--
-- Did the customer actually get the thing, was the balance debited for it, and
-- can it happen twice? `reward_redemptions` and `loyalty_ledger` are two records
-- of one event, and the interesting failures are the ones where they disagree.
-- =============================================================================

\pset pager off

\echo
\echo '=== Redemption volume ========================================================='

select
  b.name as business,
  b.plan,
  count(*) as redemptions,
  count(*) filter (where rr.status = 'fulfilled') as fulfilled,
  count(*) filter (where rr.status = 'claimed') as claimed_not_yet_handed_over,
  count(*) filter (where rr.status = 'expired') as expired,
  count(*) filter (where rr.status = 'cancelled') as cancelled,
  count(distinct rr.customer_id) as distinct_customers,
  round(sum(rr.cost), 2) as balance_spent,
  min(rr.created_at)::date as first,
  max(rr.created_at)::date as last
from reward_redemptions rr
join businesses b on b.id = rr.business_id
group by b.name, b.plan
order by b.plan;

\echo
\echo '=== Every redemption points at a ledger entry ================================='
-- The ledger is where the balance moved. A redemption with no ledger entry is a
-- reward handed over for free; a `claimed` one legitimately has none yet.

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as fulfilled_redemptions_with_no_ledger_entry
from reward_redemptions rr
where rr.status = 'fulfilled'
  and rr.ledger_entry_id is null
  -- A zero-cost reward (a granted birthday gift) debits nothing, so it has no
  -- ledger entry by design.
  and rr.cost > 0;

\echo
\echo '=== The ledger debit matches the redemption cost =============================='

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as redemptions_whose_debit_does_not_match_their_cost
from reward_redemptions rr
join loyalty_ledger l on l.id = rr.ledger_entry_id
where abs(abs(l.amount) - rr.cost) > 0.001;

select
  b.name as business, c.email, rr.cost as redemption_cost, l.amount as ledger_amount
from reward_redemptions rr
join loyalty_ledger l on l.id = rr.ledger_entry_id
join businesses b on b.id = rr.business_id
join customers c on c.id = rr.customer_id
where abs(abs(l.amount) - rr.cost) > 0.001
limit 15;

\echo
\echo '=== Every redeem ledger entry has a redemption record ========================='
-- The other direction. A `redeem` entry with no `reward_redemptions` row means
-- the balance went down and no screen can say what for — which is exactly how the
-- demo ended up reporting "6,200 points redeemed, 0 redemptions".

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as redeem_ledger_entries_with_no_redemption_record
from loyalty_ledger l
where l.entry_type = 'redeem'
  and not exists (select 1 from reward_redemptions rr where rr.ledger_entry_id = l.id);

\echo
\echo '=== Per-customer usage limits were respected =================================='
-- The count of a customer''s claims against a reward must never exceed that
-- reward''s `usage_limit_per_customer`.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as breaches_of_a_per_customer_limit
from (
  select rr.reward_id, rr.customer_id, count(*) as claims, r.usage_limit_per_customer as allowed
  from reward_redemptions rr
  join rewards r on r.id = rr.reward_id
  where r.usage_limit_per_customer is not null
    and rr.status in ('claimed', 'fulfilled')
  group by rr.reward_id, rr.customer_id, r.usage_limit_per_customer
  having count(*) > r.usage_limit_per_customer
) breaches;

select
  b.name as business, r.name as reward, c.email, count(*) as claims, r.usage_limit_per_customer as allowed
from reward_redemptions rr
join rewards r on r.id = rr.reward_id
join businesses b on b.id = rr.business_id
join customers c on c.id = rr.customer_id
where r.usage_limit_per_customer is not null and rr.status in ('claimed', 'fulfilled')
group by b.name, r.name, c.email, r.usage_limit_per_customer
having count(*) > r.usage_limit_per_customer
order by count(*) desc
limit 15;

\echo
\echo '=== Stock was respected ======================================================='
-- `stock` is decremented on claim. Total claims must never exceed the stock the
-- reward started with, which is `stock + redeemed_count` at any point in time.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as rewards_claimed_beyond_their_stock
from rewards r
where r.stock is not null and r.stock < 0;

\echo
\echo '=== Redemption codes =========================================================='
-- The code is what staff type to hand over a granted reward. A duplicate hands
-- over the wrong one.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as duplicate_redemption_codes
from (
  select business_id, code
  from reward_redemptions
  where code is not null
  group by business_id, code
  having count(*) > 1
) d;

select
  count(*) as redemptions,
  count(*) filter (where code is null) as without_a_code,
  count(*) filter (where length(code) < 6) as suspiciously_short_code
from reward_redemptions;

\echo
\echo '=== Expiry handling ==========================================================='
-- A claimed reward past its expiry that is still `claimed` will be honoured by
-- staff who do not read the date, which is a cost the merchant did not agree to.

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as claimed_redemptions_past_their_expiry
from reward_redemptions
where status = 'claimed' and expires_at is not null and expires_at < now();

\echo
\echo '=== Redemptions whose reward or customer is gone ==============================='
-- Both foreign keys are `on delete set null` / `cascade`, so a null reward is a
-- deleted reward rather than corruption — but the redemption then cannot say what
-- was handed over, which matters for a dispute.

select
  case
    when count(*) filter (where rr.reward_id is null or rr.program_id is null) = 0
      then 'PASS' else 'WARNING'
  end as status,
  count(*) filter (where rr.reward_id is null) as redemptions_with_no_reward,
  count(*) filter (where rr.program_id is null) as redemptions_with_no_program,
  count(*) as total
from reward_redemptions rr;

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as redemptions_with_no_customer
from reward_redemptions rr
where not exists (select 1 from customers c where c.id = rr.customer_id);

\echo
\echo '=== Cross-tenant redemptions =================================================='
-- Everything a redemption touches must belong to the same workspace.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as cross_tenant_redemptions
from reward_redemptions rr
left join customers c on c.id = rr.customer_id
left join rewards r on r.id = rr.reward_id
left join loyalty_ledger l on l.id = rr.ledger_entry_id
left join locations lo on lo.id = rr.location_id
where (c.id is not null and c.business_id <> rr.business_id)
   or (r.id is not null and r.business_id <> rr.business_id)
   or (l.id is not null and l.business_id <> rr.business_id)
   or (lo.id is not null and lo.business_id <> rr.business_id);

\echo
\echo '=== Redemption rate ==========================================================='
-- The number that says whether the loyalty program is working: of the customers
-- who reached a claimable balance, how many claimed?

select
  b.name as business,
  b.plan,
  reached.customers_who_ever_reached_the_goal,
  claimed.customers_who_claimed,
  case
    when reached.customers_who_ever_reached_the_goal = 0 then null
    else round(100.0 * claimed.customers_who_claimed / reached.customers_who_ever_reached_the_goal, 1)
  end as claim_rate_pct
from businesses b
join lateral (
  select count(distinct a.customer_id) as customers_who_ever_reached_the_goal
  from loyalty_accounts a
  join loyalty_programs p on p.id = a.program_id
  where a.business_id = b.id
    and p.goal_amount is not null
    and a.lifetime_earned >= p.goal_amount
) reached on true
join lateral (
  select count(distinct rr.customer_id) as customers_who_claimed
  from reward_redemptions rr
  where rr.business_id = b.id and rr.status in ('claimed', 'fulfilled')
) claimed on true
where b.archived_at is null
order by b.plan;
