-- =============================================================================
-- 000014 — Counter performance and gift card code hardening
-- =============================================================================
--
-- Two concerns, both driven by the counter scanner resolving arbitrary codes:
--
--   1. Gift card codes were still using the original schema default,
--      `lower(substring(md5(random()::text) from 1 for 12))`. Postgres `random()`
--      is a seeded PRNG, not a CSPRNG, so codes generated in sequence are
--      correlated — and a gift card is a bearer instrument. Anyone able to guess
--      a code can spend someone else's money.
--
--   2. The scanner resolves an ambiguous code by probing several tables at once,
--      and reads a full counter view on every identification. Each of those
--      reads happens while a customer stands at the till, so each one needs to
--      be an index hit.
--
-- Existing codes are deliberately left alone: cards are printed, emailed and
-- sitting in wallets, and rotating them would invalidate money customers have
-- already paid for. Only newly issued codes use the stronger generator.

-- -----------------------------------------------------------------------------
-- 1. Gift card codes
-- -----------------------------------------------------------------------------

-- `fidelio_random_code` is CSPRNG-backed (pgcrypto `gen_random_bytes`) and draws
-- from an alphabet with no I/O/0/1, so a code can be read aloud across a counter
-- without being misheard. 12 characters of a 32-symbol alphabet is 60 bits: far
-- beyond guessing, still short enough to type.
alter table gift_cards alter column code set default fidelio_random_code(12);

-- The original schema declared `code text unique` — global rather than per
-- business, and case-sensitive, while redemption looks codes up
-- case-insensitively. That mismatch allows `ABC123` and `abc123` to coexist
-- while only one of them is ever findable, so a customer could hold a card that
-- silently resolves to somebody else's balance.
create unique index if not exists idx_gift_cards_business_code_upper
  on gift_cards (business_id, upper(code));

-- -----------------------------------------------------------------------------
-- 2. Counter read paths
-- -----------------------------------------------------------------------------
--
-- Referral codes are not indexed here: `customers.referral_code` already carries
-- a global unique constraint, which is the optimal index for resolving one.

-- The counter roster: "who was here recently" and "who are the regulars". These
-- are the fallback lists shown when the camera cannot be used, so they are on
-- the critical path exactly when something has already gone wrong.
create index if not exists idx_customers_last_visit_active
  on customers (business_id, last_visit desc nulls last)
  where status = 'active' and merged_into_customer_id is null;

create index if not exists idx_customers_vip_spend
  on customers (business_id, lifetime_spend desc)
  where is_vip and status = 'active' and merged_into_customer_id is null;

-- Rewards waiting to be handed over, read on every single identification.
-- `claimed` is the only pre-fulfilment state the status constraint permits.
create index if not exists idx_reward_redemptions_claimed
  on reward_redemptions (business_id, customer_id)
  where status = 'claimed';

-- A scanned wallet pass outlives a customer merge, so resolution follows the
-- forwarding pointer rather than dead-ending on the absorbed record.
create index if not exists idx_customers_merged_into
  on customers (merged_into_customer_id)
  where merged_into_customer_id is not null;

-- Active gift cards attached to a customer, summed into the counter view.
create index if not exists idx_gift_cards_recipient_active
  on gift_cards (business_id, recipient_customer_id)
  where status = 'active' and recipient_customer_id is not null;
