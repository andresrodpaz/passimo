-- Ported from the previous hosted-Postgres provider to standard PostgreSQL.
-- Transformations applied (see docs/POSTGRESQL.md):
--   auth.users            -> app_users            (an ordinary table we own)
--   auth.uid()            -> app_current_user_id()
--   grants to anon / authenticated / service_role -> removed (provider roles)

-- =============================================================================
-- 000004 — Loyalty engine
--
-- Replaces the hard-coded "count stamps on the customer row" model with a
-- general engine: many programs per business (stamps, points, cashback, tiers,
-- paid memberships), configurable earning rules, a reward catalogue, and an
-- immutable double-entry ledger with FIFO expiry.
--
-- Why a ledger: balances that live in a single mutable integer are impossible
-- to audit, cannot expire correctly, and lose writes under concurrency — all
-- three were true of the original `customers.stamp_count`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Programs
-- -----------------------------------------------------------------------------

create table if not exists loyalty_programs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  type text not null check (type in ('stamps', 'points', 'cashback', 'membership')),
  is_active boolean not null default true,
  is_default boolean not null default false,

  /* Display */
  unit_singular text not null default 'point',
  unit_plural text not null default 'points',
  description text,

  /* stamps: how many to fill a card. points/cashback: ignored. */
  goal_amount numeric(14, 2),
  /* What the customer gets when a stamps card completes. */
  reward_description text,
  /* Reset the card to zero on completion (classic punch card) or keep going. */
  reset_on_reward boolean not null default true,

  /* cashback: percentage of ticket returned as balance. */
  cashback_percent numeric(6, 3) check (cashback_percent is null or cashback_percent between 0 and 100),
  /* points: monetary value of one point, for CLV and cashback redemption. */
  point_value numeric(12, 4),

  /* Expiry: null = never expires. */
  expiry_months int check (expiry_months is null or expiry_months between 1 and 120),
  /* Warn the customer this many days before their balance expires. */
  expiry_warning_days int not null default 14,

  /* Anti-abuse: ignore repeat earns from the same customer inside the window. */
  earn_cooldown_minutes int not null default 0,
  max_earn_per_day numeric(14, 2),

  tier_enabled boolean not null default false,
  tier_metric text not null default 'lifetime_earned'
    check (tier_metric in ('lifetime_earned', 'lifetime_spend', 'visit_count')),
  /* Rolling window for tier evaluation; null = lifetime. */
  tier_window_days int,

  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_loyalty_programs_business on loyalty_programs (business_id)
  where is_active;
create unique index if not exists idx_loyalty_programs_one_default
  on loyalty_programs (business_id) where is_default;

drop trigger if exists trg_loyalty_programs_updated_at on loyalty_programs;
create trigger trg_loyalty_programs_updated_at before update on loyalty_programs
  for each row execute function fidelio_touch_updated_at();

-- Every existing business keeps working: its legacy stamp card becomes a real
-- program with the same goal and reward text.
insert into loyalty_programs (
  business_id, name, type, is_default, unit_singular, unit_plural,
  goal_amount, reward_description, reset_on_reward
)
select b.id,
       'Stamp card',
       'stamps',
       true,
       'stamp',
       'stamps',
       coalesce(b.stamp_total, 10),
       b.reward_description,
       true
from businesses b
where not exists (select 1 from loyalty_programs p where p.business_id = b.id);

-- -----------------------------------------------------------------------------
-- Tiers
-- -----------------------------------------------------------------------------

create table if not exists program_tiers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  program_id uuid not null references loyalty_programs (id) on delete cascade,
  name text not null,
  level int not null,
  threshold numeric(14, 2) not null default 0,
  earn_multiplier numeric(6, 3) not null default 1 check (earn_multiplier > 0),
  color text not null default '#64748b',
  icon text,
  perks jsonb not null default '[]'::jsonb,
  /* Drop a customer back down if they fall below threshold at re-evaluation. */
  allow_downgrade boolean not null default true,
  created_at timestamptz not null default now(),
  unique (program_id, level)
);

create index if not exists idx_program_tiers_program on program_tiers (program_id, threshold);

-- -----------------------------------------------------------------------------
-- Earning rules — how activity turns into balance
-- -----------------------------------------------------------------------------

