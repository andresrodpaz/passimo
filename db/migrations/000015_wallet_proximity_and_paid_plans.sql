-- Ported from the previous hosted-Postgres provider to standard PostgreSQL.
-- Transformations applied (see docs/POSTGRESQL.md):
--   auth.users            -> app_users            (an ordinary table we own)
--   auth.uid()            -> app_current_user_id()
--   grants to anon / authenticated / service_role -> removed (provider roles)

-- =============================================================================
-- 000015 — Wallet proximity, merchant-configurable geofencing, paid-only plans
-- =============================================================================
--
-- Three concerns, all of them product-shaping:
--
--   1. **Proximity is the reason a wallet pass beats an app.** A pass that
--      surfaces on the lock screen when someone is fifty metres from the door is
--      the only marketing channel a café gets for free, and it needs merchant
--      configuration — radius, triggers, hours, message, eligibility — or it is
--      a support ticket per merchant. Everything a merchant can change lives in
--      these tables; the environment holds only credentials.
--
--   2. **Every proximity feature has to be measurable.** `wallet_events` is a
--      single append-only funnel: suggestion → impression → click → visit →
--      redemption, with the revenue attributed to it. Without one table holding
--      the whole funnel, "did the notification work?" becomes unanswerable.
--
--   3. **There is no free plan any more.** `free` becomes `lapsed` (readable,
--      not writable, nothing deleted) and `enterprise` becomes `business`.
--
-- Design notes:
--
--   * Geofence configuration is per *location*, with a per-business default, so
--     a chain can set 150 m everywhere and 400 m for the one store in a mall.
--   * Campaign eligibility is stored as data, not code: dates, weekdays, times,
--     locations, segment, tier, points, visits, plus a free-form `eligibility`
--     object for rules the UI grows into. The evaluator is pure and unit-tested.
--   * `proximity_rules` is the no-code IF/THEN builder. It is deliberately a
--     separate table from `automations`: those react to loyalty events over
--     hours or days, these react to a device crossing a circle in seconds, and
--     conflating them would give merchants one confusing screen instead of two
--     obvious ones.
--   * Beacons are modelled but optional. The columns cost nothing and their
--     absence would mean a schema migration the day a merchant buys hardware.

-- -----------------------------------------------------------------------------
-- 0. Plan catalogue: paid-only
-- -----------------------------------------------------------------------------

do $$ begin
  alter table businesses drop constraint if exists businesses_plan_check;
exception when undefined_object then null;
end $$;

-- Order matters: widen the constraint before rewriting values.
update businesses set plan = 'lapsed'   where plan = 'free';
update businesses set plan = 'business' where plan = 'enterprise';

alter table businesses
  add constraint businesses_plan_check
  check (plan in ('trial', 'lapsed', 'starter', 'growth', 'pro', 'business'));

-- -----------------------------------------------------------------------------
-- 1. Platform administrators
-- -----------------------------------------------------------------------------
--
-- Deliberately its own table rather than a flag on `app_users`: granting
-- someone platform access is an auditable event with an author and a scope, and
-- revoking it must not depend on editing an identity row. `scopes` keeps the
-- door open for read-only support staff without another migration.

create table if not exists platform_admins (
  user_id uuid primary key references app_users (id) on delete cascade,
  email citext not null,
  display_name text,
  scopes text[] not null default array['*']::text[],
  granted_by uuid references app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create index if not exists idx_platform_admins_email on platform_admins (email);

alter table platform_admins enable row level security;
-- No policy: reachable only through the service role. A platform admin reading
-- the table with their own JWT would be a privilege-escalation surface for no
-- product benefit.

create or replace function fidelio_is_platform_admin(p_user_id uuid default app_current_user_id())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from platform_admins where user_id = p_user_id);
$$;


