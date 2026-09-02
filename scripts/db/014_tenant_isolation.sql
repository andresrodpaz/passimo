-- =============================================================================
-- 014 — TENANT ISOLATION  (the most important file here)
--
-- Multi-tenancy in this schema is a `business_id` column on 58 tables and an
-- application layer that scopes every query. That works, and it fails silently:
-- a single missing `.eq('business_id', ...)` leaks one merchant's customer list
-- to another, and nothing errors, nothing logs, and no test on either tenant in
-- isolation notices.
--
-- So this file does not test the application. It tests the *data* for the shape
-- a leak leaves behind: a row whose own `business_id` disagrees with the
-- `business_id` of something it points at. Every one of these must return zero.
--
--   customer.business_id <> ledger.business_id      -- must never happen
--
-- A single row from any query in this file is a P0.
--
--   psql "$DATABASE_URL" -f scripts/db/014_tenant_isolation.sql
-- =============================================================================

\pset pager off

\echo
\echo '=== Every table that should be tenant-scoped has the column ==================='
-- A table holding tenant data without a `business_id` cannot be scoped at all,
-- and every query against it returns every merchant's rows.

with tenant_tables(name) as (
  values
    ('customers'), ('customer_notes'), ('customer_tags'), ('customer_imports'),
    ('loyalty_programs'), ('loyalty_accounts'), ('loyalty_ledger'), ('earning_rules'),
    ('program_tiers'), ('rewards'), ('reward_redemptions'), ('activity_events'),
    ('stamp_events'), ('campaigns'), ('automations'), ('automation_runs'),
    ('segments'), ('messages'), ('message_templates'), ('suppressions'),
    ('locations'), ('team_members'), ('tags'), ('notifications'),
    ('wallet_registrations'), ('wallet_settings'), ('wallet_card_designs'),
    ('wallet_events'), ('wallet_notifications'), ('wallet_sync_state'),
    ('proximity_campaigns'), ('proximity_rules'), ('proximity_campaign_locations'),
    ('customer_device_positions'), ('gift_cards'), ('gift_card_transactions'),
    ('membership_plans'), ('customer_memberships'), ('referrals'),
    ('surveys'), ('survey_responses'), ('nps_responses'),
    ('api_keys'), ('webhook_endpoints'), ('webhook_deliveries'), ('integrations'),
    ('ai_insights'), ('audit_log'), ('usage_counters'), ('subscription_events'),
    ('billing_dunning'), ('business_onboarding'), ('data_requests'), ('jobs'),
    ('coalition_offers'), ('coalition_redemptions'), ('business_partnerships')
)
select
  case when count(*) filter (where c.column_name is null) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as tables_expected,
  count(*) filter (where c.column_name is null) as without_business_id,
  coalesce(string_agg(t.name, ', ') filter (where c.column_name is null), 'none') as missing
from tenant_tables t
left join information_schema.columns c
  on c.table_schema = 'public' and c.table_name = t.name and c.column_name = 'business_id';

\echo
\echo '=== business_id is NOT NULL wherever it is required ==========================='
-- A nullable tenant key is a row that belongs to nobody: `where business_id = $1`
-- excludes it, `select count(*)` includes it, and cascading the workspace away
-- never reaches it.
--
-- Four columns are nullable on purpose and are excluded here -- `jobs`,
-- `audit_log` and `subscription_events` hold platform-scoped rows, and a null
-- `message_templates.business_id` *is* the built-in template. Migration 000022
-- documents each and sets NOT NULL on the other seven. Anything appearing below
-- is a table added since without the constraint.

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as tenant_tables_with_an_unexpectedly_nullable_business_id,
  coalesce(string_agg(table_name, ', '), 'none') as tables
from information_schema.columns
where table_schema = 'public'
  and column_name = 'business_id'
  and is_nullable = 'YES'
  and table_name not in ('jobs', 'audit_log', 'subscription_events', 'message_templates');