create table if not exists earning_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  program_id uuid not null references loyalty_programs (id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  /* Lower runs first; the first matching rule per trigger wins unless stackable. */
  priority int not null default 100,
  stackable boolean not null default false,

  trigger text not null check (trigger in (
    'purchase', 'visit', 'signup', 'birthday', 'anniversary',
    'referral', 'referred_signup', 'review', 'survey', 'milestone', 'manual'
  )),

  award_type text not null default 'fixed' check (award_type in (
    'fixed',          -- flat amount
    'per_currency',   -- award_amount per `per_amount` of spend
    'per_item',       -- award_amount per unit quantity
    'percent'         -- percentage of ticket (cashback)
  )),
  award_amount numeric(14, 4) not null default 1,
  per_amount numeric(14, 4) not null default 1 check (per_amount > 0),
  max_award numeric(14, 2),

  /* Eligibility */
  min_purchase numeric(14, 2),
  /* Milestone trigger: fires when lifetime_earned crosses this value. */
  milestone_threshold numeric(14, 2),
  /* Restrict to given weekdays (0 = Sunday) — "Double stamp Tuesdays". */
  days_of_week int[],
  time_from time,
  time_to time,
  starts_at timestamptz,
  ends_at timestamptz,
  location_ids uuid[],
  tier_ids uuid[],
  segment_id uuid references segments (id) on delete set null,
  cooldown_minutes int not null default 0,
  usage_limit_per_customer int,
  total_usage_limit int,
  usage_count int not null default 0,

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_earning_rules_lookup
  on earning_rules (program_id, trigger, priority) where is_active;
create index if not exists idx_earning_rules_business on earning_rules (business_id);

drop trigger if exists trg_earning_rules_updated_at on earning_rules;
create trigger trg_earning_rules_updated_at before update on earning_rules
  for each row execute function fidelio_touch_updated_at();

-- Baseline rule so a fresh program awards something out of the box.
insert into earning_rules (business_id, program_id, name, trigger, award_type, award_amount)
select p.business_id, p.id, 'Stamp per visit', 'visit', 'fixed', 1
from loyalty_programs p
where p.type = 'stamps'
  and not exists (select 1 from earning_rules r where r.program_id = p.id);

-- -----------------------------------------------------------------------------
-- Reward catalogue
-- -----------------------------------------------------------------------------

create table if not exists rewards (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  program_id uuid references loyalty_programs (id) on delete cascade,
  name text not null,
  description text,
  image_url text,
  /* Balance deducted on redemption. 0 = free (birthday gift, welcome gift). */
  cost numeric(14, 2) not null default 0 check (cost >= 0),
  type text not null default 'free_item' check (type in (
    'free_item', 'percent_off', 'amount_off', 'free_shipping', 'gift_card', 'custom'
  )),
  /* percent_off: 0-100. amount_off / gift_card: currency amount. */
  value numeric(14, 2),
  is_active boolean not null default true,
  /* Only customers at or above this tier can redeem. */
  min_tier_level int,
  /* Restrict to a segment (VIP-only rewards). */
  segment_id uuid references segments (id) on delete set null,
  /* Inventory: null = unlimited. */
  stock int,
  redeemed_count int not null default 0,
  usage_limit_per_customer int,
  /* Redemption code validity once claimed. */
  valid_days int not null default 30,
  starts_at timestamptz,
  ends_at timestamptz,
  /* Reserved for automations: welcome / birthday / anniversary / winback gifts. */
  auto_grant_trigger text check (auto_grant_trigger in (
    'welcome', 'birthday', 'anniversary', 'winback', 'referral', 'milestone', 'tier_upgrade'
  )),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_rewards_business on rewards (business_id, sort_order) where is_active;
create index if not exists idx_rewards_program on rewards (program_id) where is_active;
create index if not exists idx_rewards_auto_grant on rewards (business_id, auto_grant_trigger)
  where auto_grant_trigger is not null and is_active;

drop trigger if exists trg_rewards_updated_at on rewards;
create trigger trg_rewards_updated_at before update on rewards
  for each row execute function fidelio_touch_updated_at();

-- Turn the legacy free-text reward into a real catalogue entry.
insert into rewards (business_id, program_id, name, cost, type)
select p.business_id,
       p.id,
       coalesce(nullif(trim(p.reward_description), ''), 'Free reward'),
       coalesce(p.goal_amount, 10),
       'free_item'
from loyalty_programs p
where p.type = 'stamps'
  and not exists (select 1 from rewards r where r.program_id = p.id);

-- -----------------------------------------------------------------------------
-- Accounts — one balance row per (customer, program)
-- -----------------------------------------------------------------------------

create table if not exists loyalty_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  program_id uuid not null references loyalty_programs (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  balance numeric(14, 2) not null default 0,
  lifetime_earned numeric(14, 2) not null default 0,
  lifetime_redeemed numeric(14, 2) not null default 0,
  /* stamps: how many full cards this customer has completed. */
  rewards_earned int not null default 0,
  tier_id uuid references program_tiers (id) on delete set null,
  tier_since timestamptz,
  last_earn_at timestamptz,
  last_redeem_at timestamptz,
  /* Soonest expiring balance, denormalised for cheap "expiring soon" queries. */
  next_expiry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, customer_id),
  constraint loyalty_accounts_balance_non_negative check (balance >= 0)
);

create index if not exists idx_loyalty_accounts_customer on loyalty_accounts (customer_id);
create index if not exists idx_loyalty_accounts_business_balance
  on loyalty_accounts (business_id, balance desc);
create index if not exists idx_loyalty_accounts_expiry
  on loyalty_accounts (business_id, next_expiry_at)
  where next_expiry_at is not null;

drop trigger if exists trg_loyalty_accounts_updated_at on loyalty_accounts;
create trigger trg_loyalty_accounts_updated_at before update on loyalty_accounts
  for each row execute function fidelio_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Ledger — append-only, the single source of truth for every balance change
-- -----------------------------------------------------------------------------

create table if not exists loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  program_id uuid not null references loyalty_programs (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  account_id uuid not null references loyalty_accounts (id) on delete cascade,

  entry_type text not null check (entry_type in (
    'earn', 'redeem', 'adjust', 'expire', 'reversal', 'transfer_in', 'transfer_out'
  )),
  /* Signed: positive credits the account, negative debits it. */
  amount numeric(14, 2) not null,
  balance_after numeric(14, 2) not null,

  /* FIFO expiry accounting: how much of this credit is still unspent. */
  remaining numeric(14, 2),
  expires_at timestamptz,
  consumed_at timestamptz,

  reason text,
  rule_id uuid references earning_rules (id) on delete set null,
  reward_id uuid references rewards (id) on delete set null,
  event_id uuid references activity_events (id) on delete set null,
  campaign_id uuid,
  location_id uuid references locations (id) on delete set null,
  staff_user_id uuid references app_users (id) on delete set null,
  reverses_entry_id uuid references loyalty_ledger (id) on delete set null,

  /* Callers pass this so a retried POS tap cannot double-award. */
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ledger_account_created on loyalty_ledger (account_id, created_at desc);
create index if not exists idx_ledger_customer_created on loyalty_ledger (customer_id, created_at desc);
create index if not exists idx_ledger_business_created on loyalty_ledger (business_id, created_at desc);
create unique index if not exists idx_ledger_idempotency
  on loyalty_ledger (business_id, idempotency_key) where idempotency_key is not null;
-- Drives both FIFO consumption and the expiry sweep.
create index if not exists idx_ledger_open_credits
  on loyalty_ledger (account_id, expires_at nulls last, created_at)
  where entry_type in ('earn', 'adjust', 'transfer_in') and remaining > 0;

-- The ledger is immutable except for FIFO consumption bookkeeping.
create or replace function fidelio_ledger_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'loyalty_ledger rows are immutable; post a reversal instead';
  end if;
  if new.id is distinct from old.id
     or new.amount is distinct from old.amount
     or new.entry_type is distinct from old.entry_type
     or new.account_id is distinct from old.account_id
     or new.created_at is distinct from old.created_at then
    raise exception 'loyalty_ledger rows are immutable; post a reversal instead';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ledger_guard on loyalty_ledger;
create trigger trg_ledger_guard before update or delete on loyalty_ledger
  for each row execute function fidelio_ledger_guard();

-- -----------------------------------------------------------------------------
-- Reward redemptions (upgraded from the original stub table)
-- -----------------------------------------------------------------------------

alter table reward_redemptions add column if not exists program_id uuid references loyalty_programs (id) on delete set null;
alter table reward_redemptions add column if not exists reward_id uuid references rewards (id) on delete set null;
alter table reward_redemptions add column if not exists location_id uuid references locations (id) on delete set null;
alter table reward_redemptions add column if not exists ledger_entry_id uuid references loyalty_ledger (id) on delete set null;
alter table reward_redemptions add column if not exists cost numeric(14, 2) not null default 0;
alter table reward_redemptions add column if not exists code text;
alter table reward_redemptions add column if not exists status text not null default 'fulfilled';
alter table reward_redemptions add column if not exists expires_at timestamptz;
alter table reward_redemptions add column if not exists fulfilled_at timestamptz;
alter table reward_redemptions add column if not exists cancelled_at timestamptz;
alter table reward_redemptions add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table reward_redemptions add column if not exists updated_at timestamptz not null default now();

do $$ begin
  alter table reward_redemptions add constraint reward_redemptions_status_check
    check (status in ('claimed', 'fulfilled', 'expired', 'cancelled'));
exception when duplicate_object then null; end $$;

update reward_redemptions set code = fidelio_random_code(10) where code is null;
alter table reward_redemptions alter column code set default fidelio_random_code(10);
create unique index if not exists idx_reward_redemptions_code on reward_redemptions (business_id, code);
create index if not exists idx_reward_redemptions_customer
  on reward_redemptions (customer_id, created_at desc);
create index if not exists idx_reward_redemptions_business
  on reward_redemptions (business_id, created_at desc);
create index if not exists idx_reward_redemptions_open
  on reward_redemptions (business_id, status) where status = 'claimed';

drop trigger if exists trg_reward_redemptions_updated_at on reward_redemptions;
create trigger trg_reward_redemptions_updated_at before update on reward_redemptions
  for each row execute function fidelio_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Paid memberships — recurring revenue for the merchant, stickiness for us
-- -----------------------------------------------------------------------------

create table if not exists membership_plans (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  program_id uuid references loyalty_programs (id) on delete set null,
  name text not null,
  description text,
  price numeric(12, 2) not null check (price >= 0),
  currency text not null default 'EUR',
  interval text not null default 'month' check (interval in ('month', 'year')),
  /* Balance granted automatically at the start of each period. */
  included_balance numeric(14, 2) not null default 0,
  earn_multiplier numeric(6, 3) not null default 1,
  perks jsonb not null default '[]'::jsonb,
  stripe_price_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_membership_plans_business on membership_plans (business_id) where is_active;

create table if not exists customer_memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  plan_id uuid not null references membership_plans (id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'past_due', 'cancelled', 'expired')),
  stripe_subscription_id text,
  started_at timestamptz not null default now(),
  current_period_end timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, plan_id)
);