-- Impersonation is a support tool and therefore the most dangerous button in
-- the product. Every use is recorded before it starts, with a reason, and
-- expires on its own so a forgotten session cannot be resumed a week later.
create table if not exists admin_impersonations (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references app_users (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  reason text not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,
  ip text,
  user_agent text
);

create index if not exists idx_admin_impersonations_admin
  on admin_impersonations (admin_user_id, started_at desc);
create index if not exists idx_admin_impersonations_business
  on admin_impersonations (business_id, started_at desc);

alter table admin_impersonations enable row level security;

-- -----------------------------------------------------------------------------
-- 2. Store locations — everything a merchant can configure about a site
-- -----------------------------------------------------------------------------

alter table locations add column if not exists address_line2 text;
alter table locations add column if not exists region text;
alter table locations add column if not exists email text;
alter table locations add column if not exists description text;
alter table locations add column if not exists external_ref text;
alter table locations add column if not exists sort_order int not null default 0;

-- Visibility is separate from archiving: a merchant closing for renovation wants
-- the site to stop appearing on passes and the join page without losing its
-- history, staff assignments or scan attribution.
alter table locations add column if not exists is_visible boolean not null default true;

-- Opening hours as `{"mon":[["09:00","18:00"]], ...}`. Multiple ranges per day
-- because split shifts (a bakery closing 14:00–17:00) are the common case in the
-- markets this product sells into, not an exception.
alter table locations add column if not exists opening_hours jsonb not null default '{}'::jsonb;
alter table locations add column if not exists timezone_offset_minutes int;

-- Geofencing, per location. `geo_radius_m` (migration 2) stays as the pass
-- relevance radius; these add the trigger semantics around it.
alter table locations add column if not exists geofence_enabled boolean not null default true;
alter table locations add column if not exists notification_radius_m int;
alter table locations add column if not exists secondary_radius_m int;
alter table locations add column if not exists trigger_on_entry boolean not null default true;
alter table locations add column if not exists trigger_on_exit boolean not null default false;
alter table locations add column if not exists trigger_on_dwell boolean not null default false;
alter table locations add column if not exists dwell_minutes int not null default 5;

-- Lock-screen copy. Apple shows `relevantText` when a pass becomes relevant;
-- letting the merchant write it per site is the difference between "You're near
-- Madrid Coffee" and "Your free flat white is waiting on Calle Mayor".
alter table locations add column if not exists relevant_text text;

-- iBeacon triple. Optional, and unused until a merchant owns hardware.
alter table locations add column if not exists beacon_uuid text;
alter table locations add column if not exists beacon_major int;
alter table locations add column if not exists beacon_minor int;

-- Geocoding provenance, so a merchant can see whether coordinates came from
-- their typing or from Google, and re-geocode when an address changes.
alter table locations add column if not exists google_place_id text;
alter table locations add column if not exists geocode_source text;
alter table locations add column if not exists geocoded_at timestamptz;

do $$ begin
  alter table locations
    add constraint locations_radius_bounds
    check (
      (notification_radius_m is null or notification_radius_m between 50 and 50000)
      and (secondary_radius_m is null or secondary_radius_m between 50 and 50000)
      and dwell_minutes between 1 and 720
    );
exception when duplicate_object then null;
end $$;

create index if not exists idx_locations_visible
  on locations (business_id, sort_order)
  where archived_at is null and is_visible;

-- Proximity resolution scans "which of my sites is near this point". A bounding
-- box on (lat, lng) is what the query planner can actually use without PostGIS,
-- and the exact distance is then computed in the application.
create index if not exists idx_locations_coords
  on locations (business_id, lat, lng)
  where archived_at is null and lat is not null and lng is not null;

-- -----------------------------------------------------------------------------
-- 3. Wallet settings — one row per business, every toggle a merchant owns
-- -----------------------------------------------------------------------------

create table if not exists wallet_settings (
  business_id uuid primary key references businesses (id) on delete cascade,

  -- Master switches
  proximity_enabled boolean not null default true,
  geofencing_enabled boolean not null default true,
  beacons_enabled boolean not null default false,

  -- Wallet suggestions
  apple_lock_screen_suggestions boolean not null default true,
  google_wallet_suggestions boolean not null default true,
  nearby_recommendations boolean not null default true,
  automatic_pass_updates boolean not null default true,
  dynamic_pass_content boolean not null default true,
  reward_notifications boolean not null default true,
  loyalty_reminders boolean not null default true,
  /* Apple caps pass relevance at 10 locations; this is the merchant's cap. */
  max_relevant_locations int not null default 10 check (max_relevant_locations between 1 and 10),

  -- Defaults inherited by every location that does not override them
  default_radius_m int not null default 200 check (default_radius_m between 50 and 50000),
  default_dwell_minutes int not null default 5 check (default_dwell_minutes between 1 and 720),
  max_notifications_per_day int not null default 2 check (max_notifications_per_day between 0 and 20),
  min_hours_between_notifications int not null default 6
    check (min_hours_between_notifications between 0 and 168),

  -- Quiet hours in the business's local time. Nobody wants a coffee push at
  -- 04:00, and one badly-timed notification costs the pass permanently.
  quiet_hours_start smallint not null default 22 check (quiet_hours_start between 0 and 23),
  quiet_hours_end smallint not null default 8 check (quiet_hours_end between 0 and 23),
  respect_quiet_hours boolean not null default true,

  -- Branding defaults for notification and pass rendering
  notification_emoji text,
  notification_title text,
  notification_message text,
  notification_cta text,
  brand_color text,
  brand_text_color text,
  logo_url text,
  hero_image_url text,
  pass_expiration_days int check (pass_expiration_days is null or pass_expiration_days between 1 and 3650),

  -- Which industry template was applied, for support and for the UI's
  -- "customised since" state.
  applied_template text,
  applied_template_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_wallet_settings_updated_at on wallet_settings;
create trigger trg_wallet_settings_updated_at before update on wallet_settings
  for each row execute function fidelio_touch_updated_at();

-- Every existing business gets defaults, so the settings screen never has to
-- render an "unconfigured" state and the resolver never has to handle a null row.
insert into wallet_settings (business_id)
select id from businesses
on conflict (business_id) do nothing;

-- -----------------------------------------------------------------------------
-- 4. Proximity campaigns
-- -----------------------------------------------------------------------------

create table if not exists proximity_campaigns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  /* Preset it was created from — drives the icon and the default copy. */
  kind text not null default 'custom' check (kind in (
    'welcome', 'happy_hour', 'double_points', 'birthday', 'weekend',
    'lunch', 'coffee_morning', 'vip_event', 'seasonal', 'win_back',
    'reward_ready', 'new_location', 'custom'
  )),
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'active', 'paused', 'ended')),
  description text,

  -- Trigger
  trigger text not null default 'entry' check (trigger in ('entry', 'exit', 'dwell', 'nearby', 'manual')),
  radius_m int check (radius_m is null or radius_m between 50 and 50000),
  dwell_minutes int check (dwell_minutes is null or dwell_minutes between 1 and 720),

  -- Schedule. Times are local to the location, which is what a merchant means
  -- by "happy hour at 18:00" for a chain spanning two time zones.
  starts_on date,
  ends_on date,
  weekdays smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
  start_time time,
  end_time time,

  -- Audience
  all_locations boolean not null default true,
  segment_id uuid references segments (id) on delete set null,
  min_tier_level int,
  min_points numeric(14,2),
  min_visits int,
  max_days_since_visit int,
  min_days_since_visit int,
  vip_only boolean not null default false,
  /* Room to grow without a migration; evaluated by lib/wallet/eligibility.ts. */
  eligibility jsonb not null default '{}'::jsonb,

  -- Notification content (merchant-authored, fully personalised)
  title text not null,
  message text not null,
  emoji text,
  cta_label text,
  cta_url text,
  reward_description text,
  image_url text,
  background_color text,
  text_color text,
  logo_url text,
  expires_at timestamptz,

  -- Delivery guards
  priority int not null default 0,
  cooldown_hours int not null default 24 check (cooldown_hours between 0 and 8760),
  max_sends_per_customer int,
  channels text[] not null default array['wallet']::text[],

  -- Denormalised counters, incremented by the event recorder. Reading a funnel
  -- for a dashboard card should not scan the event table.
  sent_count int not null default 0,
  impression_count int not null default 0,
  click_count int not null default 0,
  visit_count int not null default 0,
  redemption_count int not null default 0,
  revenue_cents bigint not null default 0,

  created_by uuid references app_users (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint proximity_campaigns_window check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create index if not exists idx_proximity_campaigns_business
  on proximity_campaigns (business_id, status, priority desc)
  where archived_at is null;

create index if not exists idx_proximity_campaigns_active
  on proximity_campaigns (business_id, trigger)
  where status = 'active' and archived_at is null;

drop trigger if exists trg_proximity_campaigns_updated_at on proximity_campaigns;
create trigger trg_proximity_campaigns_updated_at before update on proximity_campaigns
  for each row execute function fidelio_touch_updated_at();

-- Location scoping. `all_locations = true` means "every visible site", and the
-- join table is only consulted when it is false — so adding a location does not
-- silently exclude it from a chain-wide campaign.
create table if not exists proximity_campaign_locations (
  campaign_id uuid not null references proximity_campaigns (id) on delete cascade,
  location_id uuid not null references locations (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  primary key (campaign_id, location_id)
);

create index if not exists idx_proximity_campaign_locations_location
  on proximity_campaign_locations (location_id);

-- -----------------------------------------------------------------------------
-- 5. Automation rules — the no-code IF/THEN builder
-- -----------------------------------------------------------------------------

create table if not exists proximity_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  /* Lower runs first; the first rule with `stop_on_match` wins. */
  priority int not null default 0,
  stop_on_match boolean not null default false,

  /*
   * `conditions` is `{ all: [...] }` or `{ any: [...] }` where each leaf is
   * `{ fact, op, value }`. Storing the tree rather than compiled SQL is what
   * lets the same definition drive the visual builder, the plain-language
   * summary the merchant reads back, and the evaluator.
   */
  conditions jsonb not null default '{"all":[]}'::jsonb,
  /* `[{ type, ...params }]`, the same action vocabulary the UI offers. */
  actions jsonb not null default '[]'::jsonb,

  cooldown_hours int not null default 24 check (cooldown_hours between 0 and 8760),
  /* Which preset it came from, so the gallery can show "already added". */
  template_key text,

  match_count int not null default 0,
  last_matched_at timestamptz,

  created_by uuid references app_users (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_proximity_rules_business
  on proximity_rules (business_id, priority)
  where is_active and archived_at is null;

drop trigger if exists trg_proximity_rules_updated_at on proximity_rules;
create trigger trg_proximity_rules_updated_at before update on proximity_rules
  for each row execute function fidelio_touch_updated_at();

-- -----------------------------------------------------------------------------
-- 6. Wallet events — one funnel table for every proximity feature
-- -----------------------------------------------------------------------------

create table if not exists wallet_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid references customers (id) on delete set null,
  location_id uuid references locations (id) on delete set null,
  campaign_id uuid references proximity_campaigns (id) on delete set null,
  rule_id uuid references proximity_rules (id) on delete set null,

  type text not null check (type in (
    'geofence_enter', 'geofence_exit', 'geofence_dwell',
    'wallet_suggestion', 'notification_sent', 'notification_impression',
    'notification_click', 'wallet_open',
    'pass_installed', 'pass_updated', 'pass_removed',
    'store_visit', 'reward_redeemed', 'offer_viewed'
  )),
  platform text not null default 'unknown' check (platform in ('apple', 'google', 'web', 'unknown')),

  /* Distance at the moment the event fired — the honest way to report whether
     a 200 m radius is actually the radius that converts. */
  distance_m int,
  /* Revenue attributed to this event, in minor units. Only ever set by the
     server from a real ledger entry; never by a client. */
  revenue_cents bigint not null default 0,
  /* For conversion timing: which notification did this visit follow? */
  source_event_id uuid references wallet_events (id) on delete set null,

  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_wallet_events_business_time
  on wallet_events (business_id, occurred_at desc);
create index if not exists idx_wallet_events_type
  on wallet_events (business_id, type, occurred_at desc);
create index if not exists idx_wallet_events_campaign
  on wallet_events (campaign_id, type, occurred_at desc)
  where campaign_id is not null;
create index if not exists idx_wallet_events_customer
  on wallet_events (customer_id, occurred_at desc)
  where customer_id is not null;
create index if not exists idx_wallet_events_location
  on wallet_events (location_id, type, occurred_at desc)
  where location_id is not null;

-- -----------------------------------------------------------------------------
-- 7. Notification delivery ledger
-- -----------------------------------------------------------------------------
--
-- Separate from `wallet_events` on purpose: events are an append-only analytics
-- stream, this is mutable delivery state (queued → sent → failed) and the thing
-- the frequency caps are enforced against.

create table if not exists wallet_notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  campaign_id uuid references proximity_campaigns (id) on delete set null,
  rule_id uuid references proximity_rules (id) on delete set null,
  location_id uuid references locations (id) on delete set null,

  channel text not null default 'wallet' check (channel in ('wallet', 'push', 'email', 'sms')),
  platform text not null default 'unknown' check (platform in ('apple', 'google', 'web', 'unknown')),
  status text not null default 'queued' check (status in ('queued', 'sent', 'skipped', 'failed')),
  skip_reason text,

  title text not null,
  message text not null,
  emoji text,
  cta_label text,
  cta_url text,

  /* One row per (campaign, customer, trigger occurrence). The unique index on
     this column is what makes a duplicate geofence crossing — which phones emit
     constantly at the boundary — a no-op instead of a second notification. */
  dedupe_key text not null,

  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_wallet_notifications_dedupe
  on wallet_notifications (business_id, dedupe_key);
create index if not exists idx_wallet_notifications_customer
  on wallet_notifications (customer_id, created_at desc);
create index if not exists idx_wallet_notifications_pending
  on wallet_notifications (business_id, scheduled_for)
  where status = 'queued';

drop trigger if exists trg_wallet_notifications_updated_at on wallet_notifications;
create trigger trg_wallet_notifications_updated_at before update on wallet_notifications
  for each row execute function fidelio_touch_updated_at();

-- -----------------------------------------------------------------------------
-- 8. Customer device positions (opt-in, coarse, short-lived)
-- -----------------------------------------------------------------------------
--
-- Only written when a customer has explicitly granted location on the card page.
-- Coordinates are rounded to ~100 m before storage and the row is replaced, not
-- appended: we need "are they near a store right now", never a movement history.
-- Keeping a trail would be a liability with no product value.

create table if not exists customer_device_positions (
  customer_id uuid primary key references customers (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_m int,
  platform text not null default 'web' check (platform in ('apple', 'google', 'web', 'unknown')),
  /* The site they are currently inside, if any — the dwell timer's anchor. */
  inside_location_id uuid references locations (id) on delete set null,
  entered_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_customer_device_positions_business
  on customer_device_positions (business_id, updated_at desc);

-- -----------------------------------------------------------------------------
-- 9. Counters and analytics
-- -----------------------------------------------------------------------------

-- Increments a campaign's funnel counter. Called by the event recorder, which
-- must never fail the request that triggered it, so it is silent on unknown
-- types rather than raising.
create or replace function fidelio_record_wallet_event(
  p_business_id uuid,
  p_type text,
  p_customer_id uuid default null,
  p_location_id uuid default null,
  p_campaign_id uuid default null,
  p_rule_id uuid default null,
  p_platform text default 'unknown',
  p_distance_m int default null,
  p_revenue_cents bigint default 0,
  p_source_event_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into wallet_events (
    business_id, customer_id, location_id, campaign_id, rule_id,
    type, platform, distance_m, revenue_cents, source_event_id, metadata
  ) values (
    p_business_id, p_customer_id, p_location_id, p_campaign_id, p_rule_id,
    p_type, coalesce(p_platform, 'unknown'), p_distance_m,
    coalesce(p_revenue_cents, 0), p_source_event_id, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  if p_campaign_id is not null then
    update proximity_campaigns
       set sent_count       = sent_count       + (case when p_type = 'notification_sent' then 1 else 0 end),
           impression_count = impression_count + (case when p_type in ('notification_impression', 'wallet_suggestion') then 1 else 0 end),
           click_count      = click_count      + (case when p_type in ('notification_click', 'wallet_open') then 1 else 0 end),
           visit_count      = visit_count      + (case when p_type = 'store_visit' then 1 else 0 end),
           redemption_count = redemption_count + (case when p_type = 'reward_redeemed' then 1 else 0 end),
           revenue_cents    = revenue_cents    + coalesce(p_revenue_cents, 0)
     where id = p_campaign_id;
  end if;

  if p_rule_id is not null and p_type = 'notification_sent' then
    update proximity_rules
       set match_count = match_count + 1,
           last_matched_at = now()
     where id = p_rule_id;
  end if;

  return v_id;
end;
$$;


/*
 * The proximity funnel for a date range, in one round trip.
 *
 * `avg_visit_delay_minutes` is the number a merchant actually asks for — "how
 * long after the notification did they walk in?" — computed from the visit
 * events that carry a `source_event_id` back to a notification. Visits with no
 * attributed source are excluded rather than counted as zero, because a
 * regular's daily coffee is not a conversion.
 */
create or replace function fidelio_proximity_analytics(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  suggestions bigint,
  notifications_sent bigint,
  impressions bigint,
  clicks bigint,
  wallet_opens bigint,
  store_visits bigint,
  redemptions bigint,
  passes_installed bigint,
  passes_removed bigint,
  geofence_entries bigint,
  revenue_cents bigint,
  avg_visit_delay_minutes numeric,
  unique_customers bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select * from wallet_events
     where business_id = p_business_id
       and occurred_at >= p_from
       and occurred_at < p_to
  ),
  delays as (
    select extract(epoch from (visit.occurred_at - source.occurred_at)) / 60.0 as minutes
      from scoped visit
      join wallet_events source on source.id = visit.source_event_id
     where visit.type = 'store_visit'
       and source.type in ('notification_sent', 'notification_impression', 'wallet_suggestion')
       and visit.occurred_at > source.occurred_at
  )
  select
    count(*) filter (where type = 'wallet_suggestion')::bigint,
    count(*) filter (where type = 'notification_sent')::bigint,
    count(*) filter (where type = 'notification_impression')::bigint,
    count(*) filter (where type = 'notification_click')::bigint,
    count(*) filter (where type = 'wallet_open')::bigint,
    count(*) filter (where type = 'store_visit')::bigint,
    count(*) filter (where type = 'reward_redeemed')::bigint,
    count(*) filter (where type = 'pass_installed')::bigint,
    count(*) filter (where type = 'pass_removed')::bigint,
    count(*) filter (where type = 'geofence_enter')::bigint,
    coalesce(sum(revenue_cents), 0)::bigint,
    (select round(avg(minutes)::numeric, 1) from delays),
    count(distinct customer_id)::bigint
  from scoped;
$$;


/*
 * Per-campaign performance, ranked by the number that matters: revenue per
 * notification sent. A campaign with a 40% click rate and no visits is a
 * campaign that annoyed people, and sorting by clicks would hide that.
 */
create or replace function fidelio_proximity_campaign_performance(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  campaign_id uuid,
  name text,
  kind text,
  status text,
  sent bigint,
  impressions bigint,
  clicks bigint,
  visits bigint,
  redemptions bigint,
  revenue_cents bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
         c.name,
         c.kind,
         c.status,
         count(e.id) filter (where e.type = 'notification_sent')::bigint,
         count(e.id) filter (where e.type in ('notification_impression', 'wallet_suggestion'))::bigint,
         count(e.id) filter (where e.type in ('notification_click', 'wallet_open'))::bigint,
         count(e.id) filter (where e.type = 'store_visit')::bigint,
         count(e.id) filter (where e.type = 'reward_redeemed')::bigint,
         coalesce(sum(e.revenue_cents), 0)::bigint
    from proximity_campaigns c
    left join wallet_events e
      on e.campaign_id = c.id
     and e.occurred_at >= p_from
     and e.occurred_at < p_to
   where c.business_id = p_business_id
     and c.archived_at is null
   group by c.id, c.name, c.kind, c.status
   order by coalesce(sum(e.revenue_cents), 0) desc, count(e.id) desc;
$$;


/*
 * Platform-wide totals for the admin console. Deliberately a function rather
 * than a view so it can never be selected through a tenant's JWT.
 */
create or replace function fidelio_platform_overview()
returns table (
  businesses_total bigint,
  businesses_active bigint,
  businesses_trialing bigint,
  businesses_lapsed bigint,
  customers_total bigint,
  scans_last_30d bigint,
  wallet_passes bigint,
  mrr_cents bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from businesses)::bigint,
    (select count(*) from businesses where plan in ('starter','growth','pro','business'))::bigint,
    (select count(*) from businesses where plan = 'trial' and coalesce(trial_ends_at, now()) > now())::bigint,
    (select count(*) from businesses where plan = 'lapsed')::bigint,
    (select count(*) from customers where status <> 'anonymized')::bigint,
    (select count(*) from loyalty_ledger where created_at > now() - interval '30 days')::bigint,
    (select count(*) from wallet_registrations)::bigint,
    (select coalesce(sum(case plan
              when 'starter'  then 500
              when 'growth'   then 1900
              when 'pro'      then 4900
              when 'business' then 9900
              else 0 end), 0) from businesses
      where subscription_status in ('active', 'trialing'))::bigint;
$$;


-- -----------------------------------------------------------------------------
-- 10. Row level security for the new tenant tables
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
  tenant_tables text[] := array[
    'wallet_settings', 'proximity_campaigns', 'proximity_campaign_locations',
    'proximity_rules', 'wallet_events', 'wallet_notifications',
    'customer_device_positions'
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
