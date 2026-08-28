-- Ported from the previous hosted-Postgres provider to standard PostgreSQL.
-- Transformations applied (see docs/POSTGRESQL.md):
--   auth.users            -> app_users            (an ordinary table we own)
--   auth.uid()            -> app_current_user_id()
--   grants to anon / authenticated / service_role -> removed (provider roles)

-- =============================================================================
-- 000002 — Platform core
--
-- Turns the single-tenant-ish prototype into a real multi-tenant platform:
-- workspace metadata, locations, richer team roles, billing, audit trail, an
-- outbox job queue, API keys, webhooks and integrations.
--
-- Every table added here is business-scoped and gets RLS in 000008.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";
create extension if not exists "pg_trgm";

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------

-- Generic updated_at trigger. Attached to every mutable table so clients can
-- do reliable incremental sync and we can debug "when did this change?".
create or replace function fidelio_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Crypto-strong human-friendly code. The original schema used md5(random()),
-- which is neither uniformly distributed nor unguessable — a real problem for
-- gift cards and referral codes that carry monetary value.
create or replace function fidelio_random_code(p_length int default 8)
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
begin
  for i in 1..p_length loop
    -- gen_random_bytes is CSPRNG-backed (pgcrypto).
    result := result || substr(alphabet, (get_byte(gen_random_bytes(1), 0) % length(alphabet)) + 1, 1);
  end loop;
  return result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Businesses — workspace, branding, billing, settings
-- -----------------------------------------------------------------------------

alter table businesses add column if not exists updated_at timestamptz not null default now();
alter table businesses add column if not exists timezone text not null default 'Europe/Madrid';
alter table businesses add column if not exists currency text not null default 'EUR';
alter table businesses add column if not exists locale text not null default 'es';
alter table businesses add column if not exists country text;
alter table businesses add column if not exists address text;
alter table businesses add column if not exists postal_code text;
alter table businesses add column if not exists phone text;
alter table businesses add column if not exists support_email text;
alter table businesses add column if not exists website text;
alter table businesses add column if not exists instagram text;
alter table businesses add column if not exists google_review_url text;
alter table businesses add column if not exists cover_url text;
alter table businesses add column if not exists icon_url text;
alter table businesses add column if not exists strip_url text;
alter table businesses add column if not exists onboarding_completed_at timestamptz;
alter table businesses add column if not exists onboarding_step text;
alter table businesses add column if not exists archived_at timestamptz;

-- Billing
alter table businesses add column if not exists plan text not null default 'trial';
alter table businesses add column if not exists trial_ends_at timestamptz default (now() + interval '14 days');
alter table businesses add column if not exists stripe_customer_id text;
alter table businesses add column if not exists stripe_subscription_id text;
alter table businesses add column if not exists subscription_status text;
alter table businesses add column if not exists subscription_current_period_end timestamptz;

-- Free-form, versioned settings (quiet hours, notification prefs, feature flags)
alter table businesses add column if not exists settings jsonb not null default '{}'::jsonb;

-- Growth: merchant-to-merchant referrals
alter table businesses add column if not exists referral_code text;
alter table businesses add column if not exists referred_by_business_id uuid references businesses (id) on delete set null;