create index if not exists idx_customer_memberships_business
  on customer_memberships (business_id, status);
create index if not exists idx_customer_memberships_renewal
  on customer_memberships (current_period_end) where status = 'active';

-- -----------------------------------------------------------------------------
-- Referrals — tracked on both sides so attribution and payout are auditable
-- -----------------------------------------------------------------------------

create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  referrer_customer_id uuid not null references customers (id) on delete cascade,
  referred_customer_id uuid references customers (id) on delete set null,
  referred_email citext,
  code text not null,
  status text not null default 'pending'
    check (status in ('pending', 'qualified', 'rewarded', 'rejected')),
  /* Referral only pays out after the friend actually transacts — this is what
     stops the self-referral farming the old open endpoint allowed. */
  qualifies_after_events int not null default 1,
  qualifying_event_count int not null default 0,
  qualified_at timestamptz,
  rewarded_at timestamptz,
  referrer_ledger_entry_id uuid references loyalty_ledger (id) on delete set null,
  referred_ledger_entry_id uuid references loyalty_ledger (id) on delete set null,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_referrals_business on referrals (business_id, status);
create index if not exists idx_referrals_referrer on referrals (referrer_customer_id);
create unique index if not exists idx_referrals_unique_referred
  on referrals (business_id, referred_customer_id) where referred_customer_id is not null;

