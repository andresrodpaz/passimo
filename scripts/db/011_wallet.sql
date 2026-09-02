-- =============================================================================
-- 011 — Wallet: passes, card design, proximity and events
--
-- The wallet pass is the product's presence on the customer's phone, and it is
-- the part most dependent on credentials the deployment may not have. These
-- queries separate three different things that all look like "wallet is broken":
-- configuration missing, credentials missing, and nobody installing.
-- =============================================================================

\pset pager off

\echo
\echo '=== Card design per workspace ================================================='
-- `wallet_card_designs` is keyed on `business_id`, so exactly one row per
-- workspace. A missing row means the pass builder falls back to platform
-- defaults, which is a working pass with none of the merchant's decisions on it.

select
  b.name as business,
  b.plan,
  (d.business_id is not null) as has_design_row,
  d.template,
  d.card_style,
  d.progress_style,
  d.typography,
  d.background_color as bg,
  d.foreground_color as fg,
  d.accent_color as accent,
  (d.logo_url is not null) as logo,
  (d.hero_image_url is not null) as banner,
  d.show_member_name as name_shown,
  d.show_progress as progress_shown,
  d.show_reward as reward_shown,
  (d.headline is not null) as headline,
  (d.custom_message is not null) as message,
  d.applied_template_at::date as template_applied
from businesses b
left join wallet_card_designs d on d.business_id = b.id
where b.archived_at is null
order by b.plan;

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as workspaces_with_no_card_design_row
from businesses b
where b.archived_at is null
  and not exists (select 1 from wallet_card_designs d where d.business_id = b.id);

\echo
\echo '=== Card colours must be valid hex ============================================'
-- The pass builder writes these straight into the pass; a malformed value
-- produces a pass Apple rejects, and the merchant sees "could not add to Wallet"
-- with no explanation.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as designs_with_a_malformed_colour
from wallet_card_designs
where (background_color is not null and background_color !~* '^#[0-9a-f]{6}$')
   or (foreground_color is not null and foreground_color !~* '^#[0-9a-f]{6}$')
   or (accent_color is not null and accent_color !~* '^#[0-9a-f]{6}$');

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as brand_rows_with_a_malformed_colour
from businesses
where (primary_color is not null and primary_color !~* '^#[0-9a-f]{6}$')
   or (accent_color is not null and accent_color !~* '^#[0-9a-f]{6}$')
   or (text_color is not null and text_color !~* '^#[0-9a-f]{6}$')
   or (secondary_color is not null and secondary_color !~* '^#[0-9a-f]{6}$');

\echo
\echo '=== Brand kit — the single source of business identity ========================'
-- Migration 000021 made `businesses` plus `wallet_card_designs` authoritative for
-- the card face and stopped consulting `wallet_settings.brand_color`. The legacy
-- columns are deliberately *not* dropped — they hold values merchants had already
-- chosen, and the migration copies them forward into a design row.
--
-- So a value here is not corruption. It is a WARNING because it means the
-- workspace has a colour recorded in a place nothing reads, and the only way to
-- tell "copied forward correctly" from "written by something that still thinks
-- this column matters" is whether a design row exists beside it.

select
  case
    when count(*) = 0 then 'PASS'
    when count(*) filter (where d.business_id is null) > 0 then 'FAIL'
    else 'WARNING'
  end as status,
  count(*) as wallet_settings_rows_holding_a_legacy_brand_colour,
  count(*) filter (where d.business_id is null) as without_a_matching_design_row
from wallet_settings ws
left join wallet_card_designs d on d.business_id = ws.business_id
where ws.brand_color is not null or ws.brand_text_color is not null;

\echo
\echo '=== Pass installs ============================================================='
-- What actually landed on a phone. The install rate is the single best measure of
-- whether the join flow works, because a customer who enrolled but did not
-- install will never see a notification.

select
  b.name as business,
  b.plan,
  (select count(*) from customers c where c.business_id = b.id and c.anonymized_at is null) as customers,
  count(*) filter (where w.platform = 'apple') as apple_passes,
  count(*) filter (where w.platform = 'google') as google_passes,
  count(distinct w.customer_id) as customers_with_a_pass,
  round(
    100.0 * count(distinct w.customer_id)
      / greatest((select count(*) from customers c where c.business_id = b.id and c.anonymized_at is null), 1),
    1
  ) as install_rate_pct
