-- =============================================================================
-- 000011 — Wallet device registry + performance indexes
--
-- Apple Wallet push only works if the pass web service is implemented and each
-- device registration is stored. Without this table the original code could
-- only ever push to one device, and only if a token happened to be written by
-- an unauthenticated endpoint.
-- =============================================================================

create table if not exists wallet_registrations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  platform text not null default 'apple' check (platform in ('apple', 'google')),
  /* Apple: deviceLibraryIdentifier. Google: object id. */
  device_id text not null,
  pass_type_id text,
  serial_number text,
  push_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (device_id, serial_number)
);

create index if not exists idx_wallet_registrations_customer on wallet_registrations (customer_id);
create index if not exists idx_wallet_registrations_serial on wallet_registrations (serial_number);
create index if not exists idx_wallet_registrations_business on wallet_registrations (business_id);

drop trigger if exists trg_wallet_registrations_updated_at on wallet_registrations;
create trigger trg_wallet_registrations_updated_at before update on wallet_registrations
  for each row execute function fidelio_touch_updated_at();

alter table wallet_registrations enable row level security;
drop policy if exists "tenant read" on wallet_registrations;
create policy "tenant read" on wallet_registrations
  for select using (fidelio_has_business_access(business_id));

-- Devices poll "what changed since X"; this needs to be cheap.
create index if not exists idx_customers_updated_at on customers (business_id, updated_at desc);

-- A per-customer wallet auth token backs the pass web service. Passes issued
-- before this migration get one on next download.
update customers
   set wallet_auth_token = encode(gen_random_bytes(24), 'hex')
 where wallet_auth_token is null;

create index if not exists idx_customers_wallet_token
  on customers (wallet_auth_token) where wallet_auth_token is not null;

-- -----------------------------------------------------------------------------
-- Hot-path indexes discovered while wiring the dashboard
-- -----------------------------------------------------------------------------

-- Campaign performance panel: messages grouped by campaign and status.
create index if not exists idx_messages_campaign_status_created
  on messages (campaign_id, status, created_at desc) where campaign_id is not null;

-- "Rewards ready to claim" list in the POS.
create index if not exists idx_reward_redemptions_claimed_customer
  on reward_redemptions (customer_id, status) where status = 'claimed';

-- Ledger history pane on a customer profile.
create index if not exists idx_ledger_customer_program
  on loyalty_ledger (customer_id, program_id, created_at desc);

-- Activity feed on the overview page.
create index if not exists idx_activity_business_recent
  on activity_events (business_id, created_at desc);

-- Referral leaderboard.
create index if not exists idx_referrals_rewarded
  on referrals (business_id, referrer_customer_id) where status = 'rewarded';

-- Job dashboard / queue health.
create index if not exists idx_jobs_status_created on jobs (status, created_at desc);
