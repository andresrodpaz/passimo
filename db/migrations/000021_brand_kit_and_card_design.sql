-- =============================================================================
-- 000021 — Brand kit, and the card design a merchant actually controls
-- =============================================================================
--
-- TWO PROBLEMS, ONE SHAPE
--
-- 1. THE CARD HAS NO DESIGN MODEL.
--
-- Passimo sells a card that lives in a customer's wallet, and until now the only
-- things a merchant could change about it were three hex values on `businesses`
-- (`primary_color`, `accent_color`, `text_color`) and a logo. Everything else —
-- how progress is drawn, whether the tier shows, what the card says besides the
-- balance — was decided in `pass-content.ts` and identical for every business on
-- the platform.
--
-- That is the wrong thing to have hardcoded in a product whose pitch is "your
-- brand, in your customer's pocket". A barber and a gym want visibly different
-- cards, and neither wants to file a support ticket to get one.
--
-- 2. BRANDING WAS STORED TWICE, AND THE COPIES DISAGREED.
--
-- `businesses.primary_color / text_color / logo_url` is the brand. But
-- `wallet_settings` *also* carries `brand_color`, `brand_text_color`, `logo_url`
-- and `hero_image_url`, and `pass-content.ts` resolves them as overrides:
--
--     backgroundColor: branding.brandColor ?? business.primary_color ?? '#111827'
--
-- So a merchant who set their colour on the Settings screen and then touched the
-- wallet screen had two sources of truth for one decision, with the less obvious
-- one winning. Nobody can reason about which screen is authoritative, because
-- neither is.
--
-- WHAT THIS MIGRATION DOES
--
-- Splits the two concerns properly, which is also how the UI now presents them:
--
--     BRAND KIT   (businesses)            who the business is — name, logo,
--                                         colours, description, contact, social.
--                                         Reused by the card, public pages,
--                                         emails and campaigns.
--
--     CARD DESIGN (wallet_card_designs)   how the loyalty card looks — template,
--                                         style, progress rendering, typography,
--                                         which rows appear, custom copy.
--
--     BEHAVIOUR   (wallet_settings)       when the card notifies — radiuses,
--                                         dwell, quiet hours, frequency caps.
--                                         Unchanged by this migration.
--
-- The card design row is nullable-by-absence: no row means "inherit the brand
-- kit and use the defaults", exactly like `wallet_settings`, so no caller has to
-- handle an unconfigured state.
--
-- The duplicated `wallet_settings` branding columns are NOT dropped here. They
-- still carry *notification* branding (the emoji, title, message and CTA of a
-- lock-screen alert), which is genuinely behaviour and genuinely belongs there.
-- What changes is that `brand_color`, `brand_text_color`, `logo_url` and
-- `hero_image_url` stop being consulted for the card face — `lib/wallet/
-- card-design.ts` resolves that from the brand kit and this table instead. The
-- columns are left in place and any values already set are copied forward below,
-- so no merchant loses a colour they had chosen.
--
-- Idempotent: safe to re-run.

-- -----------------------------------------------------------------------------
-- 1. Brand kit — the fields `businesses` was missing
-- -----------------------------------------------------------------------------
--
-- `primary_color`, `accent_color`, `text_color`, `font`, `logo_url`, `phone`,
-- `support_email`, `website`, `instagram`, `address`, `city` and `country`
-- already exist from migrations 1 and 2. These are the gaps a brand kit screen
-- needs to be complete.

alter table businesses add column if not exists secondary_color text;
alter table businesses add column if not exists description text;
alter table businesses add column if not exists facebook text;
alter table businesses add column if not exists tiktok text;

comment on column businesses.secondary_color is
  'Brand kit: supporting colour. Null means "derive from primary".';
comment on column businesses.description is
  'Brand kit: one line describing the business. Used on public pages and the card back.';

-- -----------------------------------------------------------------------------
-- 2. Card design
-- -----------------------------------------------------------------------------

