-- Ported from the previous hosted-Postgres provider to standard PostgreSQL.
-- Transformations applied (see docs/POSTGRESQL.md):
--   auth.users            -> app_users            (an ordinary table we own)
--   auth.uid()            -> app_current_user_id()
--   grants to anon / authenticated / service_role -> removed (provider roles)

-- =============================================================================
-- 000003 — CRM
--
-- The customer record becomes the product's centre of gravity: identity,
-- consent (GDPR), behavioural rollups (RFM / CLV / churn), tags, notes,
-- duplicate merging, and saved segments that everything else targets.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Customers
-- -----------------------------------------------------------------------------

alter table customers add column if not exists updated_at timestamptz not null default now();
alter table customers add column if not exists first_name text;
alter table customers add column if not exists last_name text;
alter table customers add column if not exists phone text;
alter table customers add column if not exists locale text;
alter table customers add column if not exists timezone text;
alter table customers add column if not exists anniversary date;
alter table customers add column if not exists avatar_url text;
alter table customers add column if not exists notes_count int not null default 0;
alter table customers add column if not exists is_vip boolean not null default false;
alter table customers add column if not exists status text not null default 'active';
alter table customers add column if not exists source text not null default 'qr';
alter table customers add column if not exists signup_location_id uuid references locations (id) on delete set null;
alter table customers add column if not exists external_ids jsonb not null default '{}'::jsonb;
alter table customers add column if not exists custom_fields jsonb not null default '{}'::jsonb;

-- Consent (GDPR art. 6/7). Storing *when* and *how* consent was captured is the
-- part auditors ask for, and the original schema had none of it.
alter table customers add column if not exists consent_email boolean not null default true;
alter table customers add column if not exists consent_sms boolean not null default false;
alter table customers add column if not exists consent_whatsapp boolean not null default false;
alter table customers add column if not exists consent_push boolean not null default true;
alter table customers add column if not exists consent_marketing boolean not null default false;
alter table customers add column if not exists consent_updated_at timestamptz;
alter table customers add column if not exists consent_source text;
alter table customers add column if not exists consent_ip inet;
alter table customers add column if not exists terms_accepted_at timestamptz;

-- GDPR lifecycle
alter table customers add column if not exists anonymized_at timestamptz;
alter table customers add column if not exists deletion_requested_at timestamptz;
alter table customers add column if not exists merged_into_customer_id uuid references customers (id) on delete set null;

-- Behavioural rollups, maintained by fidelio_recompute_customer_stats().
alter table customers add column if not exists first_visit_at timestamptz;
alter table customers add column if not exists visit_count int not null default 0;
alter table customers add column if not exists lifetime_spend numeric(14, 2) not null default 0;
alter table customers add column if not exists average_ticket numeric(14, 2) not null default 0;
alter table customers add column if not exists last_purchase_at timestamptz;
alter table customers add column if not exists days_between_visits numeric(10, 2);
alter table customers add column if not exists rfm_recency int;
alter table customers add column if not exists rfm_frequency int;
alter table customers add column if not exists rfm_monetary int;
alter table customers add column if not exists rfm_segment text;
alter table customers add column if not exists churn_risk numeric(5, 4);
alter table customers add column if not exists predicted_clv numeric(14, 2);
alter table customers add column if not exists stats_updated_at timestamptz;

-- Wallet / push identities
alter table customers add column if not exists google_wallet_saved_at timestamptz;
alter table customers add column if not exists apple_pass_serial text;
alter table customers add column if not exists apple_device_library_id text;
alter table customers add column if not exists web_push_subscription jsonb;
alter table customers add column if not exists wallet_auth_token text;

