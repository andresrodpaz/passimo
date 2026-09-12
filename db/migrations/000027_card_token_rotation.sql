-- Card links: make a leaked one revocable without ending the membership.
--
-- WHAT THE TOKEN IS TODAY
--
-- `/card/{token}` is opened with a stateless capability token — HMAC-SHA256
-- over `card.<payload>`, payload `{ c: <customer uuid>, exp }`, 365-day TTL.
-- That design is sound and is not being replaced: the signature is verified in
-- constant time, the purpose is inside the signed material so a token cannot be
-- replayed against another endpoint, tampering with the customer id invalidates
-- the signature, and the business is derived from the customer row rather than
-- carried as a claim, so there is no tenant field to forge.
--
-- WHAT IT CANNOT DO
--
-- It cannot be rotated. The only way to stop an issued card link today is to
-- move the customer out of `status = 'active'`, which the card route checks --
-- and that also ends their membership. So the available responses to a leaked
-- URL are "do nothing" or "delete the member".
--
-- That matters more than it looks, because this surface is no longer
-- non-monetary. `GET /api/v1/public/card/{token}` already returns
-- `gift_cards.remaining_value` and `gift_cards.code`, plus the `code` of every
-- claimed reward redemption. Those are money and bearer secrets, behind a URL
-- that is designed to be long-lived, is pasted into wallet passes and emails,
-- and survives a screenshot.
--
-- THE CHANGE
--
-- One integer per customer, carried in the token as `v` and compared on every
-- read. Bumping it invalidates every link previously issued for that customer
-- and nothing else: the membership, the balance, the history and the wallet
-- pass registration all stay exactly where they are, and the next card link the
-- customer is sent works normally.
--
-- BACKWARD COMPATIBILITY
--
-- Tokens already in the wild carry no `v` claim. The column defaults to 0 and
-- verification reads a missing claim as 0, so every outstanding card link keeps
-- working. A token only stops validating once somebody deliberately rotates
-- that customer -- which is the whole point.

alter table customers
  add column if not exists card_token_version smallint not null default 0;

comment on column customers.card_token_version is
  'Incremented to invalidate every previously issued /card/{token} link for this '
  'customer. Carried as the "v" claim; a token with no claim reads as 0. Bumping '
  'revokes outstanding links without touching the membership.';

-- -----------------------------------------------------------------------------
-- Rotation
-- -----------------------------------------------------------------------------
--
-- Tenant-scoped on purpose: the caller must name the business the customer
-- belongs to, so a customer id on its own is not enough to act on somebody
-- else's member. Returns the new version, or null when the pair does not match
-- -- null rather than an exception because "that customer is not yours" and
-- "that customer does not exist" must be indistinguishable to a caller.

create or replace function passimo_rotate_card_token(
  p_business_id uuid,
  p_customer_id uuid
) returns smallint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_version smallint;
begin
  update customers
     set card_token_version = case
           -- smallint tops out at 32767; wrapping to 0 would silently re-validate
           -- the oldest tokens, so it wraps to 1 and never back to the default.
           when card_token_version >= 32000 then 1
           else card_token_version + 1
         end,
         updated_at = now()
   where id = p_customer_id
     and business_id = p_business_id
  returning card_token_version into v_version;

  return v_version;
end;
$$;
