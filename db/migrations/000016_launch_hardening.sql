-- =============================================================================
-- 000016 — Launch hardening: onboarding state, dunning, wallet sync state
-- =============================================================================
--
-- Three things the product needed before it could be run for real money by
-- someone we have never met:
--
--   1. **Onboarding is now three steps, not four.** What the wizard stopped
--      asking for became a dashboard checklist, and a merchant who dismisses it
--      must not meet it again on their next device. Dismissal is a row, not
--      `localStorage`.
--
--   2. **A declined card is a sequence, not an event.** Stripe retries a failed
--      invoice several times over about two weeks. Until now we recorded
--      `past_due` and said nothing, so the first thing a merchant heard about a
--      payment problem was their workspace going quiet. `billing_dunning` tracks
--      where in that sequence each business is, so every merchant gets warned
--      before anything changes and nobody gets warned twice for one attempt.
--
--   3. **Two wallets fail independently.** `walletService.sync()` pushes to Apple
--      and Google concurrently; when one throws, the other still succeeded, and
--      collapsing that into a single boolean loses the only fact worth keeping —
--      *which* vendor is stale. `wallet_sync_state` records it per vendor so the
--      job queue can retry exactly the half that failed.
--
-- Every new tenant table carries RLS, following migration 15.

-- -----------------------------------------------------------------------------
-- 1. Onboarding and the first-steps checklist
-- -----------------------------------------------------------------------------
--
-- Only the *dismissal* is stored. Whether a step is done is derived from the
-- data it would have produced — a location row, a proximity setting, a recorded
-- scan — because a stored "completed" flag drifts the moment a merchant undoes
-- the thing, and a checklist that lies about the state of the account is worse
-- than no checklist.

create table if not exists business_onboarding (
  business_id uuid primary key references businesses (id) on delete cascade,
  /* Null while the checklist is visible. Set when the merchant hides it. */
  checklist_dismissed_at timestamptz,
  /* Which wizard step they left off on, so a refresh mid-setup resumes. */
  last_step text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_business_onboarding_updated_at on business_onboarding;
create trigger trg_business_onboarding_updated_at before update on business_onboarding
  for each row execute function fidelio_touch_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Dunning
-- -----------------------------------------------------------------------------
--
-- One open row per business. `stage` is where the sequence has reached, and the
-- unique constraint on `(business_id, provider_invoice_id)` is what makes a
-- replayed `invoice.payment_failed` — Stripe delivers at least once — advance
-- nothing and send no second email.

create table if not exists billing_dunning (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  /* The Stripe invoice the sequence is about. */
  provider_invoice_id text not null,
  provider text not null default 'stripe',
  /* How many times the charge has been attempted and declined. */
  attempt_count int not null default 1,
  /* Where the merchant has been told we are. */
  stage text not null default 'first'
    check (stage in ('first', 'retry', 'final', 'lapsed', 'recovered')),
  last_notified_at timestamptz,
  next_attempt_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_billing_dunning_invoice
  on billing_dunning (business_id, provider_invoice_id);
create index if not exists idx_billing_dunning_open
  on billing_dunning (business_id, created_at desc)
  where resolved_at is null;

drop trigger if exists trg_billing_dunning_updated_at on billing_dunning;
create trigger trg_billing_dunning_updated_at before update on billing_dunning
  for each row execute function fidelio_touch_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Per-vendor wallet sync state
-- -----------------------------------------------------------------------------
--
-- `status = 'stale'` means: this vendor's copy of the card is behind, we know
-- it, and a retry is queued. That is the state the product could not previously
-- express — a Google outage looked identical to a customer with no Google pass.

create table if not exists wallet_sync_state (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_id uuid not null references customers (id) on delete cascade,
  provider text not null check (provider in ('apple', 'google')),
  status text not null default 'synced' check (status in ('synced', 'stale', 'abandoned')),
  /* Consecutive failures. Reset to zero by a success. */
  attempts int not null default 0,
  last_error text,
  last_synced_at timestamptz,
  last_failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_wallet_sync_state_customer_provider
  on wallet_sync_state (customer_id, provider);
create index if not exists idx_wallet_sync_state_stale
  on wallet_sync_state (business_id, provider)
  where status <> 'synced';

drop trigger if exists trg_wallet_sync_state_updated_at on wallet_sync_state;
create trigger trg_wallet_sync_state_updated_at before update on wallet_sync_state
  for each row execute function fidelio_touch_updated_at();

-- -----------------------------------------------------------------------------
-- 4. Notification delivery can be retried
-- -----------------------------------------------------------------------------
--
-- The dedupe key is claimed *before* delivery is attempted, which is what makes
-- concurrent geofence crossings collapse into one notification. It also meant
-- that a delivery which failed after the claim was lost for the whole cooldown
-- window: the key was taken, so the retry conflicted with the corpse of the
-- attempt that failed.
--
-- Making the column nullable lets a failed attempt *release* its claim while
-- keeping the row for the delivery log. Postgres treats nulls as distinct in a
-- unique index, so several failed attempts coexist and the next crossing can
-- claim the key again.

alter table wallet_notifications alter column dedupe_key drop not null;
alter table wallet_notifications add column if not exists attempts int not null default 0;

create index if not exists idx_wallet_notifications_retryable
  on wallet_notifications (business_id, created_at desc)
  where status = 'failed';

-- -----------------------------------------------------------------------------
-- 5. Row level security
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
  tenant_tables text[] := array[
    'business_onboarding', 'billing_dunning', 'wallet_sync_state'
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

/*
 * `business_onboarding` is keyed by `business_id` rather than carrying it as a
 * column, so the generic policy above still resolves — the column exists, it is
 * simply also the primary key.
 */
