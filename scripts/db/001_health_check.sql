-- =============================================================================
-- 001 — Health check
--
-- The first thing to run. Answers, in order: is anything there, is it the right
-- version, has every migration been applied, does the expected shape exist, and
-- is anything obviously on fire.
--
--   psql "$DATABASE_URL" -f scripts/db/001_health_check.sql
-- =============================================================================

\pset pager off
\timing off

\echo
\echo '=== Connectivity and server ==================================================='

select
  'PASS' as status,
  current_database() as database,
  current_user as connected_as,
  version() as server_version,
  pg_size_pretty(pg_database_size(current_database())) as size,
  (select count(*) from pg_stat_activity where datname = current_database()) as connections,
  (select setting::int from pg_settings where name = 'max_connections') as max_connections;

\echo
\echo '=== PostgreSQL major version =================================================='
-- 16 is what docker-compose and Railway run. Older majors miss the
-- `generated always as identity` and `jsonb_path` behaviour the schema relies on.

select
  case
    when current_setting('server_version_num')::int >= 160000 then 'PASS'
    when current_setting('server_version_num')::int >= 140000 then 'WARNING'
    else 'FAIL'
  end as status,
  current_setting('server_version_num')::int as version_num,
  '>= 160000 expected' as requirement;

\echo
\echo '=== Migration state ==========================================================='
-- 24 migrations as of 000023. The runner verifies a SHA-256 per file, so a
-- mismatch here means someone edited an applied migration — which breaks
-- `pnpm db:migrate` on every other database.

select
  case
    when count(*) = 24 then 'PASS'
    when count(*) = 0 then 'FAIL'
    else 'WARNING'
  end as status,
  count(*) as applied,
  24 as expected_at_time_of_writing,
  max(name) as latest,
  max(applied_at) as latest_applied_at
from schema_migrations;

\echo
\echo '--- Applied migrations, newest first ---'
select name, applied_at, left(checksum, 12) || '…' as checksum
from schema_migrations
order by name desc
limit 8;

\echo
\echo '=== Expected tables present ==================================================='
-- The 30 tables no feature can work without. A missing one means a partial
-- migration, which the count above would not always catch.

with expected(name) as (
  values
    ('app_users'), ('user_sessions'), ('user_tokens'), ('platform_admins'),
    ('businesses'), ('team_members'), ('business_onboarding'), ('locations'),
    ('customers'), ('customer_notes'), ('customer_tags'), ('tags'),
    ('loyalty_programs'), ('program_tiers'), ('loyalty_accounts'),
    ('loyalty_ledger'), ('earning_rules'), ('rewards'), ('reward_redemptions'),
    ('activity_events'), ('campaigns'), ('automations'), ('segments'),
    ('messages'), ('wallet_registrations'), ('wallet_settings'),
    ('wallet_card_designs'), ('proximity_campaigns'), ('proximity_rules'),
    ('usage_counters')
)
select
  case when count(*) filter (where t.tablename is null) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as expected_count,
  count(*) filter (where t.tablename is null) as missing_count,
  coalesce(
    string_agg(e.name, ', ') filter (where t.tablename is null),
    'none'
  ) as missing
from expected e
left join pg_tables t on t.schemaname = 'public' and t.tablename = e.name;

\echo
\echo '=== Row counts, live estimates ================================================'
-- `n_live_tup` rather than `count(*)`: this is a health check, not a report, and
-- it must stay fast on a database with millions of ledger rows.

select
  relname as table_name,
  n_live_tup as approx_rows,
  n_dead_tup as dead_rows,
  case
    when n_live_tup > 1000 and n_dead_tup > n_live_tup then 'WARNING'
    else 'PASS'
  end as bloat_status,
  last_autovacuum
from pg_stat_user_tables
where n_live_tup > 0
order by n_live_tup desc
limit 25;

\echo
\echo '=== Exact counts for the tables a demo review looks at ========================'

select 'businesses' as table_name, count(*) as rows from businesses
union all select 'app_users', count(*) from app_users
union all select 'customers', count(*) from customers
union all select 'loyalty_programs', count(*) from loyalty_programs
union all select 'loyalty_accounts', count(*) from loyalty_accounts
union all select 'loyalty_ledger', count(*) from loyalty_ledger
union all select 'rewards', count(*) from rewards
union all select 'reward_redemptions', count(*) from reward_redemptions
union all select 'activity_events', count(*) from activity_events
union all select 'campaigns', count(*) from campaigns
union all select 'locations', count(*) from locations
union all select 'wallet_registrations', count(*) from wallet_registrations
order by table_name;