from businesses b
left join wallet_registrations w on w.business_id = b.id
where b.archived_at is null
group by b.name, b.plan, b.id
order by b.plan;

\echo
\echo '=== Registrations that cannot be pushed to ===================================='
-- A registration with no push token can never receive an update, so every balance
-- change silently fails to reach that card.

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as registrations_with_no_push_token,
  (select count(*) from wallet_registrations) as total_registrations
from wallet_registrations
where push_token is null or push_token = '';

\echo
\echo '=== Duplicate registrations ==================================================='
-- One device should hold one pass per customer. A duplicate means every push is
-- sent twice, which on Apple''s infrastructure is a throttling risk.

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as duplicated_device_registrations
from (
  select customer_id, platform, device_id
  from wallet_registrations
  where device_id is not null
  group by customer_id, platform, device_id
  having count(*) > 1
) d;

\echo
\echo '=== Wallet settings per workspace ============================================='

select
  b.name as business,
  b.plan,
  s.proximity_enabled as proximity,
  s.geofencing_enabled as geofencing,
  s.beacons_enabled as beacons,
  s.apple_lock_screen_suggestions as apple_lockscreen,
  s.google_wallet_suggestions as google_suggestions,
  s.automatic_pass_updates as auto_updates,
  s.reward_notifications as reward_notifs,
  s.loyalty_reminders as reminders,
  s.default_radius_m as radius_m,
  s.max_notifications_per_day as max_per_day,
  s.min_hours_between_notifications as min_gap_h,
  s.quiet_hours_start || '–' || s.quiet_hours_end as quiet_hours,
  s.respect_quiet_hours as respects_quiet
from businesses b
left join wallet_settings s on s.business_id = b.id
where b.archived_at is null
order by b.plan;

\echo
\echo '=== Wallet features enabled on a plan that does not include them ==============='
-- Geofencing and proximity campaigns are gated on the plan. A settings row that
-- says otherwise is a demo (or a downgrade) showing a merchant something the API
-- will refuse.

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as workspaces_with_a_setting_their_plan_does_not_allow
from businesses b
join wallet_settings s on s.business_id = b.id
where b.plan in ('starter', 'lapsed')
  and (s.geofencing_enabled or s.beacons_enabled);

select b.name as business, b.plan, s.geofencing_enabled, s.beacons_enabled
from businesses b
join wallet_settings s on s.business_id = b.id
where b.plan in ('starter', 'lapsed') and (s.geofencing_enabled or s.beacons_enabled);

\echo
\echo '=== Proximity campaigns ======================================================='

select
  b.name as business,
  b.plan,
  pc.name as campaign,
  pc.kind,
  pc.status,
  pc.trigger,
  pc.radius_m,
  pc.dwell_minutes as dwell,
  pc.starts_on,
  pc.ends_on,
  pc.all_locations,
  pc.vip_only,
  pc.min_points,
  pc.min_visits,
  pc.sent_count as sent,
  pc.impression_count as impressions,
  pc.click_count as clicks,
  pc.visit_count as visits,
  pc.redemption_count as redemptions,
  round(pc.revenue_cents / 100.0, 2) as revenue
from proximity_campaigns pc
join businesses b on b.id = pc.business_id
where pc.archived_at is null
order by b.name, pc.priority desc;

\echo
\echo '=== Proximity campaigns that cannot fire ======================================'

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as inert_active_proximity_campaigns
from proximity_campaigns pc
join wallet_settings s on s.business_id = pc.business_id
where pc.status = 'active'
  and pc.archived_at is null
  and (
    not s.proximity_enabled
    or (pc.ends_on is not null and pc.ends_on < current_date)
    or (pc.radius_m is not null and pc.radius_m <= 0)
    or (not pc.all_locations and not exists (
      select 1 from proximity_campaign_locations pcl where pcl.campaign_id = pc.id
    ))
  );

