-- =============================================================================
-- 015 — Data integrity
--
-- Everything the other files do not cover: orphans, duplicates, impossible
-- states, missing constraints, and the indexes without which the product does
-- not scale past a few thousand customers.
--
-- Every check returns PASS or FAIL. This is the file to run in CI.
-- =============================================================================

\pset pager off

\echo
\echo '=== ORPHANS: rows whose parent is gone ========================================'
-- With foreign keys these are impossible. Checked because a constraint added
-- `not valid`, or a table created before its parent existed, silently is not one.

select 'loyalty_accounts → customer' as relationship, count(*) as orphans
from loyalty_accounts x where not exists (select 1 from customers y where y.id = x.customer_id)
union all select 'loyalty_accounts → program', count(*)
from loyalty_accounts x where not exists (select 1 from loyalty_programs y where y.id = x.program_id)
union all select 'loyalty_ledger → account', count(*)
from loyalty_ledger x where not exists (select 1 from loyalty_accounts y where y.id = x.account_id)
union all select 'loyalty_ledger → customer', count(*)
from loyalty_ledger x where not exists (select 1 from customers y where y.id = x.customer_id)
union all select 'loyalty_ledger → program', count(*)
from loyalty_ledger x where not exists (select 1 from loyalty_programs y where y.id = x.program_id)
union all select 'reward_redemptions → customer', count(*)
from reward_redemptions x where not exists (select 1 from customers y where y.id = x.customer_id)
union all select 'earning_rules → program', count(*)
from earning_rules x where not exists (select 1 from loyalty_programs y where y.id = x.program_id)
union all select 'activity_events → customer', count(*)
from activity_events x where x.customer_id is not null and not exists (select 1 from customers y where y.id = x.customer_id)
union all select 'customer_notes → customer', count(*)
from customer_notes x where not exists (select 1 from customers y where y.id = x.customer_id)
union all select 'customer_tags → customer', count(*)
from customer_tags x where not exists (select 1 from customers y where y.id = x.customer_id)
union all select 'customer_tags → tag', count(*)
from customer_tags x where not exists (select 1 from tags y where y.id = x.tag_id)
union all select 'automation_runs → automation', count(*)
from automation_runs x where not exists (select 1 from automations y where y.id = x.automation_id)
union all select 'messages → customer', count(*)
from messages x where x.customer_id is not null and not exists (select 1 from customers y where y.id = x.customer_id)
union all select 'wallet_registrations → customer', count(*)
from wallet_registrations x where not exists (select 1 from customers y where y.id = x.customer_id)
union all select 'referrals → referrer', count(*)
from referrals x where not exists (select 1 from customers y where y.id = x.referrer_customer_id)
union all select 'gift_card_transactions → gift card', count(*)
from gift_card_transactions x where not exists (select 1 from gift_cards y where y.id = x.gift_card_id)
union all select 'customer_memberships → plan', count(*)
from customer_memberships x where not exists (select 1 from membership_plans y where y.id = x.plan_id)
union all select 'survey_responses → survey', count(*)
from survey_responses x where not exists (select 1 from surveys y where y.id = x.survey_id)
union all select 'team_members → user (accepted)', count(*)
from team_members x where x.user_id is not null and not exists (select 1 from app_users y where y.id = x.user_id)
union all select 'user_sessions → user', count(*)
from user_sessions x where not exists (select 1 from app_users y where y.id = x.user_id)
union all select 'platform_admins → user', count(*)
from platform_admins x where not exists (select 1 from app_users y where y.id = x.user_id)
union all select 'businesses → owner', count(*)
from businesses x where x.owner_id is not null and not exists (select 1 from app_users y where y.id = x.owner_id)
order by orphans desc, relationship;

\echo '--- The verdict ---'
select
  case when total = 0 then 'PASS' else 'FAIL' end as status,
  total as orphan_rows
