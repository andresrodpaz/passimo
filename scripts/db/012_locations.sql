-- =============================================================================
-- 012 — Locations and geofences
--
-- A geofence needs a centre. Every proximity feature in the product is built on
-- `locations.lat/lng`, so a location that was never geocoded makes lock-screen
-- relevance, nearby suggestions and entry triggers silently inert — with no error
-- anywhere, because "no customer was nearby" and "there is nowhere to be near"
-- produce identical logs.
-- =============================================================================

\pset pager off

\echo
\echo '=== Every location ============================================================'

select
  b.name as business,
  b.plan,
  l.name as location,
  l.is_default as primary_site,
  l.is_visible as visible,
  l.city,
  l.postal_code,
  l.country,
  l.lat,
  l.lng,
  l.geocode_source,
  l.geocoded_at::date as geocoded,
  l.geofence_enabled as geofence,
  l.notification_radius_m as radius_m,
  l.secondary_radius_m as second_radius_m,
  l.trigger_on_entry as on_entry,
  l.trigger_on_exit as on_exit,
  l.trigger_on_dwell as on_dwell,
  l.dwell_minutes as dwell_min,
  l.timezone,
  (l.opening_hours is not null) as has_hours,
  (l.beacon_uuid is not null) as has_beacon,
  l.archived_at::date as archived
from locations l
join businesses b on b.id = l.business_id
order by b.name, l.sort_order, l.name;

\echo
\echo '=== Exactly one primary location per workspace ================================'
-- The default location is what a scan is attributed to when staff do not pick
-- one, and what the wallet pass names. Two is ambiguous; none means every scan
-- lands nowhere.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as workspaces_without_exactly_one_primary
from (
  select b.id
  from businesses b
  where b.archived_at is null
  group by b.id
  having (
    select count(*) from locations l
    where l.business_id = b.id and l.is_default and l.archived_at is null
  ) <> 1
) offenders;

select
  b.name as business,
  (select count(*) from locations l where l.business_id = b.id and l.is_default and l.archived_at is null) as primaries,
  (select count(*) from locations l where l.business_id = b.id and l.archived_at is null) as total
from businesses b
where b.archived_at is null
  and (select count(*) from locations l where l.business_id = b.id and l.is_default and l.archived_at is null) <> 1
order by b.name;

\echo
\echo '=== Geocoding coverage ========================================================'
-- The number that decides whether proximity works at all.

select
  b.name as business,
  b.plan,
  count(*) as locations,
  count(*) filter (where l.lat is not null and l.lng is not null) as geocoded,
  count(*) filter (where l.lat is null or l.lng is null) as not_geocoded,
  count(*) filter (where l.geofence_enabled) as geofence_on,
  count(*) filter (where l.geofence_enabled and (l.lat is null or l.lng is null)) as geofence_on_but_no_coordinates,
  case
    when count(*) filter (where l.geofence_enabled and (l.lat is null or l.lng is null)) > 0 then 'FAIL'
    when count(*) filter (where l.lat is null) > 0 then 'WARNING'
    else 'PASS'
  end as status
from locations l
join businesses b on b.id = l.business_id
where l.archived_at is null
group by b.name, b.plan
order by status desc, b.plan;

\echo
\echo '=== Coordinates that are not where the business is ============================'
-- `0, 0` is in the Gulf of Guinea, and it is what a failed geocode writes when
-- nothing validates the result. Out-of-range values are a latitude and longitude
-- swapped, which puts a Madrid café in the Indian Ocean.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as implausible_coordinates
from locations
where archived_at is null
  and lat is not null
  and lng is not null
  and (
    (abs(lat) < 0.01 and abs(lng) < 0.01)
    or lat < -90 or lat > 90
    or lng < -180 or lng > 180
  );

select b.name as business, l.name as location, l.lat, l.lng, l.city, l.geocode_source
from locations l
join businesses b on b.id = l.business_id
where l.archived_at is null
  and l.lat is not null
  and (
    (abs(l.lat) < 0.01 and abs(l.lng) < 0.01)
    or l.lat < -90 or l.lat > 90
    or l.lng < -180 or l.lng > 180
  );

\echo
\echo '=== Geofence radii ============================================================'
-- Too small and a customer walking past never triggers; too large and everybody in
-- the city gets a notification, which is how a merchant earns an uninstall.

