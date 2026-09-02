-- =============================================================================
-- 007 — Transactions: earning, the ledger and balances
--
-- The single most important invariant in the product: a customer's balance must
-- equal the sum of their ledger. If it does not, the number on the wallet card is
-- a fiction, and every screen built on it is wrong in a way no test on either
-- table alone would catch.
-- =============================================================================

\pset pager off

\echo
\echo '=== Ledger volume per workspace ==============================================='

select
  b.name as business,
  b.plan,
  count(*) as entries,
  count(*) filter (where l.entry_type = 'earn') as earn,
  count(*) filter (where l.entry_type = 'redeem') as redeem,
  count(*) filter (where l.entry_type = 'adjust') as adjust,
  count(*) filter (where l.entry_type = 'expire') as expire,
  count(*) filter (where l.entry_type = 'reverse') as reverse,
  sum(l.amount) filter (where l.amount > 0) as credited,
  -sum(l.amount) filter (where l.amount < 0) as debited,
  min(l.created_at)::date as first_entry,
  max(l.created_at)::date as last_entry
from loyalty_ledger l
join businesses b on b.id = l.business_id
group by b.name, b.plan
order by b.plan;

\echo
\echo '=== CRITICAL: balance must equal the sum of the ledger ========================'
-- The invariant. A mismatch means either a write bypassed the ledger or a ledger
-- entry was written without adjusting the account, and both produce a card whose
-- balance is not defensible to the customer holding it.

with reconciled as (
  select
    a.id as account_id,
    a.business_id,
    a.customer_id,
    a.balance as stored,
    coalesce(sum(l.amount), 0) as ledger_sum
  from loyalty_accounts a
  left join loyalty_ledger l on l.account_id = a.id
  group by a.id, a.business_id, a.customer_id, a.balance
)
select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as accounts_whose_balance_disagrees_with_their_ledger,
  coalesce(round(max(abs(stored - ledger_sum)), 2), 0) as worst_gap
from reconciled
where abs(stored - ledger_sum) > 0.001;

\echo '--- The worst offenders ---'
with reconciled as (
  select b.name as business, c.email, a.balance as stored, coalesce(sum(l.amount), 0) as ledger_sum
  from loyalty_accounts a
  join businesses b on b.id = a.business_id
  join customers c on c.id = a.customer_id
  left join loyalty_ledger l on l.account_id = a.id
  group by b.name, c.email, a.balance
)
select business, email, stored, ledger_sum, round(stored - ledger_sum, 2) as gap
from reconciled
where abs(stored - ledger_sum) > 0.001
order by abs(stored - ledger_sum) desc
limit 15;

\echo
\echo '=== lifetime_earned must equal the sum of credits =============================='

with reconciled as (
  select
    a.id,
    a.lifetime_earned as stored,
    coalesce(sum(l.amount) filter (where l.amount > 0), 0) as credits
  from loyalty_accounts a
  left join loyalty_ledger l on l.account_id = a.id
  group by a.id, a.lifetime_earned
)
select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as accounts_with_a_wrong_lifetime_earned
from reconciled
where abs(stored - credits) > 0.001;

\echo
\echo '=== balance_after must match the running total ================================='
-- Each ledger row records the balance it produced. Recomputing the running sum
-- and comparing catches an entry inserted out of order or backdated after the
-- fact — which is invisible in the final balance but breaks every history view.

with ordered as (
  select
    l.id,
    l.account_id,
    l.balance_after,
    sum(l.amount) over (partition by l.account_id order by l.created_at, l.id) as running
  from loyalty_ledger l
)
select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as entries_whose_balance_after_does_not_match_the_running_total
from ordered
where abs(balance_after - running) > 0.001;

\echo
\echo '=== No negative balances ======================================================'
-- A negative balance means a redemption debited more than was there, which the
-- database guard is supposed to make impossible.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as accounts_with_a_negative_balance,
  coalesce(min(balance), 0) as most_negative
from loyalty_accounts
where balance < 0;