\echo
\echo '=== Required functions present ================================================'
-- The loyalty engine, provisioning and analytics are database functions. A
-- missing one fails at the counter, not at deploy.

with expected(name) as (
  values
    ('passimo_record_earn'), ('passimo_redeem_reward'),
    ('passimo_credit_account'), ('passimo_debit_account'), ('passimo_ensure_account'),
    ('passimo_provision_business'), ('passimo_enroll_customer'),
    ('passimo_analytics_overview'), ('passimo_cohort_retention'),
    ('passimo_platform_overview'), ('passimo_rate_limit'),
    ('passimo_recompute_customer_stats'), ('passimo_recompute_rfm'),
    ('passimo_recompute_churn_risk'), ('passimo_expire_balances'),
    ('passimo_segment_count'), ('passimo_segment_customers'),
    ('passimo_claim_jobs'), ('passimo_evaluate_tier'),
    ('passimo_redeem_gift_card'), ('passimo_issue_gift_card'),
    ('passimo_proximity_analytics'), ('passimo_record_wallet_event'),
    ('passimo_has_business_access'), ('passimo_is_platform_admin'),
    ('passimo_delete_business'), ('passimo_anonymize_customer'),
    ('passimo_ledger_guard'), ('passimo_merge_customers')
)
select
  case when count(*) filter (where p.name is null) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) filter (where p.name is not null) as present,
  count(*) as expected,
  coalesce(string_agg(e.name, ', ') filter (where p.name is null), 'none') as missing
from expected e
left join (
  -- Distinct, because an overloaded function has one row per signature.
  select distinct proname as name from pg_proc where pronamespace = 'public'::regnamespace
) p on p.name = e.name;

\echo
\echo '=== Legacy fidelio_* routines ================================================='
-- Migration 000017 renames every routine and asserts none remain. A row here
-- means that migration did not run or was partially rolled back.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as legacy_routines,
  coalesce(string_agg(proname, ', '), 'none') as names
from pg_proc
where pronamespace = 'public'::regnamespace and proname like 'fidelio%';

\echo
\echo '=== Index count per table ====================================================='
-- A tenant-scoped table with only its primary key will table-scan under any real
-- load: every query in the product filters on `business_id`.

select
  case
    when i.index_count = 0 then 'FAIL'
    when c.has_business_id and i.index_count < 2 then 'WARNING'
    else 'PASS'
  end as status,
  t.tablename as table_name,
  i.index_count,
  c.has_business_id
from pg_tables t
join lateral (
  select count(*)::int as index_count from pg_indexes where schemaname = 'public' and tablename = t.tablename
) i on true
join lateral (
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = t.tablename and column_name = 'business_id'
  ) as has_business_id
) c on true
where t.schemaname = 'public'
  and t.tablename <> 'schema_migrations'
order by status desc, i.index_count, t.tablename;

\echo
\echo '=== Unused indexes ============================================================'
-- Written cost, never read. Only meaningful after the database has served real
-- traffic; on a freshly seeded database every index reads as unused.

select
  'WARNING' as status,
  relname as table_name,
  indexrelname as index_name,
  idx_scan as scans,
  pg_size_pretty(pg_relation_size(indexrelid)) as size
from pg_stat_user_indexes
where idx_scan = 0
  and indexrelid not in (select conindid from pg_constraint where contype in ('p', 'u'))
order by pg_relation_size(indexrelid) desc
limit 15;

\echo
\echo '=== Tables with no primary key ================================================'

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as tables_without_pk,
  coalesce(string_agg(t.tablename, ', '), 'none') as names
from pg_tables t
where t.schemaname = 'public'
  and not exists (
    select 1 from pg_constraint c
    where c.conrelid = format('public.%I', t.tablename)::regclass and c.contype = 'p'
  );

\echo
\echo '=== Row-level security ========================================================'
-- RLS is defence in depth here: the application connects as the owner and scopes
-- every query itself. These policies matter for anything that connects with a
-- restricted role — a BI tool, an analyst, a future read replica.

select
  case when count(*) filter (where not rowsecurity) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as tenant_tables,
  count(*) filter (where rowsecurity) as rls_enabled,
  count(*) filter (where not rowsecurity) as rls_disabled
from pg_tables t
join pg_class c on c.relname = t.tablename and c.relnamespace = 'public'::regnamespace
where t.schemaname = 'public'
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = t.tablename and column_name = 'business_id'
  );

\echo
\echo '=== Long-running queries ======================================================'

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as queries_over_30s
from pg_stat_activity
where datname = current_database()
  and state = 'active'
  and now() - query_start > interval '30 seconds'
  and pid <> pg_backend_pid();

\echo
\echo '=== Health check complete ====================================================='