from (
  select
    (select count(*) from loyalty_accounts x where not exists (select 1 from customers y where y.id = x.customer_id))
    + (select count(*) from loyalty_accounts x where not exists (select 1 from loyalty_programs y where y.id = x.program_id))
    + (select count(*) from loyalty_ledger x where not exists (select 1 from loyalty_accounts y where y.id = x.account_id))
    + (select count(*) from loyalty_ledger x where not exists (select 1 from customers y where y.id = x.customer_id))
    + (select count(*) from reward_redemptions x where not exists (select 1 from customers y where y.id = x.customer_id))
    + (select count(*) from earning_rules x where not exists (select 1 from loyalty_programs y where y.id = x.program_id))
    + (select count(*) from customer_notes x where not exists (select 1 from customers y where y.id = x.customer_id))
    + (select count(*) from customer_tags x where not exists (select 1 from tags y where y.id = x.tag_id))
    + (select count(*) from wallet_registrations x where not exists (select 1 from customers y where y.id = x.customer_id))
    + (select count(*) from user_sessions x where not exists (select 1 from app_users y where y.id = x.user_id))
    + (select count(*) from businesses x where x.owner_id is not null and not exists (select 1 from app_users y where y.id = x.owner_id))
    as total
) t;

\echo
\echo '=== DUPLICATES: natural keys that must be unique =============================='

select 'app_users.email (global)' as key, count(*) as duplicates
from (select lower(email) from app_users group by lower(email) having count(*) > 1) d
union all select 'businesses.slug (global)', count(*)
from (select slug from businesses group by slug having count(*) > 1) d
union all select 'customers.email (per workspace)', count(*)
from (select business_id, lower(email) from customers where email is not null group by business_id, lower(email) having count(*) > 1) d
union all select 'customers.referral_code (global)', count(*)
from (select referral_code from customers where referral_code is not null group by referral_code having count(*) > 1) d
union all select 'loyalty_accounts (customer+program)', count(*)
from (select customer_id, program_id from loyalty_accounts group by customer_id, program_id having count(*) > 1) d
union all select 'loyalty_ledger.idempotency_key (per workspace)', count(*)
from (select business_id, idempotency_key from loyalty_ledger where idempotency_key is not null group by business_id, idempotency_key having count(*) > 1) d
union all select 'activity_events.idempotency_key (per workspace)', count(*)
from (select business_id, idempotency_key from activity_events where idempotency_key is not null group by business_id, idempotency_key having count(*) > 1) d
union all select 'reward_redemptions.code (per workspace)', count(*)
from (select business_id, code from reward_redemptions where code is not null group by business_id, code having count(*) > 1) d
union all select 'gift_cards.code (global)', count(*)
from (select code from gift_cards group by code having count(*) > 1) d
union all select 'team_members (workspace+user)', count(*)
from (select business_id, user_id from team_members where user_id is not null group by business_id, user_id having count(*) > 1) d
union all select 'segments.key (per workspace)', count(*)
from (select business_id, key from segments where key is not null group by business_id, key having count(*) > 1) d
union all select 'usage_counters (workspace+period+metric)', count(*)
from (select business_id, period, metric from usage_counters group by business_id, period, metric having count(*) > 1) d
union all select 'subscription_events.provider_event_id', count(*)
from (select provider, provider_event_id from subscription_events where provider_event_id is not null group by provider, provider_event_id having count(*) > 1) d
union all select 'wallet_registrations (customer+platform+device)', count(*)
from (select customer_id, platform, device_id from wallet_registrations where device_id is not null group by customer_id, platform, device_id having count(*) > 1) d
order by duplicates desc, key;

\echo '--- The verdict ---'
select
  case when total = 0 then 'PASS' else 'FAIL' end as status,
  total as duplicated_natural_keys
from (
  select
    (select count(*) from (select lower(email) from app_users group by lower(email) having count(*) > 1) d)
    + (select count(*) from (select slug from businesses group by slug having count(*) > 1) d)
    + (select count(*) from (select business_id, lower(email) from customers where email is not null group by business_id, lower(email) having count(*) > 1) d)
    + (select count(*) from (select referral_code from customers where referral_code is not null group by referral_code having count(*) > 1) d)
    + (select count(*) from (select customer_id, program_id from loyalty_accounts group by customer_id, program_id having count(*) > 1) d)
    + (select count(*) from (select business_id, idempotency_key from loyalty_ledger where idempotency_key is not null group by business_id, idempotency_key having count(*) > 1) d)
    + (select count(*) from (select business_id, code from reward_redemptions where code is not null group by business_id, code having count(*) > 1) d)
    + (select count(*) from (select code from gift_cards group by code having count(*) > 1) d)
    + (select count(*) from (select business_id, user_id from team_members where user_id is not null group by business_id, user_id having count(*) > 1) d)
    + (select count(*) from (select business_id, period, metric from usage_counters group by business_id, period, metric having count(*) > 1) d)
    as total
) t;