\echo
\echo '=== Entry types and signs agree ==============================================='
-- An `earn` with a negative amount, or a `redeem` with a positive one, is a row
-- that will be counted the wrong way by every aggregate.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as entries_whose_sign_contradicts_their_type
from loyalty_ledger
where (entry_type = 'earn' and amount < 0)
   or (entry_type = 'redeem' and amount > 0)
   or (entry_type = 'expire' and amount > 0)
   or amount = 0;

\echo
\echo '=== Idempotency ==============================================================='
-- The POS retries, the offline queue replays, and Stripe delivers twice. The
-- idempotency key is what stops a customer being credited twice for one coffee.

select
  case when count(*) = 0 then 'FAIL' else 'PASS' end as status,
  count(*) as unique_indexes_on_the_ledger_idempotency_key
from pg_indexes
where schemaname = 'public'
  and tablename = 'loyalty_ledger'
  and indexdef ilike '%unique%'
  and indexdef ilike '%idempotency_key%';

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as duplicated_idempotency_keys
from (
  select business_id, idempotency_key
  from loyalty_ledger
  where idempotency_key is not null
  group by business_id, idempotency_key
  having count(*) > 1
) d;

select
  count(*) as entries,
  count(*) filter (where idempotency_key is not null) as with_a_key,
  round(
    100.0 * count(*) filter (where idempotency_key is not null) / greatest(count(*), 1),
    1
  ) as percent_keyed
from loyalty_ledger;

\echo
\echo '=== Activity events =========================================================='

select
  b.name as business,
  e.type,
  count(*) as events,
  round(sum(e.amount)::numeric, 2) as total_amount,
  round(avg(e.amount)::numeric, 2) as avg_amount,
  min(e.occurred_at)::date as first,
  max(e.occurred_at)::date as last
from activity_events e
join businesses b on b.id = e.business_id
group by b.name, e.type
order by b.name, count(*) desc;

\echo
\echo '=== Purchases with an implausible amount ======================================'
-- A zero-amount purchase earns nothing on a points program and looks like a bug
-- to the merchant; a five-figure basket in a café is a typo that will distort
-- every average on the analytics screen.

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as implausible_purchases
from activity_events
where type = 'purchase' and (amount is null or amount <= 0 or amount > 5000);

\echo
\echo '=== Scan throughput, last 30 days ============================================='
-- What the counter actually did. A workspace at zero has staff who are not
-- scanning, which is the leading indicator of churn in this product.

select
  b.name as business,
  b.plan,
  count(*) filter (where l.created_at > now() - interval '1 day') as last_24h,
  count(*) filter (where l.created_at > now() - interval '7 days') as last_7d,
  count(*) filter (where l.created_at > now() - interval '30 days') as last_30d,
  max(l.created_at) as most_recent
from businesses b
left join loyalty_ledger l on l.business_id = b.id and l.entry_type = 'earn'
where b.archived_at is null
group by b.name, b.plan
order by b.plan;

\echo
\echo '=== Expiring balances ========================================================='
-- Points with an expiry date are a liability with a deadline. A merchant needs to
-- know how much is about to vanish, because that is the win-back campaign.

select
  b.name as business,
  count(*) filter (where l.expires_at < now() and l.consumed_at is null) as already_expired_not_swept,
  count(*) filter (where l.expires_at between now() and now() + interval '30 days' and l.consumed_at is null) as expiring_in_30d,
  round(sum(l.remaining) filter (where l.expires_at between now() and now() + interval '30 days' and l.consumed_at is null), 2) as balance_at_risk
from loyalty_ledger l
join businesses b on b.id = l.business_id
where l.expires_at is not null
group by b.name
order by b.name;

\echo
\echo '=== Outstanding liability per workspace ======================================='
-- The real number on the merchant's books: unredeemed balance, and what it would
-- cost if everybody claimed at once.

select
  b.name as business,
  p.name as program,
  p.type,
  count(a.id) as accounts,
  round(sum(a.balance), 2) as outstanding_balance,
  p.goal_amount as goal,
  case
    when p.goal_amount is null or p.goal_amount = 0 then null
    else floor(sum(a.balance) / p.goal_amount)
  end as rewards_claimable_right_now
from loyalty_accounts a
join loyalty_programs p on p.id = a.program_id
join businesses b on b.id = a.business_id
group by b.name, p.name, p.type, p.goal_amount
order by b.name;
