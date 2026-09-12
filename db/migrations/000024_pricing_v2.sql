-- =============================================================================
-- 000024 — Pricing v2: three tiers at $29 / $59 / $99
-- =============================================================================
--
-- The catalogue went from four tiers to three:
--
--     before   starter $5   growth $19   pro $49   business $99
--     after    starter $29  growth $59   pro $99
--
-- `lib/billing/plans.ts` is the source of truth for what a tier *includes*; this
-- migration is only about the two things the database actually holds — which
-- strings `businesses.plan` is allowed to be, and the MRR arithmetic in the
-- platform overview function.
--
-- Three changes:
--
--   1. **`business` is folded into `pro`.** Both are $99, so no invoice moves.
--      This is the only remap that cannot cost a paying merchant money.
--   2. **The check constraint loses `business`.** It has to lose it *after* the
--      rows are rewritten, or the constraint validation fails on the very rows
--      this migration exists to fix.
--   3. **`passimo_platform_overview` learns the new prices.** Its MRR sum had
--      500 / 1900 / 4900 / 9900 inlined, which is the one place in the schema
--      that duplicates a price — so it is also the one place that would have gone
--      on reporting last quarter's revenue after a pricing change.
--
-- What this migration deliberately does **not** do:
--
--   * **It does not touch Stripe.** Stripe is authoritative on what a customer is
--     charged. An existing subscription keeps its price id and its amount until
--     somebody changes plan through the portal; rewriting `businesses.plan` does
--     not and must not re-price anybody. `STRIPE_PRICE_BUSINESS_*` simply stops
--     being read, and `planFrom()` in the webhook now derives its price-id lookup
--     from `PUBLIC_PLANS` so a subscription on an old price still resolves.
--   * **It does not delete or restrict anything.** `business` was nominally
--     unlimited on every cap and Pro is not, so a remapped workspace can be over
--     a limit the instant this runs. Reads are never gated and nothing is
--     removed; they keep every customer, location and seat and simply cannot add
--     more. Section 4 below *reports* any workspace in that position so it is a
--     support conversation rather than a surprise.
--
-- Idempotent. Re-running it rewrites nothing (the `where` clauses match no rows
-- the second time), re-asserts the same constraint, and replaces the function
-- with an identical body.

-- No `begin` / `commit` here: `scripts/migrate.ts` wraps every migration in a
-- transaction of its own and rolls back on any error, so an explicit one would
-- nest (a warning) and an explicit `commit` would end the runner's transaction
-- underneath it.

-- -----------------------------------------------------------------------------
-- 1. Rewrite stored plan identifiers
-- -----------------------------------------------------------------------------
--
-- Order matters: the constraint has to be dropped before the update, because the
-- existing constraint permits `business` and the new one does not — and an update
-- validated against the old constraint is fine, while a new constraint validated
-- against un-updated rows is not.

alter table businesses drop constraint if exists businesses_plan_check;

-- Legacy identifiers from every previous catalogue, resolved the same way
-- `normalizePlanId()` resolves them in the application.
update businesses set plan = 'lapsed' where plan = 'free';
update businesses set plan = 'pro'    where plan in ('business', 'enterprise');

alter table businesses
  add constraint businesses_plan_check
  check (plan in ('trial', 'lapsed', 'starter', 'growth', 'pro'));


-- -----------------------------------------------------------------------------
-- 2. Platform overview: the new prices
-- -----------------------------------------------------------------------------
--
-- Same signature and same column list as the definition in migration 000015
-- (renamed to `passimo_*` by 000017), with two differences: the MRR case
-- expression carries the new prices, and `businesses_active` no longer counts a
-- `business` row that can no longer exist.
--
-- A yearly subscriber contributes their annual price over twelve rather than the
-- monthly list rate; every tier is priced at ten months, so that is 10/12 of
-- list. The application computes the same figure from `annualPrice`, and
-- `plan_interval` is what tells the two apart.