\echo
\echo '=== The unique constraints that must exist ====================================='
-- A duplicate check passing today proves nothing about tomorrow. These are the
-- constraints that make the duplicates above impossible rather than merely absent.

with required(table_name, description, columns) as (
  values
    ('app_users', 'login identity', array['email']),
    ('businesses', 'public URL', array['slug']),
    ('customers', 'one member per email per workspace', array['business_id', 'email']),
    ('loyalty_accounts', 'one balance per program', array['customer_id', 'program_id']),
    ('loyalty_ledger', 'replay safety at the counter', array['business_id', 'idempotency_key']),
    ('team_members', 'one role per person per workspace', array['business_id', 'user_id']),
    ('usage_counters', 'one counter per metric per month', array['business_id', 'period', 'metric']),
    ('wallet_card_designs', 'one card face per workspace', array['business_id'])
)
select
  case when count(*) filter (where not present) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as constraints_required,
  count(*) filter (where not present) as missing,
  coalesce(string_agg(table_name || ' (' || description || ')', '; ') filter (where not present), 'none') as which
from (
  select
    r.table_name,
    r.description,
    exists (
      select 1
      from pg_indexes i
      where i.schemaname = 'public'
        and i.tablename = r.table_name
        and i.indexdef ilike '%unique%'
        and (select bool_and(i.indexdef ilike '%' || col || '%') from unnest(r.columns) as col)
    ) as present
  from required r
) checks;

\echo '--- Every unique index on the core tables, for reference ---'
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexdef ilike '%unique%'
  and tablename in ('app_users', 'businesses', 'customers', 'loyalty_accounts', 'loyalty_ledger', 'team_members', 'usage_counters', 'wallet_card_designs', 'rewards', 'segments', 'locations')
order by tablename, indexname;

\echo
\echo '=== IMPOSSIBLE STATES ========================================================='
-- Combinations of columns that contradict each other. Each one is a state the UI
-- has no rendering for, so it produces a blank panel rather than an error.

select 'negative loyalty balance' as invalid_state, count(*) as rows
from loyalty_accounts where balance < 0
union all select 'lifetime_redeemed exceeds lifetime_earned', count(*)
from loyalty_accounts where lifetime_redeemed > lifetime_earned
union all select 'negative reward cost', count(*)
from rewards where cost < 0
union all select 'negative stock', count(*)
from rewards where stock is not null and stock < 0
union all select 'reward window ends before it starts', count(*)
from rewards where starts_at is not null and ends_at is not null and ends_at <= starts_at
union all select 'earning rule window ends before it starts', count(*)
from earning_rules where starts_at is not null and ends_at is not null and ends_at <= starts_at
union all select 'customer visit_count negative', count(*)
from customers where visit_count < 0
union all select 'customer lifetime_spend negative', count(*)
from customers where lifetime_spend < 0
union all select 'customer churn_risk outside 0-1', count(*)
from customers where churn_risk is not null and (churn_risk < 0 or churn_risk > 1)
union all select 'last_visit before created_at', count(*)
from customers where last_visit is not null and last_visit < created_at - interval '1 day'
union all select 'anonymised but not marked', count(*)
from customers where anonymized_at is not null and status <> 'anonymized'
union all select 'session expires before it was created', count(*)
from user_sessions where expires_at <= created_at
union all select 'trial ends before the workspace existed', count(*)
from businesses where trial_ends_at is not null and trial_ends_at < created_at
union all select 'campaign completed before it started', count(*)
from campaigns where started_at is not null and completed_at is not null and completed_at < started_at
union all select 'campaign sent more than it reached', count(*)
from campaigns where coalesce(sent_count, 0) > coalesce(reach_count, 0)
union all select 'redemption fulfilled before it was created', count(*)
from reward_redemptions where fulfilled_at is not null and fulfilled_at < created_at - interval '1 second'
union all select 'gift card remaining exceeds its face value', count(*)
from gift_cards where remaining_value > initial_value
union all select 'geofence radius not positive', count(*)
from locations where geofence_enabled and (notification_radius_m is null or notification_radius_m <= 0)
union all select 'ledger entry with amount zero', count(*)
from loyalty_ledger where amount = 0
union all select 'purchase event with no amount', count(*)
from activity_events where type = 'purchase' and (amount is null or amount <= 0)
order by rows desc, invalid_state;

