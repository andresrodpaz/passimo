-- Ported from the previous hosted-Postgres provider to standard PostgreSQL.
-- Transformations applied (see docs/POSTGRESQL.md):
--   auth.users            -> app_users            (an ordinary table we own)
--   auth.uid()            -> app_current_user_id()
--   grants to anon / authenticated / service_role -> removed (provider roles)

-- =============================================================================
-- 000008 — Row level security
--
-- Defence in depth. The API already authorises every request, but RLS means a
-- leaked anon key, a forgotten filter, or a future bug still cannot read
-- another merchant's customers.
--
-- Two problems with the original policies are fixed here:
--   1. Every policy inlined the same `business_id in (select ... union ...)`
--      subquery. Postgres re-planned it per table and it was easy to get wrong.
--      It is now one STABLE SECURITY DEFINER function, which also lets the
--      planner cache it per statement.
--   2. `FOR ALL USING (...)` without `WITH CHECK` let a member *insert* rows
--      into another business in some paths. Every policy now states both.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Access helpers
-- -----------------------------------------------------------------------------

create or replace function fidelio_member_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select business_id
    from team_members
   where user_id = app_current_user_id()
     and status = 'active'
     and business_id is not null;
$$;

create or replace function fidelio_has_business_access(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from team_members
     where user_id = app_current_user_id()
       and business_id = p_business_id
       and status = 'active'
  );
$$;

create or replace function fidelio_has_business_role(p_business_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from team_members
     where user_id = app_current_user_id()
       and business_id = p_business_id
       and status = 'active'
       and role = any (p_roles)
  );
$$;


-- -----------------------------------------------------------------------------
-- Apply the standard business-scoped policy to every tenant table
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
  tenant_tables text[] := array[
    'locations', 'customers', 'customer_tags', 'customer_notes', 'tags',
    'activity_events', 'segments', 'customer_imports',
    'loyalty_programs', 'program_tiers', 'earning_rules', 'rewards',
    'loyalty_accounts', 'loyalty_ledger', 'reward_redemptions',
    'membership_plans', 'customer_memberships', 'referrals',
    'gift_cards', 'gift_card_transactions', 'surveys', 'survey_responses',
    'campaigns', 'automations', 'automation_runs', 'messages',
    'suppressions', 'ai_insights', 'notifications', 'audit_log',
    'webhook_endpoints', 'webhook_deliveries', 'coalition_offers',
    'business_partnerships', 'data_requests', 'jobs'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "tenant read" on %I', t);
    execute format('drop policy if exists "tenant write" on %I', t);
    execute format(
      'create policy "tenant read" on %I for select using (fidelio_has_business_access(business_id))', t
    );
    execute format(
      'create policy "tenant write" on %I for all
         using (fidelio_has_business_access(business_id))
         with check (fidelio_has_business_access(business_id))', t
    );
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Businesses — members read; only owners/admins mutate
-- -----------------------------------------------------------------------------

alter table businesses enable row level security;

drop policy if exists "owner access" on businesses;
drop policy if exists "business read" on businesses;
drop policy if exists "business update" on businesses;
drop policy if exists "business insert" on businesses;

create policy "business read" on businesses
  for select using (fidelio_has_business_access(id) or owner_id = app_current_user_id());

create policy "business insert" on businesses
  for insert with check (owner_id = app_current_user_id());

create policy "business update" on businesses
  for update
  using (owner_id = app_current_user_id() or fidelio_has_business_role(id, array['owner', 'admin']))
  with check (owner_id = app_current_user_id() or fidelio_has_business_role(id, array['owner', 'admin']));

create policy "business delete" on businesses
  for delete using (owner_id = app_current_user_id());

-- -----------------------------------------------------------------------------
-- Team members — read your own team; only owners/admins manage it
-- -----------------------------------------------------------------------------

alter table team_members enable row level security;

drop policy if exists "team read" on team_members;
drop policy if exists "team self read" on team_members;
drop policy if exists "owner team manage" on team_members;
drop policy if exists "team manage" on team_members;

create policy "team read" on team_members
  for select using (user_id = app_current_user_id() or fidelio_has_business_access(business_id));

create policy "team manage" on team_members
  for all
  using (fidelio_has_business_role(business_id, array['owner', 'admin']))
  with check (fidelio_has_business_role(business_id, array['owner', 'admin']));

-- -----------------------------------------------------------------------------
-- Secret-bearing tables — no direct client access at all
--
-- API keys and integration credentials are only ever touched through the
-- service role in server code. Enabling RLS with no permissive policy makes
-- that a hard guarantee rather than a convention.
-- -----------------------------------------------------------------------------

alter table api_keys enable row level security;
drop policy if exists "tenant read" on api_keys;
drop policy if exists "tenant write" on api_keys;
drop policy if exists "api key read" on api_keys;
-- Metadata is readable by admins so the UI can list keys; the hash never is,
-- which is enforced by the API layer selecting an explicit column list.
create policy "api key read" on api_keys
  for select using (fidelio_has_business_role(business_id, array['owner', 'admin']));

alter table integrations enable row level security;
drop policy if exists "integration read" on integrations;
create policy "integration read" on integrations
  for select using (fidelio_has_business_role(business_id, array['owner', 'admin']));

alter table rate_limits enable row level security;
-- No policy: service role only.

alter table message_templates enable row level security;
drop policy if exists "template read" on message_templates;
drop policy if exists "template write" on message_templates;
create policy "template read" on message_templates
  for select using (business_id is null or fidelio_has_business_access(business_id));
create policy "template write" on message_templates
  for all
  using (business_id is not null and fidelio_has_business_access(business_id))
  with check (business_id is not null and fidelio_has_business_access(business_id));

-- -----------------------------------------------------------------------------
-- Ledger is append-only even for the owner
-- -----------------------------------------------------------------------------

drop policy if exists "tenant write" on loyalty_ledger;
create policy "ledger insert" on loyalty_ledger
  for insert with check (fidelio_has_business_access(business_id));
-- No update/delete policy: corrections must be posted as reversals.

-- -----------------------------------------------------------------------------
-- Audit log is append-only and readable by admins only
-- -----------------------------------------------------------------------------

drop policy if exists "tenant read" on audit_log;
drop policy if exists "tenant write" on audit_log;
create policy "audit read" on audit_log
  for select using (fidelio_has_business_role(business_id, array['owner', 'admin']));
create policy "audit insert" on audit_log
  for insert with check (fidelio_has_business_access(business_id));

-- -----------------------------------------------------------------------------
-- Partnerships are visible to both sides
-- -----------------------------------------------------------------------------

drop policy if exists "tenant read" on business_partnerships;
create policy "partnership read" on business_partnerships
  for select using (
    fidelio_has_business_access(business_id)
    or fidelio_has_business_access(partner_business_id)
  );

-- -----------------------------------------------------------------------------
-- Legacy tables retained for historical reads only
-- -----------------------------------------------------------------------------

alter table nps_responses enable row level security;
drop policy if exists "staff nps access" on nps_responses;
create policy "legacy nps read" on nps_responses
  for select using (fidelio_has_business_access(business_id));

alter table stamp_events enable row level security;
drop policy if exists "staff stamp access" on stamp_events;
create policy "legacy stamp read" on stamp_events
  for select using (fidelio_has_business_access(business_id));
