-- Ported from the previous hosted-Postgres provider to standard PostgreSQL.
-- Transformations applied (see docs/POSTGRESQL.md):
--   auth.users            -> app_users            (an ordinary table we own)
--   auth.uid()            -> app_current_user_id()
--   grants to anon / authenticated / service_role -> removed (provider roles)

-- =============================================================================
-- 000005 — Marketing & messaging
--
-- Multi-channel campaigns (email / SMS / WhatsApp / push / wallet), always-on
-- automations, a per-recipient message log with delivery + engagement tracking,
-- suppression lists, and storage for AI-generated insights.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Campaigns (upgraded from the original 5-column table)
-- -----------------------------------------------------------------------------

alter table campaigns add column if not exists updated_at timestamptz not null default now();
alter table campaigns add column if not exists description text;
alter table campaigns add column if not exists channels text[] not null default array['email']::text[];
alter table campaigns add column if not exists segment_id uuid references segments (id) on delete set null;
alter table campaigns add column if not exists audience_filter jsonb;
alter table campaigns add column if not exists subject text;
alter table campaigns add column if not exists preheader text;
alter table campaigns add column if not exists body_html text;
alter table campaigns add column if not exists body_text text;
alter table campaigns add column if not exists sms_body text;
alter table campaigns add column if not exists whatsapp_body text;
alter table campaigns add column if not exists push_title text;
alter table campaigns add column if not exists push_body text;
alter table campaigns add column if not exists wallet_message text;
alter table campaigns add column if not exists cta_label text;
alter table campaigns add column if not exists cta_url text;
alter table campaigns add column if not exists attached_reward_id uuid references rewards (id) on delete set null;
alter table campaigns add column if not exists bonus_amount numeric(14, 2);
alter table campaigns add column if not exists program_id uuid references loyalty_programs (id) on delete set null;
alter table campaigns add column if not exists timezone text;
alter table campaigns add column if not exists send_window_start time;
alter table campaigns add column if not exists send_window_end time;
alter table campaigns add column if not exists started_at timestamptz;
alter table campaigns add column if not exists completed_at timestamptz;
alter table campaigns add column if not exists created_by uuid references app_users (id) on delete set null;
alter table campaigns add column if not exists generated_by_ai boolean not null default false;
alter table campaigns add column if not exists ai_prompt text;

-- Delivery + engagement counters, updated by the messaging pipeline.
alter table campaigns add column if not exists delivered_count int not null default 0;
alter table campaigns add column if not exists failed_count int not null default 0;
alter table campaigns add column if not exists opened_count int not null default 0;
alter table campaigns add column if not exists clicked_count int not null default 0;
alter table campaigns add column if not exists unsubscribed_count int not null default 0;
-- Attributed outcome: visits and revenue within the attribution window.
alter table campaigns add column if not exists attributed_visits int not null default 0;
alter table campaigns add column if not exists attributed_revenue numeric(14, 2) not null default 0;
alter table campaigns add column if not exists attribution_window_days int not null default 14;
alter table campaigns add column if not exists estimated_cost numeric(12, 4) not null default 0;

do $$ begin
  alter table campaigns drop constraint campaigns_type_check;
exception when undefined_object then null; end $$;

do $$ begin
  alter table campaigns add constraint campaigns_type_check
    check (type in (
      'manual', 'birthday', 'winback', 'double_stamp', 'promo',
      'welcome', 'anniversary', 'milestone', 'referral', 'review_request',
      'reward_reminder', 'expiry_warning', 'tier_upgrade', 'nps'
    ));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table campaigns drop constraint campaigns_status_check;
exception when undefined_object then null; end $$;