\echo
\echo '=== business_id has a foreign key wherever it exists =========================='
-- Without one, deleting a workspace leaves its data behind, and a typo'd id
-- writes a row into a tenant that does not exist.

with scoped as (
  select table_name
  from information_schema.columns
  where table_schema = 'public' and column_name = 'business_id'
)
select
  case when count(*) filter (where not has_fk) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as tenant_tables,
  count(*) filter (where not has_fk) as without_a_foreign_key,
  coalesce(string_agg(table_name, ', ') filter (where not has_fk), 'none') as tables
from (
  select
    s.table_name,
    exists (
      select 1
      from pg_constraint con
      join pg_attribute att
        on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
      where con.contype = 'f'
        and con.conrelid = format('public.%I', s.table_name)::regclass
        and att.attname = 'business_id'
    ) as has_fk
  from scoped s
) checks;

\echo
\echo '=== Cascade behaviour ========================================================='
-- Deleting a workspace must take its data with it. A `no action` or `restrict`
-- here means account deletion fails halfway, leaving a partly-deleted tenant.

select
  case when count(*) filter (where action not in ('c', 'a')) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as business_id_foreign_keys,
  count(*) filter (where action = 'c') as on_delete_cascade,
  count(*) filter (where action = 'n') as on_delete_set_null,
  count(*) filter (where action = 'a') as on_delete_no_action,
  count(*) filter (where action = 'r') as on_delete_restrict
from (
  select con.confdeltype as action
  from pg_constraint con
  join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
  join pg_class cl on cl.oid = con.conrelid
  where con.contype = 'f'
    and cl.relnamespace = 'public'::regnamespace
    and att.attname = 'business_id'
) fks;

\echo '--- Any that are not cascade ---'
select cl.relname as table_name, con.conname,
  case con.confdeltype
    when 'c' then 'cascade' when 'n' then 'set null' when 'd' then 'set default'
    when 'r' then 'restrict' else 'no action'
  end as on_delete
from pg_constraint con
join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
join pg_class cl on cl.oid = con.conrelid
where con.contype = 'f'
  and cl.relnamespace = 'public'::regnamespace
  and att.attname = 'business_id'
  and con.confdeltype <> 'c'
order by cl.relname;

\echo
\echo '=== Orphan rows: a business_id pointing at no workspace ======================='
-- With foreign keys in place this must be zero by construction. It is checked
-- anyway, because a foreign key added `not valid` does not police existing rows.

select 'customers' as table_name, count(*) as orphans from customers c where not exists (select 1 from businesses b where b.id = c.business_id)
union all select 'loyalty_accounts', count(*) from loyalty_accounts x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'loyalty_ledger', count(*) from loyalty_ledger x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'loyalty_programs', count(*) from loyalty_programs x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'rewards', count(*) from rewards x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'reward_redemptions', count(*) from reward_redemptions x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'activity_events', count(*) from activity_events x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'campaigns', count(*) from campaigns x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'automations', count(*) from automations x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'segments', count(*) from segments x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'locations', count(*) from locations x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'team_members', count(*) from team_members x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'wallet_registrations', count(*) from wallet_registrations x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'wallet_settings', count(*) from wallet_settings x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'wallet_card_designs', count(*) from wallet_card_designs x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'wallet_events', count(*) from wallet_events x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'proximity_campaigns', count(*) from proximity_campaigns x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'proximity_rules', count(*) from proximity_rules x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'referrals', count(*) from referrals x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'gift_cards', count(*) from gift_cards x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'usage_counters', count(*) from usage_counters x where not exists (select 1 from businesses b where b.id = x.business_id)
union all select 'audit_log', count(*) from audit_log x where not exists (select 1 from businesses b where b.id = x.business_id)
order by orphans desc, table_name;

\echo
\echo '=== CRITICAL: rows whose tenant disagrees with a row they point at ============'
-- The leak signature. Each of these joins a row to something it references and
-- asserts they belong to the same workspace. A row here means a write crossed a
-- tenant boundary, which means a read can too.

