-- Merchant acceptance of the terms, recorded at signup.
--
-- The gap this closes: Passimo publishes Terms of Service that bind the
-- merchant — payment obligations, their responsibilities as data controller,
-- how the agreement ends — and the signup form never showed them. No link, no
-- checkbox, no stored acceptance. Terms that were never presented are not
-- incorporated into the contract, which made every clause in them decorative.
--
-- The shape is copied deliberately from the customer consent columns added in
-- 000003 (`terms_accepted_at`, `consent_source`, `consent_ip`): the product
-- already captured consent properly for the person enrolling at a counter, and
-- not at all for the person signing a paid subscription. Same rigour, same
-- columns, so there is one pattern rather than two.
--
-- Nullable on purpose. Backfilling a timestamp for accounts that pre-date the
-- checkbox would be inventing a consent event that never happened, and a null
-- here is the honest record of "signed up before we asked". `terms_version`
-- is the document date from `lib/legal/documents.ts`, so a future revision can
-- tell who accepted which text without a second table.

alter table businesses
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_version text,
  add column if not exists terms_accepted_ip text;

comment on column businesses.terms_accepted_at is
  'When the owner accepted the terms at signup. Null for accounts created before acceptance was captured — not backfilled, because the event did not happen.';
comment on column businesses.terms_version is
  'The LAST_UPDATED date of the terms text that was shown, from lib/legal/documents.ts.';
comment on column businesses.terms_accepted_ip is
  'Origin of the acceptance, for the same evidentiary reason as customers.consent_ip.';

-- Partial index: the only question ever asked of these columns is "who has not
-- accepted the current version", which is a small set against a large table.
create index if not exists businesses_terms_pending_idx
  on businesses (terms_version)
  where terms_accepted_at is null;

do $$
declare
  missing text;
begin
  select string_agg(column_name, ', ')
    into missing
  from (
    select unnest(array['terms_accepted_at', 'terms_version', 'terms_accepted_ip']) as column_name
  ) expected
  where not exists (
    select 1
    from information_schema.columns
    where table_name = 'businesses'
      and column_name = expected.column_name
  );

  if missing is not null then
    raise exception 'migration 000025 incomplete, missing: %', missing;
  end if;

  raise notice 'businesses: terms consent columns present';
end
$$;
