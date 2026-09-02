-- =============================================================================
-- 002 — Merchants (workspaces)
--
-- Who is on this deployment, on what plan, with how much in the account. The
-- first question after "is the database alive": is there anything in it, and
-- does each workspace look like a working business or an abandoned shell?
-- =============================================================================

\pset pager off

\echo
\echo '=== Every workspace, with what is in it ======================================='

select
  b.plan,
  b.name,
  b.slug,
  b.category,
  b.city,
  b.locale,
  b.currency,
  b.subscription_status as sub_status,
  b.trial_ends_at::date as trial_ends,
  (select count(*) from customers c where c.business_id = b.id and c.anonymized_at is null) as customers,
  (select count(*) from locations l where l.business_id = b.id and l.archived_at is null) as locations,
  (select count(*) from loyalty_programs p where p.business_id = b.id and p.is_active) as programs,
  (select count(*) from rewards r where r.business_id = b.id and r.is_active) as rewards,
  (select count(*) from campaigns cp where cp.business_id = b.id) as campaigns,
  (select count(*) from team_members t where t.business_id = b.id and t.status = 'active') as team,
  b.created_at::date as created,
  b.archived_at::date as archived
from businesses b
order by
  case b.plan
    when 'business' then 1 when 'pro' then 2 when 'growth' then 3
    when 'starter' then 4 when 'trial' then 5 else 6
  end,
  b.name;

\echo
\echo '=== Is every workspace usable? ================================================'
-- A workspace with no program cannot award anything; with no reward it can award
-- but never pay out; with no location its geofences have no centre. Each of
-- these is a merchant who signed up and stopped, which is an activation problem
-- rather than a bug — but a demo database with one is a broken demo.

select
  case
    when b.archived_at is not null then 'PASS'
    when program_count = 0 then 'FAIL'
    when reward_count = 0 or location_count = 0 then 'WARNING'
    else 'PASS'
  end as status,
  b.name,
  b.plan,
  program_count,
  reward_count,
  location_count,
  case
    when b.archived_at is not null then 'archived — skipped'
    when program_count = 0 then 'no active loyalty program: cannot award anything'
    when reward_count = 0 then 'no active reward: can award but never pay out'
    when location_count = 0 then 'no location: proximity and per-site reporting are inert'
    else 'ok'
  end as finding
from businesses b
join lateral (
  select
    (select count(*) from loyalty_programs p where p.business_id = b.id and p.is_active) as program_count,
    (select count(*) from rewards r where r.business_id = b.id and r.is_active) as reward_count,
    (select count(*) from locations l where l.business_id = b.id and l.archived_at is null) as location_count
) counts on true
order by status desc, b.name;

\echo
\echo '=== Exactly one default program per workspace ================================='
-- The earn path resolves "which program" from `is_default`. Two defaults is
-- non-deterministic crediting; none means the POS cannot choose.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as workspaces_with_wrong_default_count
from (
  select b.id
  from businesses b
  where b.archived_at is null
  group by b.id
  having (
    select count(*) from loyalty_programs p
    where p.business_id = b.id and p.is_default and p.is_active
  ) <> 1
) offenders;

\echo '--- The offenders, if any ---'
select b.name, b.plan,
  (select count(*) from loyalty_programs p where p.business_id = b.id and p.is_default and p.is_active) as default_programs
from businesses b
where b.archived_at is null
  and (select count(*) from loyalty_programs p where p.business_id = b.id and p.is_default and p.is_active) <> 1
order by b.name;

\echo
\echo '=== Slug uniqueness and shape ================================================='
-- The slug is the public URL: /join/{slug}. A duplicate makes one workspace
-- unreachable; a slug with a space or an uppercase letter makes a link that
-- works in one browser and 404s in another.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as bad_slugs
from businesses
where slug is null
   or slug = ''
   or slug <> lower(slug)
   or slug ~ '[^a-z0-9-]';

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as duplicate_slugs
from (select slug from businesses group by slug having count(*) > 1) d;

\echo
\echo '=== Owner integrity ==========================================================='
-- Every workspace needs a signed-in human who can pay for it and change the
-- plan. An owner with no `app_users` row is a workspace nobody can administer.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as workspaces_without_a_valid_owner
from businesses b
where b.owner_id is null
   or not exists (select 1 from app_users u where u.id = b.owner_id);

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as workspaces_without_an_active_owner_team_row,
  coalesce(string_agg(name, ', '), 'none') as names
from businesses b
where b.archived_at is null
  and not exists (
    select 1 from team_members t
    where t.business_id = b.id and t.role = 'owner' and t.status = 'active'
  );

\echo
\echo '=== Branding completeness ====================================================='
-- Not a failure: a merchant who has not chosen colours gets defaults that pass
-- contrast. It is a WARNING because an unbranded wallet pass is the single
-- biggest gap between "installed the product" and "showing it to customers".

select
  case
    when primary_color is null and logo_url is null then 'WARNING'
    else 'PASS'
  end as status,
  name,
  plan,
  primary_color,
  accent_color,
  text_color,
  secondary_color,
  (logo_url is not null) as has_logo,
  (cover_url is not null) as has_cover,
  (description is not null) as has_description
from businesses
where archived_at is null
order by status desc, name;

\echo
\echo '=== Onboarding progress ======================================================='

select
  b.name,
  b.plan,
  (b.onboarding_completed_at is not null) as completed,
  o.last_step,
  o.checklist_dismissed_at::date as dismissed,
  b.created_at::date as joined
from businesses b
left join business_onboarding o on o.business_id = b.id
where b.archived_at is null
order by b.name;