\echo '--- The verdict ---'
select
  case when total = 0 then 'PASS' else 'FAIL' end as status,
  total as rows_in_an_impossible_state
from (
  select
    (select count(*) from loyalty_accounts where balance < 0)
    + (select count(*) from loyalty_accounts where lifetime_redeemed > lifetime_earned)
    + (select count(*) from rewards where cost < 0)
    + (select count(*) from rewards where stock is not null and stock < 0)
    + (select count(*) from rewards where starts_at is not null and ends_at is not null and ends_at <= starts_at)
    + (select count(*) from customers where visit_count < 0)
    + (select count(*) from customers where lifetime_spend < 0)
    + (select count(*) from customers where churn_risk is not null and (churn_risk < 0 or churn_risk > 1))
    + (select count(*) from customers where anonymized_at is not null and status <> 'anonymized')
    + (select count(*) from user_sessions where expires_at <= created_at)
    + (select count(*) from campaigns where coalesce(sent_count, 0) > coalesce(reach_count, 0))
    + (select count(*) from gift_cards where remaining_value > initial_value)
    + (select count(*) from loyalty_ledger where amount = 0)
    as total
) t;

\echo
\echo '=== SUSPICIOUS NULLS =========================================================='
-- Columns that are nullable by schema but should always have a value in practice.
-- A null here is not corruption; it is a screen that renders an em dash where the
-- merchant expects information.

select
  'businesses.timezone' as column_name,
  count(*) filter (where timezone is null) as nulls,
  count(*) as rows,
  'send windows and "today" resolve in UTC without it' as consequence
from businesses
union all select 'businesses.currency', count(*) filter (where currency is null), count(*),
  'every money figure renders unlabelled'
from businesses
union all select 'businesses.locale', count(*) filter (where locale is null), count(*),
  'outbound messages fall back to the default language'
from businesses
union all select 'customers.referral_code', count(*) filter (where referral_code is null), count(*),
  'that customer cannot refer anybody'
from customers
union all select 'customers.wallet_auth_token', count(*) filter (where wallet_auth_token is null), count(*),
  'their pass cannot authenticate for updates'
from customers
union all select 'customers.consent_updated_at (where consented)',
  count(*) filter (where consent_marketing and consent_updated_at is null),
  count(*) filter (where consent_marketing),
  'consent with no timestamp cannot be defended'
from customers
union all select 'loyalty_programs.goal_amount', count(*) filter (where goal_amount is null), count(*),
  'the card has no target to render progress against'
from loyalty_programs
union all select 'locations.lat/lng', count(*) filter (where lat is null or lng is null), count(*),
  'every proximity feature at that site is inert'
from locations where archived_at is null
union all select 'loyalty_ledger.idempotency_key', count(*) filter (where idempotency_key is null), count(*),
  'that write cannot be safely replayed'
from loyalty_ledger
order by nulls desc;

\echo
\echo '=== INDEXES the product needs ================================================='
-- Every list screen filters by `business_id` and orders by a timestamp. Without a
-- composite index on the large tables, each of those is a sequential scan over
-- every tenant''s rows.