select 'loyalty_ledger → customer' as relationship, count(*) as violations
from loyalty_ledger x join customers y on y.id = x.customer_id where y.business_id <> x.business_id
union all
select 'loyalty_ledger → program', count(*)
from loyalty_ledger x join loyalty_programs y on y.id = x.program_id where y.business_id <> x.business_id
union all
select 'loyalty_ledger → account', count(*)
from loyalty_ledger x join loyalty_accounts y on y.id = x.account_id where y.business_id <> x.business_id
union all
select 'loyalty_ledger → reward', count(*)
from loyalty_ledger x join rewards y on y.id = x.reward_id where y.business_id <> x.business_id
union all
select 'loyalty_ledger → location', count(*)
from loyalty_ledger x join locations y on y.id = x.location_id where y.business_id <> x.business_id
union all
select 'loyalty_ledger → campaign', count(*)
from loyalty_ledger x join campaigns y on y.id = x.campaign_id where y.business_id <> x.business_id
union all
select 'loyalty_accounts → customer', count(*)
from loyalty_accounts x join customers y on y.id = x.customer_id where y.business_id <> x.business_id
union all
select 'loyalty_accounts → program', count(*)
from loyalty_accounts x join loyalty_programs y on y.id = x.program_id where y.business_id <> x.business_id
union all
select 'reward_redemptions → customer', count(*)
from reward_redemptions x join customers y on y.id = x.customer_id where y.business_id <> x.business_id
union all
select 'reward_redemptions → reward', count(*)
from reward_redemptions x join rewards y on y.id = x.reward_id where y.business_id <> x.business_id
union all
select 'reward_redemptions → program', count(*)
from reward_redemptions x join loyalty_programs y on y.id = x.program_id where y.business_id <> x.business_id
union all
select 'reward_redemptions → ledger', count(*)
from reward_redemptions x join loyalty_ledger y on y.id = x.ledger_entry_id where y.business_id <> x.business_id
union all
select 'rewards → program', count(*)
from rewards x join loyalty_programs y on y.id = x.program_id where y.business_id <> x.business_id
union all
select 'rewards → segment', count(*)
from rewards x join segments y on y.id = x.segment_id where y.business_id <> x.business_id
union all
select 'earning_rules → program', count(*)
from earning_rules x join loyalty_programs y on y.id = x.program_id where y.business_id <> x.business_id
union all
select 'earning_rules → segment', count(*)
from earning_rules x join segments y on y.id = x.segment_id where y.business_id <> x.business_id
union all
select 'program_tiers → program', count(*)
from program_tiers x join loyalty_programs y on y.id = x.program_id where y.business_id <> x.business_id
union all
select 'activity_events → customer', count(*)
from activity_events x join customers y on y.id = x.customer_id where y.business_id <> x.business_id
union all
select 'activity_events → location', count(*)
from activity_events x join locations y on y.id = x.location_id where y.business_id <> x.business_id
union all
select 'customers → signup_location', count(*)
from customers x join locations y on y.id = x.signup_location_id where y.business_id <> x.business_id
union all
select 'customers → referred_by customer', count(*)
from customers x join customers y on y.id = x.referred_by where y.business_id <> x.business_id
union all
select 'customers → merged_into customer', count(*)
from customers x join customers y on y.id = x.merged_into_customer_id where y.business_id <> x.business_id
union all
select 'customer_notes → customer', count(*)
from customer_notes x join customers y on y.id = x.customer_id where y.business_id <> x.business_id
union all
select 'customer_tags → customer', count(*)
from customer_tags x join customers y on y.id = x.customer_id where y.business_id <> x.business_id
union all
select 'customer_tags → tag', count(*)
from customer_tags x join tags y on y.id = x.tag_id where y.business_id <> x.business_id
union all
select 'campaigns → segment', count(*)
from campaigns x join segments y on y.id = x.segment_id where y.business_id <> x.business_id
union all
select 'campaigns → reward', count(*)
from campaigns x join rewards y on y.id = x.attached_reward_id where y.business_id <> x.business_id
union all
select 'campaigns → program', count(*)
from campaigns x join loyalty_programs y on y.id = x.program_id where y.business_id <> x.business_id
union all
select 'automations → segment', count(*)
from automations x join segments y on y.id = x.segment_id where y.business_id <> x.business_id
union all
select 'automation_runs → automation', count(*)
from automation_runs x join automations y on y.id = x.automation_id where y.business_id <> x.business_id
union all
select 'automation_runs → customer', count(*)
from automation_runs x join customers y on y.id = x.customer_id where y.business_id <> x.business_id
union all
select 'messages → customer', count(*)
from messages x join customers y on y.id = x.customer_id where y.business_id <> x.business_id
union all
select 'wallet_registrations → customer', count(*)
from wallet_registrations x join customers y on y.id = x.customer_id where y.business_id <> x.business_id
union all
select 'wallet_events → customer', count(*)
from wallet_events x join customers y on y.id = x.customer_id where y.business_id <> x.business_id
union all
select 'wallet_events → location', count(*)
from wallet_events x join locations y on y.id = x.location_id where y.business_id <> x.business_id
union all
select 'wallet_events → proximity campaign', count(*)
from wallet_events x join proximity_campaigns y on y.id = x.campaign_id where y.business_id <> x.business_id
union all
select 'wallet_events → proximity rule', count(*)
from wallet_events x join proximity_rules y on y.id = x.rule_id where y.business_id <> x.business_id
union all
select 'wallet_notifications → customer', count(*)
from wallet_notifications x join customers y on y.id = x.customer_id where y.business_id <> x.business_id
union all
select 'proximity_campaign_locations → campaign', count(*)
from proximity_campaign_locations x join proximity_campaigns y on y.id = x.campaign_id where y.business_id <> x.business_id
union all
select 'proximity_campaign_locations → location', count(*)
from proximity_campaign_locations x join locations y on y.id = x.location_id where y.business_id <> x.business_id
union all
select 'proximity_campaigns → segment', count(*)
from proximity_campaigns x join segments y on y.id = x.segment_id where y.business_id <> x.business_id
union all
select 'referrals → referrer', count(*)
from referrals x join customers y on y.id = x.referrer_customer_id where y.business_id <> x.business_id
union all
select 'referrals → referred', count(*)
from referrals x join customers y on y.id = x.referred_customer_id where y.business_id <> x.business_id
union all
select 'team_members → default location', count(*)
from team_members x join locations y on y.id = x.default_location_id where y.business_id <> x.business_id
union all
select 'gift_card_transactions → gift card', count(*)
from gift_card_transactions x join gift_cards y on y.id = x.gift_card_id where y.business_id <> x.business_id
union all
select 'customer_memberships → plan', count(*)
from customer_memberships x join membership_plans y on y.id = x.plan_id where y.business_id <> x.business_id
union all
select 'customer_memberships → customer', count(*)
from customer_memberships x join customers y on y.id = x.customer_id where y.business_id <> x.business_id
union all
select 'survey_responses → survey', count(*)
from survey_responses x join surveys y on y.id = x.survey_id where y.business_id <> x.business_id
union all
select 'nps_responses → customer', count(*)
from nps_responses x join customers y on y.id = x.customer_id where y.business_id <> x.business_id
union all
select 'customer_device_positions → customer', count(*)
from customer_device_positions x join customers y on y.id = x.customer_id where y.business_id <> x.business_id
union all
select 'webhook_deliveries → endpoint', count(*)
from webhook_deliveries x join webhook_endpoints y on y.id = x.endpoint_id where y.business_id <> x.business_id
order by violations desc, relationship;