do $$ begin
  alter table customers add constraint customers_status_check
    check (status in ('active', 'blocked', 'anonymized'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table customers add constraint customers_source_check
    check (source in ('qr', 'manual', 'import', 'api', 'pos', 'referral', 'web', 'integration'));
exception when duplicate_object then null; end $$;

-- Email should be case-insensitive: "Ana@x.com" and "ana@x.com" are one person.
-- The old schema allowed both to exist as separate loyalty accounts.
alter table customers alter column email type citext;

-- Phone is a second identity for POS lookup; unique per business when present.
create unique index if not exists idx_customers_business_phone
  on customers (business_id, phone) where phone is not null;

create index if not exists idx_customers_business_status
  on customers (business_id, status) where status = 'active';
create index if not exists idx_customers_business_created
  on customers (business_id, created_at desc);
create index if not exists idx_customers_last_visit_business
  on customers (business_id, last_visit desc nulls last);
create index if not exists idx_customers_vip on customers (business_id) where is_vip;
create index if not exists idx_customers_rfm on customers (business_id, rfm_segment);
create index if not exists idx_customers_churn on customers (business_id, churn_risk desc nulls last);
create index if not exists idx_customers_referred_by on customers (referred_by);
create index if not exists idx_customers_apple_push
  on customers (apple_push_token) where apple_push_token is not null;

-- Fast fuzzy search over name + email for the POS lookup box.
create index if not exists idx_customers_search_trgm
  on customers using gin ((coalesce(name, '') || ' ' || coalesce(email::text, '') || ' ' || coalesce(phone, '')) gin_trgm_ops);

-- Birthday automation needs "is today" without a full scan.
create index if not exists idx_customers_birthday_md
  on customers (business_id, (extract(month from birthday)), (extract(day from birthday)))
  where birthday is not null;

drop trigger if exists trg_customers_updated_at on customers;
create trigger trg_customers_updated_at before update on customers
  for each row execute function fidelio_touch_updated_at();

-- Backfill first/last name from the legacy single name field.
update customers
   set first_name = coalesce(first_name, nullif(split_part(trim(name), ' ', 1), '')),
       last_name = coalesce(
         last_name,
         nullif(trim(substr(trim(name), length(split_part(trim(name), ' ', 1)) + 1)), '')
       )
 where name is not null and (first_name is null or last_name is null);

-- Replace the weak md5-derived referral code with a CSPRNG one.
alter table customers alter column referral_code set default fidelio_random_code(8);

-- -----------------------------------------------------------------------------
-- Tags
-- -----------------------------------------------------------------------------

create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  color text not null default '#64748b',
  description text,
  created_at timestamptz not null default now(),
  unique (business_id, name)
);

create table if not exists customer_tags (
  customer_id uuid not null references customers (id) on delete cascade,
  tag_id uuid not null references tags (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  tagged_by uuid references app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (customer_id, tag_id)
);

create index if not exists idx_customer_tags_tag on customer_tags (tag_id);
create index if not exists idx_customer_tags_business on customer_tags (business_id);

-- -----------------------------------------------------------------------------
-- Notes — the "remember that Ana is allergic to nuts" feature staff actually use
-- -----------------------------------------------------------------------------

create table if not exists customer_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  author_id uuid references app_users (id) on delete set null,
  author_name text,
  body text not null check (length(body) between 1 and 5000),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customer_notes_customer on customer_notes (customer_id, created_at desc);

drop trigger if exists trg_customer_notes_updated_at on customer_notes;
create trigger trg_customer_notes_updated_at before update on customer_notes
  for each row execute function fidelio_touch_updated_at();

-- Keep the denormalised counter honest without an application round trip.
create or replace function fidelio_sync_notes_count()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    update customers set notes_count = notes_count + 1 where id = new.customer_id;
  elsif tg_op = 'DELETE' then
    update customers set notes_count = greatest(0, notes_count - 1) where id = old.customer_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_customer_notes_count on customer_notes;
create trigger trg_customer_notes_count
  after insert or delete on customer_notes
  for each row execute function fidelio_sync_notes_count();

-- -----------------------------------------------------------------------------
-- Activity events — the single behavioural fact table
--
-- Everything a customer does lands here: visits, purchases, signups, referrals,
-- redemptions, reviews. Analytics, automations and the loyalty engine all read
-- from this one table instead of five half-overlapping ones.
-- -----------------------------------------------------------------------------

create table if not exists activity_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid references customers (id) on delete cascade,
  location_id uuid references locations (id) on delete set null,
  type text not null check (type in (
    'signup', 'visit', 'purchase', 'earn', 'redeem', 'referral',
    'review', 'survey', 'tier_change', 'gift_card', 'message', 'wallet_add', 'custom'
  )),
  amount numeric(14, 2),
  currency text,
  quantity int,
  source text not null default 'app' check (source in (
    'app', 'pos', 'api', 'import', 'automation', 'integration', 'wallet', 'web'
  )),
  /* Provider event id. Combined with source it makes ingestion idempotent, so
     a Stripe webhook retry cannot award points twice. */
  external_id text,
  staff_user_id uuid references app_users (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_activity_business_occurred
  on activity_events (business_id, occurred_at desc);
create index if not exists idx_activity_customer_occurred
  on activity_events (customer_id, occurred_at desc);
create index if not exists idx_activity_business_type_occurred
  on activity_events (business_id, type, occurred_at desc);
create unique index if not exists idx_activity_external
  on activity_events (business_id, source, external_id)
  where external_id is not null;

-- -----------------------------------------------------------------------------
-- Segments — reusable, dynamic audience definitions
--
-- `definition` holds a typed filter tree compiled to SQL server-side
-- (lib/segments/compile.ts). Storing the definition rather than a frozen list
-- means a segment stays accurate as customers move in and out of it.
-- -----------------------------------------------------------------------------

create table if not exists segments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  description text,
  /* System segments ship with every account and cannot be deleted. */
  is_system boolean not null default false,
  key text,
  definition jsonb not null default '{"match":"all","conditions":[]}'::jsonb,
  cached_count int,
  last_computed_at timestamptz,
  created_by uuid references app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, name)
);

create index if not exists idx_segments_business on segments (business_id);

drop trigger if exists trg_segments_updated_at on segments;
create trigger trg_segments_updated_at before update on segments
  for each row execute function fidelio_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Imports — CSV onboarding is how merchants migrate off a competitor
-- -----------------------------------------------------------------------------

create table if not exists customer_imports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  filename text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  total_rows int not null default 0,
  imported_rows int not null default 0,
  updated_rows int not null default 0,
  skipped_rows int not null default 0,
  errors jsonb not null default '[]'::jsonb,
  mapping jsonb not null default '{}'::jsonb,
  created_by uuid references app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_customer_imports_business on customer_imports (business_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Data subject requests (GDPR art. 15 / 17)
-- -----------------------------------------------------------------------------

create table if not exists data_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid references customers (id) on delete set null,
  email citext not null,
  kind text not null check (kind in ('export', 'delete')),
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'completed', 'rejected')),
  verification_token_hash text,
  requested_ip inet,
  result_url text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_data_requests_business on data_requests (business_id, created_at desc);