create table if not exists wallet_card_designs (
  business_id uuid primary key references businesses(id) on delete cascade,

  -- Which starting point the merchant chose. Kept so the designer can show
  -- "based on Espresso" and so a future template revision can find its users.
  template text not null default 'minimal',

  -- How the card face is painted.
  card_style text not null default 'solid'
    check (card_style in ('solid', 'gradient', 'duotone', 'frosted')),

  -- How loyalty progress is drawn. `auto` follows the program: a stamp card gets
  -- stamps, a points program gets a bar. A merchant can override — some stamp
  -- programs with a goal of 40 look absurd as forty dots.
  progress_style text not null default 'auto'
    check (progress_style in ('auto', 'bar', 'stamps', 'points', 'none')),

  typography text not null default 'system'
    check (typography in ('system', 'rounded', 'serif', 'mono')),

  -- Colours. Null means "inherit from the brand kit", which is the default and
  -- the reason most merchants never touch this table.
  background_color text,
  foreground_color text,
  accent_color text,

  logo_url text,
  hero_image_url text,

  -- Which rows appear on the card face. Every one of these is a real decision:
  -- a gym wants the tier, a bakery does not; a single-site café has no use for a
  -- location row.
  show_member_name boolean not null default true,
  show_member_since boolean not null default true,
  show_tier boolean not null default true,
  show_location boolean not null default true,
  show_reward boolean not null default true,
  show_progress boolean not null default true,

  -- Merchant copy. `headline` overrides the program name on the card;
  -- `custom_message` is the line on the back; `terms_text` is the small print.
  headline text,
  custom_message text,
  terms_text text,

  applied_template_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table wallet_card_designs is
  'How a business''s loyalty card looks. Absent row = brand kit + defaults.';

-- `passimo_touch_updated_at` is created in migration 2 and renamed from
-- `fidelio_touch_updated_at` by migration 17, so by the time this runs the
-- passimo-prefixed name is the correct one on both a fresh and a deployed
-- database.
drop trigger if exists trg_wallet_card_designs_updated on wallet_card_designs;
create trigger trg_wallet_card_designs_updated
  before update on wallet_card_designs
  for each row execute function passimo_touch_updated_at();

-- -----------------------------------------------------------------------------
-- 3. Carry forward colours merchants had already chosen
-- -----------------------------------------------------------------------------
--
-- Any business whose wallet settings carried a brand colour had deliberately
-- overridden their card face. That decision predates this table and must survive
-- it, so it is copied into the new design row rather than silently reverting to
-- the brand kit the next time the card is rendered.
--
-- Only rows with something actually set are copied; a business that never
-- touched those fields correctly ends up with no design row at all.

insert into wallet_card_designs (
  business_id, background_color, foreground_color, logo_url, hero_image_url, template
)
select
  ws.business_id,
  nullif(ws.brand_color, ''),
  nullif(ws.brand_text_color, ''),
  nullif(ws.logo_url, ''),
  nullif(ws.hero_image_url, ''),
  'minimal'
from wallet_settings ws
where coalesce(ws.brand_color, ws.brand_text_color, ws.logo_url, ws.hero_image_url) is not null
on conflict (business_id) do nothing;

-- -----------------------------------------------------------------------------
-- 4. Indexes
-- -----------------------------------------------------------------------------
--
-- The primary key covers every read this table has: it is always fetched by
-- business id alongside the pass content. No secondary index is added, because
-- an index nobody queries is write cost with no read benefit.

-- -----------------------------------------------------------------------------
-- 5. Verify
-- -----------------------------------------------------------------------------

do $$
declare
  missing_columns int;
begin
  select count(*) into missing_columns
    from (values
      ('secondary_color'), ('description'), ('facebook'), ('tiktok')
    ) as required(name)
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'businesses'
        and column_name = required.name
   );

  if missing_columns > 0 then
    raise exception 'brand kit incomplete: % column(s) missing from businesses', missing_columns;
  end if;

  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'wallet_card_designs'
  ) then
    raise exception 'wallet_card_designs was not created';
  end if;
end $$;