\echo
\echo '=== The verdict on cross-tenant links ========================================='
-- One number. Anything but zero stops a release.

select
  case when total = 0 then 'PASS' else 'FAIL' end as status,
  total as cross_tenant_relationship_violations
from (
  select
    (select count(*) from loyalty_ledger x join customers y on y.id = x.customer_id where y.business_id <> x.business_id)
    + (select count(*) from loyalty_ledger x join loyalty_programs y on y.id = x.program_id where y.business_id <> x.business_id)
    + (select count(*) from loyalty_ledger x join loyalty_accounts y on y.id = x.account_id where y.business_id <> x.business_id)
    + (select count(*) from loyalty_accounts x join customers y on y.id = x.customer_id where y.business_id <> x.business_id)
    + (select count(*) from loyalty_accounts x join loyalty_programs y on y.id = x.program_id where y.business_id <> x.business_id)
    + (select count(*) from reward_redemptions x join customers y on y.id = x.customer_id where y.business_id <> x.business_id)
    + (select count(*) from reward_redemptions x join rewards y on y.id = x.reward_id where y.business_id <> x.business_id)
    + (select count(*) from rewards x join loyalty_programs y on y.id = x.program_id where y.business_id <> x.business_id)
    + (select count(*) from earning_rules x join loyalty_programs y on y.id = x.program_id where y.business_id <> x.business_id)
    + (select count(*) from activity_events x join customers y on y.id = x.customer_id where y.business_id <> x.business_id)
    + (select count(*) from activity_events x join locations y on y.id = x.location_id where y.business_id <> x.business_id)
    + (select count(*) from customers x join locations y on y.id = x.signup_location_id where y.business_id <> x.business_id)
    + (select count(*) from customers x join customers y on y.id = x.referred_by where y.business_id <> x.business_id)
    + (select count(*) from customer_notes x join customers y on y.id = x.customer_id where y.business_id <> x.business_id)
    + (select count(*) from campaigns x join segments y on y.id = x.segment_id where y.business_id <> x.business_id)
    + (select count(*) from automations x join segments y on y.id = x.segment_id where y.business_id <> x.business_id)
    + (select count(*) from wallet_registrations x join customers y on y.id = x.customer_id where y.business_id <> x.business_id)
    + (select count(*) from wallet_events x join customers y on y.id = x.customer_id where y.business_id <> x.business_id)
    + (select count(*) from referrals x join customers y on y.id = x.referrer_customer_id where y.business_id <> x.business_id)
    + (select count(*) from team_members x join locations y on y.id = x.default_location_id where y.business_id <> x.business_id)
    as total
) t;