select
  case
    when count(*) filter (where l.notification_radius_m <= 0 or l.notification_radius_m > 20000) > 0 then 'FAIL'
    when count(*) filter (where l.notification_radius_m < 50) > 0 then 'WARNING'
    else 'PASS'
  end as status,
  count(*) as geofenced_locations,
  min(l.notification_radius_m) as smallest_radius_m,
  max(l.notification_radius_m) as largest_radius_m,
  count(*) filter (where l.notification_radius_m < 50) as under_50m,
  count(*) filter (where l.notification_radius_m > 5000) as over_5km
from locations l
where l.archived_at is null and l.geofence_enabled;

select b.name as business, l.name as location, l.notification_radius_m, l.secondary_radius_m
from locations l
join businesses b on b.id = l.business_id
where l.archived_at is null
  and l.geofence_enabled
  and (
    l.notification_radius_m is null
    or l.notification_radius_m <= 0
    or l.notification_radius_m < 50
    or l.notification_radius_m > 20000
    or (l.secondary_radius_m is not null and l.secondary_radius_m <= l.notification_radius_m)
  )
order by b.name;

\echo
\echo '=== Geofences with no trigger ================================================='
-- Enabled, geocoded, radius set, and no entry, exit or dwell trigger — so it
-- never fires. The merchant has done everything except the one switch that
-- matters.

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as geofences_with_no_trigger_enabled
from locations
where archived_at is null
  and geofence_enabled
  and not trigger_on_entry
  and not trigger_on_exit
  and not trigger_on_dwell;

\echo
\echo '=== Dwell configuration ======================================================='
-- A dwell trigger with no minute count fires immediately, which makes it an entry
-- trigger with extra steps.

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as dwell_triggers_with_no_duration
from locations
where archived_at is null
  and trigger_on_dwell
  and (dwell_minutes is null or dwell_minutes <= 0);

\echo
\echo '=== Locations against the plan''s limit ========================================'

with limits(plan, allowed) as (
  values ('lapsed', 1), ('starter', 1), ('growth', 5), ('pro', 15), ('business', null::int), ('trial', 15)
)
select
  case
    when l.allowed is not null and used.locations > l.allowed then 'FAIL'
    else 'PASS'
  end as status,
  b.name as business,
  b.plan,
  used.locations,
  coalesce(l.allowed::text, 'unlimited') as allowed
from businesses b
join limits l on l.plan = b.plan
join lateral (
  select count(*) as locations from locations lo
  where lo.business_id = b.id and lo.archived_at is null
) used on true
where b.archived_at is null
order by status desc, b.plan;

\echo
\echo '=== Timezones ================================================================='
-- Send windows, quiet hours and "today" in analytics are all resolved in the
-- location''s timezone. A null one falls back to the workspace, which is right for
-- a single-city business and wrong the moment there are two.

select
  case
    when count(*) filter (where l.timezone is not null and l.timezone not in (select name from pg_timezone_names)) > 0 then 'FAIL'
    when count(*) filter (where l.timezone is null) > 0 then 'WARNING'
    else 'PASS'
  end as status,
  count(*) as locations,
  count(*) filter (where l.timezone is null) as without_a_timezone,
  count(*) filter (where l.timezone is not null and l.timezone not in (select name from pg_timezone_names)) as invalid_timezone
from locations l
where l.archived_at is null;

\echo
\echo '=== Opening hours ============================================================='
-- Not required, but a location with no hours cannot answer "are you open now?" on
-- the join page or suppress a notification outside trading hours.

select
  b.name as business,
  count(*) as locations,
  count(*) filter (where l.opening_hours is not null) as with_hours,
  count(*) filter (where l.opening_hours is null) as without_hours
from locations l
join businesses b on b.id = l.business_id
where l.archived_at is null
group by b.name
order by b.name;

\echo
\echo '=== Orphans and cross-tenant links ============================================'

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as locations_with_no_workspace
from locations l
where not exists (select 1 from businesses b where b.id = l.business_id);

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as customers_signed_up_at_another_workspace_location
from customers c
join locations l on l.id = c.signup_location_id
where l.business_id <> c.business_id;

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as team_members_scoped_to_another_workspace_location
from team_members t
join locations l on l.id = t.default_location_id
where l.business_id <> t.business_id;

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as ledger_entries_at_another_workspace_location
from loyalty_ledger le
join locations l on l.id = le.location_id
where l.business_id <> le.business_id;