drop trigger if exists trg_referrals_updated_at on referrals;
create trigger trg_referrals_updated_at before update on referrals
  for each row execute function fidelio_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Gift cards (upgraded)
-- -----------------------------------------------------------------------------

alter table gift_cards add column if not exists currency text not null default 'EUR';
alter table gift_cards add column if not exists status text not null default 'active';
alter table gift_cards add column if not exists message text;
alter table gift_cards add column if not exists purchaser_customer_id uuid references customers (id) on delete set null;
alter table gift_cards add column if not exists recipient_customer_id uuid references customers (id) on delete set null;
alter table gift_cards add column if not exists expires_at timestamptz;
alter table gift_cards add column if not exists issued_by uuid references app_users (id) on delete set null;
alter table gift_cards add column if not exists updated_at timestamptz not null default now();

do $$ begin
  alter table gift_cards add constraint gift_cards_status_check
    check (status in ('active', 'depleted', 'expired', 'void'));
exception when duplicate_object then null; end $$;

-- Replace md5-derived codes: a 12-hex-char md5 slice is guessable enough to
-- brute-force stored value.
update gift_cards set code = fidelio_random_code(12) where code is null or code ~ '^[0-9a-f]{12}$';
alter table gift_cards alter column code set default fidelio_random_code(12);
alter table gift_cards alter column initial_value type numeric(14, 2);
alter table gift_cards alter column remaining_value type numeric(14, 2);

