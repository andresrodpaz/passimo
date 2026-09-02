-- =============================================================================
-- 000023 — Make a workspace deletable without weakening the ledger
-- =============================================================================
--
-- `trg_ledger_guard` refuses every DELETE on `loyalty_ledger`:
--
--     raise exception 'loyalty_ledger rows are immutable; post a reversal instead'
--
-- That is the right rule for an accounting ledger and the wrong rule for a
-- cascade, and because it does not distinguish the two, **no workspace that has
-- ever recorded a single stamp can be deleted.** `businesses.business_id` foreign
-- keys are all `on delete cascade`, the cascade reaches `loyalty_ledger`, and the
-- trigger vetoes it. `delete from businesses where id = $1` fails with a message
-- about reversals, which is true of a row and nonsense about a tenant.
--
-- Three things that follow, all observed:
--
--   1. **Account closure is impossible.** A merchant who cancels and asks to be
--      removed cannot be. Customer erasure is handled properly — the API's
--      DELETE calls `passimo_anonymize_customer`, keeping the ledger and dropping
--      the personal data, which is exactly what GDPR art. 17(3) allows. There is
--      no equivalent for the workspace, and no way to write one.
--   2. **Test fixtures leak.** `dropTenant` deletes the business and ignores the
--      error, so every integration run that recorded an earn left its tenant
--      behind. They accumulated in the platform admin console next to the demo
--      merchants — "qb mtisa38e1" between Madrid Coffee and Sevilla Bakery.
--   3. **The demo cannot be tidied.** The same reason.
--
-- The distinction this migration draws: rewriting history is forbidden; removing
-- the entity the history belongs to is not. A blanket ban cannot express that, so
-- the guard now honours one narrowly-scoped session setting, and one function is
-- allowed to set it.
--
-- Why a session setting rather than dropping the trigger for DELETE: an
-- accidental `delete from loyalty_ledger where ...` in a psql session must still
-- fail. `set local` confines the permission to the current transaction, so it
-- cannot leak into a later statement on a pooled connection, and the only thing
-- that sets it is a `security definer` function whose whole body is one delete.
--
-- Idempotent: `create or replace`, and the trigger is recreated only if its
-- definition changed.

-- -----------------------------------------------------------------------------
-- 1. The guard learns one exception
-- -----------------------------------------------------------------------------

create or replace function passimo_ledger_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    /*
     * Permitted only inside `passimo_delete_business`, which sets this with
     * `set local` so it expires with the transaction. `current_setting(..., true)`
     * returns null rather than raising when the setting has never been set, which
     * is the normal case and must not error.
     */
    if coalesce(current_setting('passimo.allow_ledger_delete', true), 'off') = 'on' then
      return old;
    end if;
    raise exception 'loyalty_ledger rows are immutable; post a reversal instead'
      using hint = 'To remove a whole workspace, call passimo_delete_business(business_id).';
  end if;

  if new.id is distinct from old.id
     or new.amount is distinct from old.amount
     or new.entry_type is distinct from old.entry_type
     or new.account_id is distinct from old.account_id
     or new.created_at is distinct from old.created_at then
    raise exception 'loyalty_ledger rows are immutable; post a reversal instead';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. The one caller allowed to use it
-- -----------------------------------------------------------------------------
--
-- Everything tenant-scoped is `on delete cascade` from `businesses`, so this is a
-- single statement plus the permission it needs. The owning `app_users` row is
-- deliberately *not* touched: a person may own more than one workspace, and
-- deleting the account because one of them closed would take the others with it
-- (`businesses.owner_id` cascades). Removing the account is a separate decision
-- and a separate call.

create or replace function passimo_delete_business(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_customers bigint;
  v_ledger bigint;
begin
  select name into v_name from businesses where id = p_business_id;
  if not found then
    raise exception 'Business % not found', p_business_id using errcode = 'no_data_found';
  end if;

  select count(*) into v_customers from customers where business_id = p_business_id;
  select count(*) into v_ledger from loyalty_ledger where business_id = p_business_id;

  /*
   * `set local`, not `set`. The permission is released when the transaction ends
   * however it ends, so a connection returned to the pool cannot carry it into
   * somebody else's statement.
   */
  set local passimo.allow_ledger_delete = 'on';

  delete from businesses where id = p_business_id;

  return jsonb_build_object(
    'deleted', true,
    'name', v_name,
    'customers_removed', v_customers,
    'ledger_entries_removed', v_ledger
  );
end;
$$;

comment on function passimo_delete_business(uuid) is
  'Removes a workspace and everything scoped to it. The only route through the '
  'loyalty_ledger immutability guard; see migration 000023. Does not delete the '
  'owning account, which may own other workspaces.';

-- -----------------------------------------------------------------------------
-- 3. Verify
-- -----------------------------------------------------------------------------
--
-- Proves both halves on a throwaway tenant: a bare delete is still refused, and
-- the function succeeds. Rolled back, so the check leaves nothing behind.

do $$
declare
  v_business uuid;
  v_customer uuid;
  v_program uuid;
  v_account uuid;
  v_blocked boolean := false;
  v_result jsonb;
begin
  insert into businesses (name, slug, plan, subscription_status)
  values ('migration 23 probe', 'migration-23-probe-' || gen_random_uuid(), 'starter', 'active')
  returning id into v_business;

  insert into loyalty_programs (business_id, name, type, is_default)
  values (v_business, 'probe', 'stamps', true)
  returning id into v_program;

  insert into customers (business_id, email, name)
  values (v_business, 'probe@migration23.invalid', 'Probe')
  returning id into v_customer;

  insert into loyalty_accounts (business_id, program_id, customer_id, balance)
  values (v_business, v_program, v_customer, 1)
  returning id into v_account;

  insert into loyalty_ledger (
    business_id, program_id, customer_id, account_id, entry_type, amount, balance_after
  ) values (v_business, v_program, v_customer, v_account, 'earn', 1, 1);

  -- A bare delete must still be refused.
  begin
    delete from loyalty_ledger where business_id = v_business;
  exception when others then
    v_blocked := true;
  end;

  if not v_blocked then
    raise exception
      'Migration 000023: the ledger guard no longer blocks a direct delete. '
      'The immutability guarantee is gone.';
  end if;

  -- And the sanctioned route must work.
  v_result := passimo_delete_business(v_business);

  if (v_result ->> 'deleted')::boolean is not true then
    raise exception 'Migration 000023: passimo_delete_business did not report success';
  end if;

  if exists (select 1 from businesses where id = v_business) then
    raise exception 'Migration 000023: the workspace survived passimo_delete_business';
  end if;

  if exists (select 1 from loyalty_ledger where business_id = v_business) then
    raise exception 'Migration 000023: ledger rows survived the cascade';
  end if;

  raise notice
    'Migration 000023 verified: direct ledger deletes still blocked, workspace deletion works.';
end $$;