do $$ begin
  alter table businesses add constraint businesses_plan_check
    check (plan in ('trial', 'starter', 'growth', 'pro', 'enterprise'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table businesses add constraint businesses_currency_check
    check (currency ~ '^[A-Z]{3}$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table businesses add constraint businesses_slug_format_check
    check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$');
exception when duplicate_object then null; end $$;

update businesses set referral_code = fidelio_random_code(8) where referral_code is null;
alter table businesses alter column referral_code set default fidelio_random_code(8);
create unique index if not exists idx_businesses_referral_code on businesses (referral_code);
create unique index if not exists idx_businesses_stripe_customer on businesses (stripe_customer_id)
  where stripe_customer_id is not null;
create index if not exists idx_businesses_owner on businesses (owner_id);

drop trigger if exists trg_businesses_updated_at on businesses;
create trigger trg_businesses_updated_at before update on businesses
  for each row execute function fidelio_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Locations — multi-site merchants are the ones who pay the most
-- -----------------------------------------------------------------------------

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  address text,
  city text,
  postal_code text,
  country text,
  phone text,
  lat double precision,
  lng double precision,
  geo_radius_m int not null default 200 check (geo_radius_m between 50 and 5000),
  timezone text,
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_locations_business on locations (business_id) where archived_at is null;
create unique index if not exists idx_locations_one_default on locations (business_id) where is_default;

drop trigger if exists trg_locations_updated_at on locations;
create trigger trg_locations_updated_at before update on locations
  for each row execute function fidelio_touch_updated_at();

-- Backfill one location per business from the legacy geo columns.
insert into locations (business_id, name, city, lat, lng, geo_radius_m, is_default)
select b.id,
       coalesce(b.name, 'Main location'),
       b.city,
       b.geo_lat,
       b.geo_lng,
       coalesce(b.geo_alert_radius, 200),
       true
from businesses b
where not exists (select 1 from locations l where l.business_id = b.id);

-- -----------------------------------------------------------------------------
-- Team members — expanded roles, invitations, PIN-based POS switching
-- -----------------------------------------------------------------------------

alter table team_members add column if not exists status text not null default 'active';
alter table team_members add column if not exists invited_email citext;
alter table team_members add column if not exists invited_by uuid references app_users (id) on delete set null;
alter table team_members add column if not exists invite_token_hash text;
alter table team_members add column if not exists invite_expires_at timestamptz;
alter table team_members add column if not exists accepted_at timestamptz;
alter table team_members add column if not exists display_name text;
alter table team_members add column if not exists pos_pin_hash text;
alter table team_members add column if not exists default_location_id uuid references locations (id) on delete set null;
alter table team_members add column if not exists last_active_at timestamptz;
alter table team_members add column if not exists updated_at timestamptz not null default now();

-- user_id is null for a pending invitation, so the old NOT NULL-ish assumption
-- and the (business_id, user_id) unique index both need relaxing.
alter table team_members alter column user_id drop not null;

do $$ begin
  alter table team_members drop constraint team_members_role_check;
exception when undefined_object then null; end $$;

do $$ begin
  alter table team_members add constraint team_members_role_check
    check (role in ('owner', 'admin', 'manager', 'staff', 'viewer'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table team_members add constraint team_members_status_check
    check (status in ('active', 'invited', 'suspended'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table team_members drop constraint team_members_business_id_user_id_key;
exception when undefined_object then null; end $$;

create unique index if not exists idx_team_members_business_user
  on team_members (business_id, user_id) where user_id is not null;
create unique index if not exists idx_team_members_pending_invite
  on team_members (business_id, invited_email) where user_id is null;
create index if not exists idx_team_members_user on team_members (user_id) where user_id is not null;

drop trigger if exists trg_team_members_updated_at on team_members;
create trigger trg_team_members_updated_at before update on team_members
  for each row execute function fidelio_touch_updated_at();

-- Every business owner must exist as an active team member; the original
-- signup flow created it in application code, which silently drifted.
insert into team_members (business_id, user_id, role, status, accepted_at)
select b.id, b.owner_id, 'owner', 'active', now()
from businesses b
where b.owner_id is not null
  and not exists (
    select 1 from team_members t where t.business_id = b.id and t.user_id = b.owner_id
  );

update team_members set role = 'owner', status = 'active'
where user_id is not null
  and exists (
    select 1 from businesses b where b.id = team_members.business_id and b.owner_id = team_members.user_id
  );

-- -----------------------------------------------------------------------------
-- Audit log — who did what, required for SOC2-style reviews and GDPR art. 30
-- -----------------------------------------------------------------------------

create table if not exists audit_log (
  id bigserial primary key,
  business_id uuid references businesses (id) on delete cascade,
  actor_type text not null check (actor_type in ('user', 'api_key', 'system', 'customer')),
  actor_id text,
  actor_email text,
  action text not null,
  resource_type text,
  resource_id text,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_log_business_created on audit_log (business_id, created_at desc);
create index if not exists idx_audit_log_resource on audit_log (resource_type, resource_id);
create index if not exists idx_audit_log_action on audit_log (business_id, action, created_at desc);

-- -----------------------------------------------------------------------------
-- Rate limiting — authoritative counters shared across serverless instances
-- -----------------------------------------------------------------------------

create table if not exists rate_limits (
  key text primary key,
  count int not null default 0,
  window_started_at timestamptz not null default now(),
  reset_at timestamptz not null
);

create index if not exists idx_rate_limits_reset on rate_limits (reset_at);

create or replace function fidelio_rate_limit(
  p_key text,
  p_limit int,
  p_window_seconds int
)
returns table (allowed boolean, current_count int, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_count int;
  v_reset timestamptz;
begin
  insert into rate_limits as rl (key, count, window_started_at, reset_at)
  values (p_key, 1, v_now, v_now + make_interval(secs => p_window_seconds))
  on conflict (key) do update
    set count = case when rl.reset_at <= v_now then 1 else rl.count + 1 end,
        window_started_at = case when rl.reset_at <= v_now then v_now else rl.window_started_at end,
        reset_at = case
          when rl.reset_at <= v_now then v_now + make_interval(secs => p_window_seconds)
          else rl.reset_at
        end
  returning rl.count, rl.reset_at into v_count, v_reset;

  return query select v_count <= p_limit, v_count, v_reset;
end;
$$;

-- -----------------------------------------------------------------------------
-- Jobs — transactional outbox so nothing heavy runs inside a web request
--
-- Campaign sends, wallet pushes, webhook deliveries and AI batch work are all
-- enqueued here and drained by a worker. This is what stops a 5,000-customer
-- campaign from timing out mid-send and double-emailing on retry.
-- -----------------------------------------------------------------------------

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'dead')),
  priority int not null default 100,
  run_after timestamptz not null default now(),
  attempts int not null default 0,
  max_attempts int not null default 5,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  /* Callers pass a stable key so an at-least-once trigger can't enqueue twice. */
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_jobs_claimable on jobs (status, run_after, priority)
  where status = 'pending';
create index if not exists idx_jobs_business on jobs (business_id, created_at desc);
create unique index if not exists idx_jobs_idempotency on jobs (idempotency_key)
  where idempotency_key is not null;

drop trigger if exists trg_jobs_updated_at on jobs;
create trigger trg_jobs_updated_at before update on jobs
  for each row execute function fidelio_touch_updated_at();

-- Atomically claim a batch. SKIP LOCKED lets many workers run concurrently
-- without contending on the same rows.
create or replace function fidelio_claim_jobs(p_worker text, p_limit int default 25)
returns setof jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    select id from jobs
    where status = 'pending' and run_after <= now()
    order by priority asc, run_after asc
    limit p_limit
    for update skip locked
  )
  update jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         locked_at = now(),
         locked_by = p_worker
    from claimed c
   where j.id = c.id
  returning j.*;
end;
$$;

-- Recover jobs whose worker died mid-flight.
create or replace function fidelio_requeue_stalled_jobs(p_stale_after interval default interval '10 minutes')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update jobs
     set status = case when attempts >= max_attempts then 'dead' else 'pending' end,
         locked_at = null,
         locked_by = null,
         last_error = coalesce(last_error, 'worker timed out')
   where status = 'running' and locked_at < now() - p_stale_after;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- API keys — public REST API access for integrations, Zapier, Make
-- -----------------------------------------------------------------------------

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  /* Only the SHA-256 hash is stored; the plaintext is shown exactly once. */
  key_hash text not null unique,
  key_prefix text not null,
  scopes text[] not null default array['read']::text[],
  environment text not null default 'live' check (environment in ('live', 'test')),
  created_by uuid references app_users (id) on delete set null,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_api_keys_business on api_keys (business_id) where revoked_at is null;

-- -----------------------------------------------------------------------------
-- Webhooks — let merchants and partners build on top of us (stickiness)
-- -----------------------------------------------------------------------------

create table if not exists webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  url text not null check (url ~* '^https://'),
  description text,
  events text[] not null default array['*']::text[],
  secret text not null default encode(gen_random_bytes(32), 'hex'),
  is_active boolean not null default true,
  consecutive_failures int not null default 0,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_webhook_endpoints_business on webhook_endpoints (business_id)
  where is_active;

drop trigger if exists trg_webhook_endpoints_updated_at on webhook_endpoints;
create trigger trg_webhook_endpoints_updated_at before update on webhook_endpoints
  for each row execute function fidelio_touch_updated_at();

create table if not exists webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references webhook_endpoints (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  response_status int,
  response_body text,
  attempts int not null default 0,
  duration_ms int,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index if not exists idx_webhook_deliveries_endpoint on webhook_deliveries (endpoint_id, created_at desc);
create index if not exists idx_webhook_deliveries_business on webhook_deliveries (business_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Integrations — POS / e-commerce / automation connections
-- -----------------------------------------------------------------------------

create table if not exists integrations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  provider text not null check (provider in (
    'stripe', 'square', 'sumup', 'shopify', 'woocommerce', 'lightspeed',
    'zapier', 'make', 'google_reviews', 'mailchimp', 'custom'
  )),
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnected')),
  external_account_id text,
  display_name text,
  /* Provider credentials. Encrypted at rest by the database host; never selected by
     anon/authenticated roles — RLS restricts this table to service role reads
     via SECURITY DEFINER functions only. */
  credentials jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  /* Auto-award loyalty from this provider's purchase events. */
  auto_earn_enabled boolean not null default true,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, provider)
);

create index if not exists idx_integrations_business on integrations (business_id);

drop trigger if exists trg_integrations_updated_at on integrations;
create trigger trg_integrations_updated_at before update on integrations
  for each row execute function fidelio_touch_updated_at();