\echo
\echo '=== Unique constraints must be scoped to a tenant ============================='
-- A globally unique customer *email* would mean the second café to enrol
-- `ana@example.com` is refused because another business already has her. Names,
-- emails and slugs must therefore be unique within a workspace, not across it.
--
-- Two constraints are deliberately global and are excluded below:
--
--   `customers.referral_code`  A referral code is typed by a stranger who does
--                              not know which business issued it, and it has to
--                              resolve to exactly one customer platform-wide.
--   `gift_cards.code`          Read off a physical card at a till. An ambiguous
--                              gift-card code is money credited to the wrong
--                              account.
--
-- Both are generated random codes rather than merchant-chosen text, so global
-- uniqueness costs nothing a merchant can observe.

select
  case when count(*) filter (where not scoped) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as natural_key_constraints_checked,
  count(*) filter (where not scoped) as unscoped
from (
  select
    con.conname,
    cl.relname,
    exists (
      select 1 from pg_attribute a
      where a.attrelid = con.conrelid
        and a.attnum = any (con.conkey)
        and a.attname = 'business_id'
    ) as scoped
  from pg_constraint con
  join pg_class cl on cl.oid = con.conrelid
  where con.contype = 'u'
    and cl.relnamespace = 'public'::regnamespace
    and cl.relname in ('customers', 'rewards', 'segments', 'tags', 'locations', 'loyalty_programs', 'gift_cards', 'membership_plans')
    and con.conname not in ('customers_referral_code_key', 'gift_cards_code_key')
) checks;