with required(table_name, columns) as (
  values
    ('customers', array['business_id']),
    ('loyalty_ledger', array['business_id']),
    ('loyalty_ledger', array['customer_id']),
    ('loyalty_accounts', array['customer_id']),
    ('activity_events', array['business_id']),
    ('activity_events', array['customer_id']),
    ('reward_redemptions', array['business_id']),
    ('rewards', array['business_id']),
    ('campaigns', array['business_id']),
    ('messages', array['business_id']),
    ('wallet_registrations', array['business_id']),
    ('wallet_events', array['business_id']),
    ('locations', array['business_id']),
    ('team_members', array['business_id']),
    ('user_sessions', array['user_id']),
    ('jobs', array['status'])
)
select
  case when count(*) filter (where not present) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as indexes_expected,
  count(*) filter (where not present) as missing,
  coalesce(
    string_agg(table_name || '(' || array_to_string(columns, ',') || ')', '; ') filter (where not present),
    'none'
  ) as which
from (
  select
    r.table_name,
    r.columns,
    exists (
      select 1 from pg_indexes i
      where i.schemaname = 'public'
        and i.tablename = r.table_name
        and (select bool_and(i.indexdef ilike '%' || col || '%') from unnest(r.columns) as col)
    ) as present
  from required r
) checks;

\echo
\echo '=== Large tables without a tenant-scoped index ================================='
-- The ones that will actually hurt. A table under a thousand rows scans fast
-- whatever you do.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as large_unindexed_tenant_tables,
  coalesce(string_agg(relname, ', '), 'none') as tables
from pg_stat_user_tables s
where s.n_live_tup > 1000
  and exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = s.relname and c.column_name = 'business_id'
  )
  and not exists (
    select 1 from pg_indexes i
    where i.schemaname = 'public' and i.tablename = s.relname and i.indexdef ilike '%business_id%'
  );

\echo
\echo '=== Sequential scans on large tables =========================================='
-- Only meaningful after real traffic. A high `seq_scan` against a low `idx_scan`
-- on a large table is a query somewhere without a usable index.

select
  relname as table_name,
  n_live_tup as rows,
  seq_scan,
  idx_scan,
  case
    when n_live_tup > 5000 and seq_scan > coalesce(idx_scan, 0) * 2 and seq_scan > 100 then 'WARNING'
    else 'PASS'
  end as status
from pg_stat_user_tables
where n_live_tup > 1000
order by seq_scan desc
limit 15;

\echo
\echo '=== Table and index sizes ====================================================='

select
  relname as table_name,
  pg_size_pretty(pg_total_relation_size(relid)) as total,
  pg_size_pretty(pg_relation_size(relid)) as table_only,
  pg_size_pretty(pg_indexes_size(relid)) as indexes,
  case
    when pg_relation_size(relid) > 1000000 and pg_indexes_size(relid) > pg_relation_size(relid) * 3
      then 'WARNING'
    else 'PASS'
  end as index_overhead_status
from pg_catalog.pg_statio_user_tables
order by pg_total_relation_size(relid) desc
limit 15;

\echo
\echo '=== FINAL VERDICT ============================================================='

select
  case when orphans + duplicates + impossible = 0 then 'PASS' else 'FAIL' end as status,
  orphans,
  duplicates,
  impossible,
  case
    when orphans + duplicates + impossible = 0 then 'Data integrity holds.'
    else 'Investigate the sections above before releasing.'
  end as verdict
from (
  select
    (select count(*) from loyalty_accounts x where not exists (select 1 from customers y where y.id = x.customer_id))
      + (select count(*) from loyalty_ledger x where not exists (select 1 from loyalty_accounts y where y.id = x.account_id))
      + (select count(*) from reward_redemptions x where not exists (select 1 from customers y where y.id = x.customer_id))
      + (select count(*) from user_sessions x where not exists (select 1 from app_users y where y.id = x.user_id))
      as orphans,
    (select count(*) from (select business_id, lower(email) from customers where email is not null group by business_id, lower(email) having count(*) > 1) d)
      + (select count(*) from (select lower(email) from app_users group by lower(email) having count(*) > 1) d)
      + (select count(*) from (select slug from businesses group by slug having count(*) > 1) d)
      + (select count(*) from (select customer_id, program_id from loyalty_accounts group by customer_id, program_id having count(*) > 1) d)
      as duplicates,
    (select count(*) from loyalty_accounts where balance < 0)
      + (select count(*) from loyalty_ledger where amount = 0)
      + (select count(*) from rewards where cost < 0)
      + (select count(*) from customers where visit_count < 0 or lifetime_spend < 0)
      as impossible
) t;
