-- =============================================================================
-- 000000 — Identity: accounts, sessions and single-use tokens
-- =============================================================================
--
-- This is the foundation the rest of the schema hangs off, and it is new: the
-- product previously delegated accounts to a hosted authentication service, so
-- `auth.users` was a table in a schema this repository did not own or migrate.
-- Every `references auth.users (id)` in migrations 1–17 now points at
-- `app_users` here.
--
-- Why it moved:
--
--   * A fresh PostgreSQL database has to be able to initialise from this
--     repository alone. With accounts living in a provider's schema, a restore
--     produced a database full of businesses whose owners did not exist.
--   * Signup provisions an account *and* a workspace *and* an owner membership.
--     With both sides in one database those are one transaction; across a
--     service boundary they are three calls with three failure modes, which is
--     why the old signup path had hand-written compensating deletes.
--   * A merchant who cannot sign in is the highest-severity support ticket a
--     SaaS gets. One place to look beats two.
--
-- It runs first (000000) because everything else references it.

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
--
-- Declared here rather than assumed. A managed provider tends to pre-install
-- these; a plain `postgres:16` container does not, and "works on staging" is not
-- a schema guarantee.
--
--   pgcrypto  gen_random_uuid() for every primary key
--   citext    case-insensitive email, so Ana@shop.com and ana@shop.com are one
--             account rather than two — enforced by the type, not by remembering
--             to lower() at every call site
--   pg_trgm   trigram indexes behind customer search

create extension if not exists "pgcrypto";
create extension if not exists "citext";
create extension if not exists "pg_trgm";

-- -----------------------------------------------------------------------------
-- Accounts
-- -----------------------------------------------------------------------------

create table if not exists app_users (
  id                 uuid primary key default gen_random_uuid(),
  email              citext not null,
  /*
   * Format: scrypt$<N>$<r>$<p>$<salt>$<hash>. Self-describing so the cost factor
   * can be raised without invalidating existing passwords — see
   * lib/auth/password.ts, which upgrades a hash in place on next sign-in.
   */
  password_hash      text not null,
  full_name          text,
  locale             text not null default 'es' check (locale in ('es', 'en')),
  status             text not null default 'active'
                       check (status in ('active', 'suspended', 'deleted')),
  email_verified_at  timestamptz,
  last_login_at      timestamptz,
  /*
   * Per-account online-guessing controls. Route-level rate limiting caps
   * attempts per IP; these cap them per account, which is the axis that matters
   * when the attempts arrive from many addresses.
   */
  failed_login_count int not null default 0,
  locked_until       timestamptz,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- The uniqueness that makes two simultaneous signups with the same address
-- resolve to one account and one 409, rather than a read-then-write race that
-- both requests win.
create unique index if not exists app_users_email_key on app_users (email);
create index if not exists app_users_status_idx on app_users (status)
  where status <> 'active';

-- -----------------------------------------------------------------------------
-- Sessions
-- -----------------------------------------------------------------------------
--
-- Server-side rather than a self-contained token, so that signing out, changing
-- a password or suspending an account takes effect on the next request instead
-- of whenever a token happens to expire.
--
-- `token_hash` stores SHA-256 of the session secret. A database dump therefore
-- contains no replayable logins — the same reason `api_keys` stores hashes.

create table if not exists user_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references app_users (id) on delete cascade,
  token_hash   text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  ip           text,
  user_agent   text
);

create unique index if not exists user_sessions_token_hash_key
  on user_sessions (token_hash);

-- Every authenticated request resolves a session by hash; the device list and
-- the "revoke everything" path both go by user.
create index if not exists user_sessions_user_active_idx
  on user_sessions (user_id, expires_at desc)
  where revoked_at is null;

-- -----------------------------------------------------------------------------
-- Single-use tokens
-- -----------------------------------------------------------------------------
--
-- Email confirmation and password reset. Hashed for the same reason as sessions:
-- a reset link is a live credential until it is used.
--
-- Single-use is enforced by `consumed_at is null` in the update that redeems
-- one, so two simultaneous clicks on the same link update one row and the loser
-- gets nothing.

create table if not exists user_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references app_users (id) on delete cascade,
  purpose     text not null
                check (purpose in ('email_verification', 'password_reset')),
  token_hash  text not null,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create unique index if not exists user_tokens_token_hash_key
  on user_tokens (token_hash);

-- Issuing a token first invalidates the account's outstanding ones of the same
-- purpose, so "send me another link" does not leave the previous one live.
create index if not exists user_tokens_user_purpose_idx
  on user_tokens (user_id, purpose)
  where consumed_at is null;

-- -----------------------------------------------------------------------------
-- app_current_user_id()
-- -----------------------------------------------------------------------------
--
-- The replacement for the provider's `auth.uid()`, referenced by the row-level
-- security policies in migrations 1, 8, 11, 13, 15 and 16.
--
-- Those policies were written for a deployment where browsers held a token and
-- queried the database directly. This application does not work that way and
-- never did in practice: every query has always gone through a Next.js route
-- that resolves an actor and a business context first, over a connection that
-- owns the schema — so the policies were never the thing enforcing isolation.
--
-- The function reads a per-transaction setting rather than a provider-specific
-- JWT claim. Set it and the policies evaluate exactly as they read; leave it
-- unset (the normal case) and it returns null. Migration 000018 explains what
-- was done with the policies themselves and why.

create or replace function app_current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('passimo.current_user_id', true), '')::uuid
$$;

comment on function app_current_user_id() is
  'Current actor for row-level security. Reads the passimo.current_user_id '
  'setting; returns null when unset. Tenant isolation is enforced in the '
  'application layer (lib/auth/context.ts), not by policies — see '
  'docs/SECURITY.md.';

-- -----------------------------------------------------------------------------
-- updated_at
-- -----------------------------------------------------------------------------

create or replace function app_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists app_users_touch on app_users;
create trigger app_users_touch
  before update on app_users
  for each row execute function app_touch_updated_at();