\echo '--- Unscoped ones ---'
select cl.relname as table_name, con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class cl on cl.oid = con.conrelid
where con.contype = 'u'
  and cl.relnamespace = 'public'::regnamespace
  and cl.relname in ('customers', 'rewards', 'segments', 'tags', 'locations', 'loyalty_programs', 'gift_cards', 'membership_plans')
  and con.conname not in ('customers_referral_code_key', 'gift_cards_code_key')
  and not exists (
    select 1 from pg_attribute a
    where a.attrelid = con.conrelid and a.attnum = any (con.conkey) and a.attname = 'business_id'
  )
order by cl.relname;

\echo
\echo '=== Row-level security ========================================================'
-- RLS is **off by design here**, and that is what gets checked rather than
-- flagged.
--
-- Migration 000018 removed thirty-odd policies and explains why at length: they
-- were written for an architecture where the browser queries PostgreSQL directly,
-- Passimo has never worked that way, and a table owner bypasses its own policies
-- unless the table is FORCEd -- which none were. They were evaluated for zero
-- queries while reading, to anyone browsing the schema, as protection that
-- existed.
--
-- So this checks the opposite of "is RLS on": that no policy has been left behind
-- claiming to isolate tenants, because a policy that does nothing is worse than
-- no policy. Isolation is enforced by `lib/auth/context.ts` plus an explicit
-- `business_id` filter on every query, and the cross-tenant section above is what
-- actually verifies it held.

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as policies_left_behind,
  coalesce(string_agg(distinct tablename, ', '), 'none') as tables
from pg_policies
where schemaname = 'public';

select
  'INFO' as status,
  count(*) as tenant_tables,
  count(*) filter (where c.relrowsecurity) as with_rls_enabled,
  'off by design -- see migration 000018' as note
from pg_class c
join pg_tables t on t.tablename = c.relname and t.schemaname = 'public'
where c.relnamespace = 'public'::regnamespace
  and exists (
    select 1 from information_schema.columns col
    where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'business_id'
  );

\echo '--- FORCE row-level security (would apply policies to the owner too) ---'
select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as tables_with_force_rls
from pg_class
where relnamespace = 'public'::regnamespace and relforcerowsecurity;

\echo
\echo '=== Team membership is the only path to a workspace ==========================='
-- Authorisation resolves through `team_members`. A workspace whose owner has no
-- active row cannot be administered; a membership pointing at a workspace that
-- does not exist grants access to nothing but shows up in every "who has access"
-- list.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as memberships_pointing_at_a_missing_workspace
from team_members t
where not exists (select 1 from businesses b where b.id = t.business_id);

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as users_with_access_to_more_than_one_workspace
from (
  select user_id from team_members
  where user_id is not null and status = 'active'
  group by user_id having count(distinct business_id) > 1
) multi;

\echo '--- Who can see more than one workspace, and which ---'
select u.email, count(distinct t.business_id) as workspaces, string_agg(b.name, ', ') as names
from team_members t
join app_users u on u.id = t.user_id
join businesses b on b.id = t.business_id
where t.status = 'active'
group by u.email
having count(distinct t.business_id) > 1
order by count(distinct t.business_id) desc;

\echo
\echo '=== Platform admin reach ======================================================'
-- Deliberately cross-tenant. Listed here so the number of accounts that can read
-- every workspace is never a surprise.

select
  count(*) as platform_admins,
  string_agg(email, ', ') as who
from platform_admins;

\echo '--- Impersonation audit trail ---'
select b.name as business, i.reason, i.started_at, i.ended_at, i.expires_at
from admin_impersonations i
left join businesses b on b.id = i.business_id
order by i.started_at desc
limit 20;

\echo
\echo '=== API keys and webhooks are scoped =========================================='
-- An API key is a tenant credential. One with no workspace, or with access to
-- more than one, is a key that can read across the boundary.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as api_keys_with_no_workspace
from api_keys k
where k.business_id is null or not exists (select 1 from businesses b where b.id = k.business_id);

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as webhook_endpoints_with_no_workspace
from webhook_endpoints w
where w.business_id is null or not exists (select 1 from businesses b where b.id = w.business_id);