create or replace function passimo_platform_overview()
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
    (select count(*) from businesses where plan in ('starter','growth','pro'))::bigint,
    (select count(*) from businesses where plan = 'trial' and coalesce(trial_ends_at, now()) > now())::bigint,
    (select count(*) from businesses where plan = 'lapsed')::bigint,
    (select count(*) from customers where status <> 'anonymized')::bigint,
    (select count(*) from loyalty_ledger where created_at > now() - interval '30 days')::bigint,
    (select count(*) from wallet_registrations)::bigint,
    (select coalesce(sum(
        case when plan_interval = 'year'
          then round(
            case plan
              when 'starter' then 29000
              when 'growth'  then 59000
              when 'pro'     then 99000
              else 0 end / 12.0)
          else
            case plan
              when 'starter' then 2900
              when 'growth'  then 5900
              when 'pro'     then 9900
              else 0 end
        end), 0) from businesses
      where subscription_status in ('active', 'trialing'))::bigint;
$$;


-- -----------------------------------------------------------------------------
-- 3. Clear stale monthly counters for a metric that changed meaning
-- -----------------------------------------------------------------------------
--
-- `campaigns_per_month` was defined on every tier and enforced by nothing: the
-- send route never checked it and never incremented it, so `usage_counters` holds
-- no rows for it and the billing screen showed "0 / 2" beside a working Campaigns
-- button. It is now reserved and counted on send.
--
-- Nothing to migrate — there is no history to preserve — but the `overage` rows
-- the soft-limit reporter writes are worth clearing for the two limits whose caps
-- changed the most, so a merchant is not greeted by an overage banner about a cap
-- that is now four times larger.

delete from usage_counters
where period = 'overage'
  and metric in ('messages_per_month', 'campaigns_per_month', 'ai_actions_per_month');


-- -----------------------------------------------------------------------------
-- 4. Report, do not restrict
-- -----------------------------------------------------------------------------
--
-- Any workspace remapped from the old unlimited top tier that is now above one of
-- Pro's caps. Printed rather than acted on: nothing is deleted, nothing is
-- blocked retroactively, and the right response is a conversation with the
-- merchant — not a migration quietly deciding which of their locations to
-- archive.
--
-- Expected output on a pre-revenue database and on the demo seed: no rows.

do $$
declare
  offender record;
  found_any boolean := false;
begin
  for offender in
    select
      b.id,
      b.name,
      (select count(*) from customers c
        where c.business_id = b.id and c.status <> 'anonymized') as customers,
      (select count(*) from locations l
        where l.business_id = b.id and l.archived_at is null) as locations,
      (select count(*) from team_members t
        where t.business_id = b.id and t.status = 'active') as seats
    from businesses b
    where b.plan = 'pro'
  loop
    if offender.customers > 20000 or offender.locations > 10 or offender.seats > 25 then
      found_any := true;
      raise warning
        'pricing_v2: % (%) is above a Pro cap — customers %, locations %, seats %. Nothing was changed; their data is intact and reads are ungated.',
        offender.name, offender.id, offender.customers, offender.locations, offender.seats;
    end if;
  end loop;

  if not found_any then
    raise notice 'pricing_v2: no workspace is above a Pro cap.';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 5. Verify
-- -----------------------------------------------------------------------------
--
-- A migration that half-applied is worse than one that failed: the constraint
-- would permit a tier the application cannot gate, or a legacy row would survive
-- and `resolveEntitlements` would read it through the code alias forever.

do $$
declare
  legacy_rows bigint;
begin
  select count(*) into legacy_rows
  from businesses
  where plan in ('free', 'business', 'enterprise');

  if legacy_rows > 0 then
    raise exception 'pricing_v2 incomplete: % rows still hold a legacy plan id', legacy_rows;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'businesses_plan_check'
      and conrelid = 'businesses'::regclass
  ) then
    raise exception 'pricing_v2 incomplete: businesses_plan_check is missing';
  end if;
end $$;
