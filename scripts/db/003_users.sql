-- =============================================================================
-- 003 — Users, sessions and roles
--
-- "Why can't I log in?" answered from the database. Covers account state, the
-- lockout counter, password-hash shape, active sessions, team roles and platform
-- admin grants.
-- =============================================================================

\pset pager off

\echo
\echo '=== Every account ============================================================='

select
  u.email,
  u.full_name,
  u.status,
  u.locale,
  (u.email_verified_at is not null) as verified,
  u.failed_login_count as failed_logins,
  u.locked_until,
  u.last_login_at,
  (select count(*) from user_sessions s where s.user_id = u.id and s.revoked_at is null and s.expires_at > now()) as live_sessions,
  (select count(*) from team_members t where t.user_id = u.id and t.status = 'active') as workspaces,
  (select string_agg(t.role, ', ') from team_members t where t.user_id = u.id and t.status = 'active') as roles,
  exists (select 1 from platform_admins pa where pa.user_id = u.id) as platform_admin,
  (u.metadata ->> 'demo')::boolean as is_demo_account
from app_users u
order by u.created_at;

\echo
\echo '=== Accounts that cannot sign in right now ===================================='
-- The four reasons the login endpoint refuses a correct password. Each one has a
-- different remedy, and the endpoint deliberately does not say which — so this is
-- the only place to find out.

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as blocked_accounts
from app_users
where status <> 'active'
   or (locked_until is not null and locked_until > now())
   or password_hash is null;

\echo '--- Which, and why ---'
select
  u.email,
  case
    when u.password_hash is null then 'no password set — must use the reset link'
    when u.status = 'suspended' then 'suspended — 403 with a support message'
    when u.status <> 'active' then 'status ' || u.status
    when u.locked_until > now() then 'locked until ' || u.locked_until::text || ' after ' || u.failed_login_count || ' failed attempts'
  end as reason
from app_users u
where u.status <> 'active'
   or (u.locked_until is not null and u.locked_until > now())
   or u.password_hash is null
order by u.email;

\echo
\echo '=== Password hash shape ======================================================='
-- Every stored hash must be scrypt in the application''s own encoding. A row that
-- is not is either a hand-inserted account (which will never authenticate) or a
-- migration from another system that was never re-hashed.

select
  case
    when count(*) filter (where password_hash is not null and password_hash not like 'scrypt$%') = 0
      then 'PASS' else 'FAIL'
  end as status,
  count(*) as accounts,
  count(*) filter (where password_hash is null) as without_password,
  count(*) filter (where password_hash like 'scrypt$%') as scrypt,
  count(*) filter (where password_hash is not null and password_hash not like 'scrypt$%') as unrecognised_format,
  -- The full encoding is scrypt$N$r$p$salt$hash, so six segments and no fewer.
  count(*) filter (
    where password_hash like 'scrypt$%'
      and array_length(string_to_array(password_hash, '$'), 1) <> 6
  ) as scrypt_with_wrong_segment_count
from app_users;

\echo
\echo '=== No plaintext or trivially-hashed passwords ================================'
-- A hash of exactly 32 or 64 hex characters is an unsalted MD5 or SHA-256, which
-- is a finding regardless of how it got there.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as suspicious_hashes
from app_users
where password_hash is not null
  and (password_hash ~ '^[0-9a-f]{32}$' or password_hash ~ '^[0-9a-f]{64}$' or password_hash !~ '\$');

\echo
\echo '=== Duplicate emails =========================================================='
-- `app_users.email` is the login identifier. A duplicate means one of the two
-- accounts is unreachable.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as duplicate_emails
from (select lower(email) as email from app_users group by lower(email) having count(*) > 1) d;

\echo
\echo '=== Sessions =================================================================='

select
  case
    when count(*) filter (where revoked_at is null and expires_at < now()) > 500 then 'WARNING'
    else 'PASS'
  end as status,
  count(*) as total,
  count(*) filter (where revoked_at is null and expires_at > now()) as live,
  count(*) filter (where revoked_at is not null) as revoked,
  count(*) filter (where revoked_at is null and expires_at <= now()) as expired_not_cleaned,
  min(created_at) as oldest,
  max(last_used_at) as most_recent_use
from user_sessions;

\echo
\echo '=== Session token storage ====================================================='
-- Sessions must be stored as a hash, never as the token itself: a leaked
-- `user_sessions` dump must not be replayable as a set of live cookies.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as sessions_with_short_or_missing_hash
from user_sessions
where token_hash is null or length(token_hash) < 40;

\echo
\echo '=== Team membership and roles ================================================='

select
  b.name as business,
  b.plan,
  t.role,
  t.status,
  coalesce(u.email, t.invited_email) as person,
  t.display_name,
  (t.pos_pin_hash is not null) as has_pos_pin,
  t.last_active_at
from team_members t
join businesses b on b.id = t.business_id
left join app_users u on u.id = t.user_id
order by b.name, case t.role when 'owner' then 1 when 'manager' then 2 else 3 end, person;

\echo
\echo '=== Team rows that point at nothing ==========================================='
-- An accepted membership with no user, or a pending invite with no email, is a
-- row that grants access to nobody and confuses every "who has access" screen.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as broken_memberships
from team_members t
where (t.user_id is null and t.invited_email is null)
   or (t.user_id is not null and not exists (select 1 from app_users u where u.id = t.user_id))
   or not exists (select 1 from businesses b where b.id = t.business_id);

\echo
\echo '=== One membership per person per workspace ===================================='
-- Two rows for the same person means two roles, and the resolver takes one of
-- them — which is how somebody keeps `viewer` permissions after being promoted.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as duplicated_memberships
from (
  select business_id, user_id
  from team_members
  where user_id is not null
  group by business_id, user_id
  having count(*) > 1
) d;

\echo
\echo '=== Platform admins ==========================================================='
-- Cross-tenant read access. Should be a very short list, and every entry should
-- correspond to a real account.

select
  case when count(*) filter (where u.id is null) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as grants,
  count(*) filter (where u.id is null) as grants_without_an_account
from platform_admins pa
left join app_users u on u.id = pa.user_id;

select pa.email, pa.display_name, pa.scopes, pa.created_at, pa.last_seen_at
from platform_admins pa
order by pa.email;

\echo
\echo '=== Unverified accounts older than a week ====================================='
-- Signed up, never confirmed. Not a bug; a conversion number.

select
  count(*) as unverified_over_7_days,
  min(created_at)::date as oldest
from app_users
where email_verified_at is null and created_at < now() - interval '7 days';