do $$ begin
  alter table campaigns add constraint campaigns_status_check
    check (status in ('draft', 'scheduled', 'sending', 'active', 'paused', 'completed', 'failed', 'cancelled'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table campaigns drop constraint campaigns_target_segment_check;
exception when undefined_object then null; end $$;

create index if not exists idx_campaigns_business_status
  on campaigns (business_id, status, created_at desc);
create index if not exists idx_campaigns_scheduled
  on campaigns (scheduled_at) where status = 'scheduled';

drop trigger if exists trg_campaigns_updated_at on campaigns;
create trigger trg_campaigns_updated_at before update on campaigns
  for each row execute function fidelio_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Automations — always-on journeys, the feature merchants never turn off
-- -----------------------------------------------------------------------------

create table if not exists automations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default false,

  trigger text not null check (trigger in (
    'customer_joined',      -- welcome series
    'visit_recorded',
    'purchase_recorded',
    'reward_unlocked',      -- "you can claim now"
    'reward_redeemed',
    'birthday',
    'anniversary',          -- signup anniversary
    'inactivity',           -- win-back
    'balance_expiring',
    'tier_upgraded',
    'referral_qualified',
    'nps_detractor',        -- service recovery
    'nps_promoter',         -- ask for a public review
    'membership_renewal'
  )),
  /* Trigger tuning: inactivity days, expiry warning days, tier level, … */
  trigger_config jsonb not null default '{}'::jsonb,
  /* Wait this long after the trigger before acting. */
  delay_minutes int not null default 0,
  /* Extra eligibility on top of the trigger. */
  segment_id uuid references segments (id) on delete set null,
  conditions jsonb not null default '{"match":"all","conditions":[]}'::jsonb,

  /* Ordered list of actions: send_message | grant_reward | grant_balance |
     add_tag | set_vip | notify_staff | webhook. */
  actions jsonb not null default '[]'::jsonb,

  /* Don't re-enrol the same customer more often than this. */
  cooldown_days int not null default 30,
  /* Respect the business quiet hours before sending. */
  respect_quiet_hours boolean not null default true,

  enrolled_count int not null default 0,
  completed_count int not null default 0,
  attributed_visits int not null default 0,
  attributed_revenue numeric(14, 2) not null default 0,

  created_by uuid references app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_automations_business_trigger
  on automations (business_id, trigger) where is_active;

drop trigger if exists trg_automations_updated_at on automations;
create trigger trg_automations_updated_at before update on automations
  for each row execute function fidelio_touch_updated_at();

create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  automation_id uuid not null references automations (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'running', 'completed', 'skipped', 'failed', 'cancelled')),
  scheduled_for timestamptz not null default now(),
  trigger_event_id uuid references activity_events (id) on delete set null,
  skip_reason text,
  error text,
  actions_result jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_automation_runs_due
  on automation_runs (status, scheduled_for) where status = 'scheduled';
create index if not exists idx_automation_runs_customer
  on automation_runs (automation_id, customer_id, created_at desc);
create index if not exists idx_automation_runs_business
  on automation_runs (business_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Message templates — reusable, brandable, AI-editable
-- -----------------------------------------------------------------------------

create table if not exists message_templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses (id) on delete cascade,
  /* business_id null = built-in template available to every account. */
  key text not null,
  name text not null,
  channel text not null check (channel in ('email', 'sms', 'whatsapp', 'push', 'wallet')),
  subject text,
  body text not null,
  locale text not null default 'es',
  variables text[] not null default array[]::text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_message_templates_key
  on message_templates (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid), key, channel, locale);

-- -----------------------------------------------------------------------------
-- Messages — one row per recipient per send
--
-- This is what makes campaign analytics, deliverability debugging, frequency
-- capping and per-channel cost reporting possible at all.
-- -----------------------------------------------------------------------------

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid references customers (id) on delete cascade,
  campaign_id uuid references campaigns (id) on delete set null,
  automation_id uuid references automations (id) on delete set null,
  automation_run_id uuid references automation_runs (id) on delete set null,

  channel text not null check (channel in ('email', 'sms', 'whatsapp', 'push', 'wallet')),
  /* Denormalised so a deleted customer still leaves a deliverability record. */
  recipient text not null,
  subject text,
  body_preview text,

  status text not null default 'queued' check (status in (
    'queued', 'sent', 'delivered', 'opened', 'clicked',
    'bounced', 'failed', 'skipped', 'unsubscribed'
  )),
  provider text,
  provider_message_id text,
  error text,
  skip_reason text,
  cost numeric(10, 5) not null default 0,

  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  /* Cheap idempotency for automation retries. */
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_business_created on messages (business_id, created_at desc);
create index if not exists idx_messages_campaign on messages (campaign_id, status);
create index if not exists idx_messages_customer on messages (customer_id, created_at desc);
create index if not exists idx_messages_provider_id on messages (provider_message_id)
  where provider_message_id is not null;
create unique index if not exists idx_messages_idempotency
  on messages (business_id, idempotency_key) where idempotency_key is not null;
-- Frequency capping: "how many marketing messages has this person had this week?"
create index if not exists idx_messages_frequency_cap
  on messages (customer_id, channel, sent_at desc) where sent_at is not null;

-- -----------------------------------------------------------------------------
-- Suppressions — hard bounces, complaints and unsubscribes, per channel
-- Sending to a suppressed address is both illegal and reputation-destroying,
-- so this is enforced in the dispatcher, not left to campaign authors.
-- -----------------------------------------------------------------------------

create table if not exists suppressions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  channel text not null check (channel in ('email', 'sms', 'whatsapp', 'push', 'all')),
  /* Lower-cased email or E.164 phone. */
  destination citext not null,
  reason text not null check (reason in ('unsubscribed', 'bounced', 'complained', 'manual', 'invalid')),
  customer_id uuid references customers (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id, channel, destination)
);

create index if not exists idx_suppressions_lookup on suppressions (business_id, destination);

-- -----------------------------------------------------------------------------
-- AI insights — durable, reviewable, dismissible recommendations
-- -----------------------------------------------------------------------------

create table if not exists ai_insights (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  kind text not null check (kind in (
    'churn_risk', 'campaign_suggestion', 'reward_optimization', 'anomaly',
    'segment_suggestion', 'pricing', 'summary', 'review_theme'
  )),
  title text not null,
  body text not null,
  severity text not null default 'info' check (severity in ('info', 'opportunity', 'warning', 'critical')),
  /* Estimated euro impact — what makes a merchant act. */
  estimated_impact numeric(14, 2),
  confidence numeric(4, 3),
  /* Machine-actionable payload: prefilled campaign, rule change, segment. */
  action jsonb,
  related_customer_ids uuid[],
  status text not null default 'new' check (status in ('new', 'accepted', 'dismissed', 'expired')),
  dismissed_by uuid references app_users (id) on delete set null,
  model text,
  generated_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_insights_business
  on ai_insights (business_id, status, generated_at desc);

-- -----------------------------------------------------------------------------
-- In-app notifications for the merchant
-- -----------------------------------------------------------------------------

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  user_id uuid references app_users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user
  on notifications (user_id, created_at desc) where read_at is null;
create index if not exists idx_notifications_business on notifications (business_id, created_at desc);