select
  b.name as business, pc.name as campaign,
  case
    when not s.proximity_enabled then 'proximity is switched off for this workspace'
    when pc.ends_on < current_date then 'ended on ' || pc.ends_on
    when pc.radius_m <= 0 then 'radius is ' || pc.radius_m || ' m'
    else 'scoped to specific locations but none are attached'
  end as finding
from proximity_campaigns pc
join businesses b on b.id = pc.business_id
join wallet_settings s on s.business_id = pc.business_id
where pc.status = 'active'
  and pc.archived_at is null
  and (
    not s.proximity_enabled
    or (pc.ends_on is not null and pc.ends_on < current_date)
    or (pc.radius_m is not null and pc.radius_m <= 0)
    or (not pc.all_locations and not exists (
      select 1 from proximity_campaign_locations pcl where pcl.campaign_id = pc.id
    ))
  )
order by b.name;

\echo
\echo '=== Automation rules (the no-code builder) ===================================='

select
  b.name as business,
  b.plan,
  r.name as rule,
  r.is_active as active,
  r.priority,
  r.template_key,
  -- `conditions` is an object (a match mode plus a list), `actions` is an array.
  -- Counting them needs different functions, and calling `jsonb_array_length` on
  -- the object is an error rather than a zero.
  case
    when jsonb_typeof(r.conditions) = 'array' then jsonb_array_length(r.conditions)
    when jsonb_typeof(r.conditions) = 'object'
      then coalesce(jsonb_array_length(r.conditions -> 'all'), jsonb_array_length(r.conditions -> 'any'), 0)
    else 0
  end as conditions,
  case when jsonb_typeof(r.actions) = 'array' then jsonb_array_length(r.actions) else 0 end as actions,
  r.match_count as matches,
  r.last_matched_at::date as last_match
from proximity_rules r
join businesses b on b.id = r.business_id
where r.archived_at is null
order by b.name, r.priority;

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as rules_with_no_condition_or_no_action
from proximity_rules
where is_active
  and archived_at is null
  and (
    conditions is null
    or actions is null
    or jsonb_typeof(actions) <> 'array'
    or jsonb_array_length(actions) = 0
    or (jsonb_typeof(conditions) = 'array' and jsonb_array_length(conditions) = 0)
    or (
      jsonb_typeof(conditions) = 'object'
      and coalesce(jsonb_array_length(conditions -> 'all'), jsonb_array_length(conditions -> 'any'), 0) = 0
    )
  );

\echo
\echo '=== Wallet event funnel ======================================================='
-- Impression → open → click → visit. A funnel that stops at impression means the
-- notification copy is not working; one with no impressions at all means the
-- geofence never fired.

select
  b.name as business,
  e.type,
  e.platform,
  count(*) as events,
  round(avg(e.distance_m)) as avg_distance_m,
  round(sum(e.revenue_cents) / 100.0, 2) as revenue,
  max(e.occurred_at)::date as most_recent
from wallet_events e
join businesses b on b.id = e.business_id
group by b.name, e.type, e.platform
order by b.name, count(*) desc;

\echo
\echo '=== Wallet notifications ======================================================'

select
  b.name as business,
  n.status,
  count(*) as notifications,
  max(n.created_at)::date as most_recent
from wallet_notifications n
join businesses b on b.id = n.business_id
group by b.name, n.status
order by b.name;

\echo
\echo '=== Pass sync backlog ========================================================='
-- A pass whose balance changed and whose push has not gone out is a card showing
-- yesterday''s number. This is the queue that keeps them honest.

select
  b.name as business,
  count(*) as sync_rows,
  count(*) filter (where s.updated_at < now() - interval '1 hour') as stale_over_1h
from wallet_sync_state s
join businesses b on b.id = s.business_id
group by b.name
order by b.name;

\echo
\echo '=== Cross-tenant wallet rows =================================================='

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as cross_tenant_registrations
from wallet_registrations w
join customers c on c.id = w.customer_id
where c.business_id <> w.business_id;

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as cross_tenant_wallet_events
from wallet_events e
left join customers c on c.id = e.customer_id
left join locations l on l.id = e.location_id
where (c.id is not null and c.business_id <> e.business_id)
   or (l.id is not null and l.business_id <> e.business_id);
