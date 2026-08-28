-- Ported from the previous hosted-Postgres provider to standard PostgreSQL.
-- Transformations applied (see docs/POSTGRESQL.md):
--   auth.users            -> app_users            (an ordinary table we own)
--   auth.uid()            -> app_current_user_id()
--   grants to anon / authenticated / service_role -> removed (provider roles)

-- Initial schema. Applied by `pnpm db:migrate` (scripts/migrate.ts) against any
-- PostgreSQL 14+ server. The `fidelio_` prefixes below are historical: migration
-- 000017 renames every one of them to `passimo_`. See its header for why the
-- earlier files are left untouched.
-- Fixes: PostgreSQL substring for random codes; complete RLS for all tables; team access

-- Businesses
create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references app_users(id) on delete cascade,
  name text not null,
  slug text unique not null,
  category text,
  city text,
  logo_url text,
  primary_color text default '#000000',
  accent_color text default '#ffffff',
  text_color text default '#ffffff',
  font text default 'Inter',
  stamp_total int default 10,
  reward_description text,
  geo_alert_radius int default 200,
  geo_lat float,
  geo_lng float,
  win_back_days int default 30,
  created_at timestamptz default now()
);

-- Team members
create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  user_id uuid references app_users(id) on delete cascade,
  role text check (role in ('owner', 'manager', 'staff')) default 'staff',
  created_at timestamptz default now(),
  unique (business_id, user_id)
);

-- Customers (loyalty card holders)
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  email text not null,
  name text,
  birthday date,
  stamp_count int default 0,
  total_stamps_ever int default 0,
  referral_code text unique default lower(substring(md5(random()::text) from 1 for 8)),
  referred_by uuid references customers(id),
  apple_pass_type_id text,
  apple_push_token text,
  google_wallet_object_id text,
  last_visit timestamptz,
  last_winback_email_at timestamptz,
  created_at timestamptz default now(),
  unique (business_id, email)
);

-- Stamp events
create table if not exists stamp_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  customer_id uuid references customers(id) on delete cascade,
  given_by uuid references app_users(id),
  stamps_given int default 1,
  ticket_amount float,
  note text,
  created_at timestamptz default now()
);

-- Rewards redeemed
create table if not exists reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  customer_id uuid references customers(id) on delete cascade,
  redeemed_by uuid references app_users(id),
  created_at timestamptz default now()
);

-- Campaigns
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  name text not null,
  type text check (type in ('manual', 'birthday', 'winback', 'double_stamp', 'promo')),
  status text check (status in ('draft', 'scheduled', 'active', 'completed')) default 'draft',
  message text,
  scheduled_at timestamptz,
  double_stamp_multiplier int default 2,
  birthday_bonus_enabled boolean default false,
  birthday_bonus_stamps int default 1,
  target_segment text check (target_segment in ('all', 'active', 'inactive', 'birthday')),
  reach_count int default 0,
  sent_count int default 0,
  created_at timestamptz default now()
);

-- Gift cards
create table if not exists gift_cards (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  code text unique default lower(substring(md5(random()::text) from 1 for 12)),
  purchaser_email text,
  recipient_email text,
  initial_value float,
  remaining_value float,
  redeemed_at timestamptz,
  created_at timestamptz default now()
);

-- NPS responses
create table if not exists nps_responses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  customer_id uuid references customers(id) on delete cascade,
  score int check (score between 1 and 5),
  created_at timestamptz default now()
);

-- Indexes for analytics and cron jobs
create index if not exists idx_customers_business on customers (business_id);
create index if not exists idx_customers_last_visit on customers (last_visit);
create index if not exists idx_customers_birthday on customers (birthday);
create index if not exists idx_stamp_events_business_created on stamp_events (business_id, created_at desc);
create index if not exists idx_campaigns_business_type on campaigns (business_id, type, status);

-- RLS
alter table businesses enable row level security;
alter table team_members enable row level security;
alter table customers enable row level security;
alter table stamp_events enable row level security;
alter table reward_redemptions enable row level security;
alter table campaigns enable row level security;
alter table gift_cards enable row level security;
alter table nps_responses enable row level security;

-- Businesses: owner full access
drop policy if exists "owner access" on businesses;
create policy "owner access" on businesses
  for all using (owner_id = app_current_user_id());

-- Team members: read own rows + read team for businesses you own
drop policy if exists "team read" on team_members;
drop policy if exists "team self read" on team_members;
drop policy if exists "owner team manage" on team_members;

create policy "team self read" on team_members
  for select using (user_id = app_current_user_id());

create policy "team read" on team_members
  for select using (
    business_id in (
      select id from businesses where owner_id = app_current_user_id()
    )
  );

create policy "owner team manage" on team_members
  for all using (
    business_id in (select id from businesses where owner_id = app_current_user_id())
  );

-- Customers: business staff can read/write
drop policy if exists "staff customer access" on customers;
create policy "staff customer access" on customers
  for all using (
    business_id in (
      select business_id from team_members where user_id = app_current_user_id()
      union
      select id from businesses where owner_id = app_current_user_id()
    )
  );

drop policy if exists "staff stamp access" on stamp_events;
create policy "staff stamp access" on stamp_events
  for all using (
    business_id in (
      select business_id from team_members where user_id = app_current_user_id()
      union select id from businesses where owner_id = app_current_user_id()
    )
  );

drop policy if exists "staff campaign access" on campaigns;
create policy "staff campaign access" on campaigns
  for all using (
    business_id in (
      select business_id from team_members where user_id = app_current_user_id()
      union select id from businesses where owner_id = app_current_user_id()
    )
  );

drop policy if exists "staff reward access" on reward_redemptions;
create policy "staff reward access" on reward_redemptions
  for all using (
    business_id in (
      select business_id from team_members where user_id = app_current_user_id()
      union select id from businesses where owner_id = app_current_user_id()
    )
  );

drop policy if exists "staff gift card access" on gift_cards;
create policy "staff gift card access" on gift_cards
  for all using (
    business_id in (
      select business_id from team_members where user_id = app_current_user_id()
      union select id from businesses where owner_id = app_current_user_id()
    )
  );

drop policy if exists "staff nps access" on nps_responses;
create policy "staff nps access" on nps_responses
  for all using (
    business_id in (
      select business_id from team_members where user_id = app_current_user_id()
      union select id from businesses where owner_id = app_current_user_id()
    )
  );