create index if not exists idx_gift_cards_business on gift_cards (business_id, status);

drop trigger if exists trg_gift_cards_updated_at on gift_cards;
create trigger trg_gift_cards_updated_at before update on gift_cards
  for each row execute function fidelio_touch_updated_at();

create table if not exists gift_card_transactions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  gift_card_id uuid not null references gift_cards (id) on delete cascade,
  amount numeric(14, 2) not null,
  balance_after numeric(14, 2) not null,
  kind text not null check (kind in ('issue', 'redeem', 'refund', 'void')),
  location_id uuid references locations (id) on delete set null,
  staff_user_id uuid references app_users (id) on delete set null,
  idempotency_key text,
  created_at timestamptz not null default now()
);

create index if not exists idx_gift_card_tx_card on gift_card_transactions (gift_card_id, created_at desc);
create unique index if not exists idx_gift_card_tx_idempotency
  on gift_card_transactions (business_id, idempotency_key) where idempotency_key is not null;

-- -----------------------------------------------------------------------------
-- Surveys — proper NPS (0–10) plus CSAT, replacing the mislabelled 1–5 table
-- -----------------------------------------------------------------------------

create table if not exists surveys (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  type text not null default 'nps' check (type in ('nps', 'csat', 'custom')),
  question text not null default 'How likely are you to recommend us to a friend?',
  follow_up_question text default 'What could we do better?',
  scale_max int not null default 10 check (scale_max in (5, 10)),
  is_active boolean not null default true,
  /* Ask again at most this often, per customer. */
  cooldown_days int not null default 90,
  /* Send automatically N hours after a visit. 0 disables. */
  auto_send_after_hours int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_surveys_business on surveys (business_id) where is_active;

create table if not exists survey_responses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  survey_id uuid references surveys (id) on delete set null,
  customer_id uuid references customers (id) on delete cascade,
  score int not null,
  scale_max int not null default 10,
  comment text,
  /* Filled in by the AI sentiment pass. */
  sentiment text check (sentiment in ('positive', 'neutral', 'negative')),
  themes text[],
  responded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_survey_responses_business
  on survey_responses (business_id, responded_at desc);
create index if not exists idx_survey_responses_customer on survey_responses (customer_id);

-- Migrate the legacy 1–5 NPS rows onto the 0–10 scale, preserving the original
-- scale_max so historical scores are never silently misread.
insert into surveys (business_id, type, scale_max, is_active)
select distinct n.business_id, 'nps', 10, true
from nps_responses n
where not exists (select 1 from surveys s where s.business_id = n.business_id);

insert into survey_responses (business_id, survey_id, customer_id, score, scale_max, responded_at, created_at)
select n.business_id,
       (select s.id from surveys s where s.business_id = n.business_id limit 1),
       n.customer_id,
       n.score,
       5,
       n.created_at,
       n.created_at
from nps_responses n
where not exists (
  select 1 from survey_responses r
  where r.customer_id = n.customer_id and r.created_at = n.created_at
);

-- -----------------------------------------------------------------------------
-- Coalition / partnerships — the network effect layer
--
-- Two local businesses can accept each other's members, run a joint campaign,
-- or hand out cross-offers. Each merchant that joins makes the next one more
-- valuable, which is the whole point.
-- -----------------------------------------------------------------------------

create table if not exists business_partnerships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  partner_business_id uuid not null references businesses (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'declined', 'ended')),
  /* What the partner may do with our members. */
  allow_cross_earn boolean not null default false,
  allow_cross_redeem boolean not null default false,
  share_audience boolean not null default false,
  invited_by uuid references app_users (id) on delete set null,
  accepted_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (business_id <> partner_business_id),
  unique (business_id, partner_business_id)
);

create index if not exists idx_partnerships_partner on business_partnerships (partner_business_id, status);

create table if not exists coalition_offers (
  id uuid primary key default gen_random_uuid(),
  /* Business publishing the offer. */
  business_id uuid not null references businesses (id) on delete cascade,
  partnership_id uuid references business_partnerships (id) on delete cascade,
  title text not null,
  description text,
  reward_id uuid references rewards (id) on delete set null,
  starts_at timestamptz,
  ends_at timestamptz,
  redemption_limit int,
  redeemed_count int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_coalition_offers_business on coalition_offers (business_id) where is_active;
