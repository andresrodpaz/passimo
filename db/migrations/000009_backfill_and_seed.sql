-- =============================================================================
-- 000009 — Backfill legacy data + seed the defaults every account should have
--
-- No merchant loses a stamp, a customer or a history record in the migration.
-- Afterwards, every business starts with working segments, rewards and
-- always-on automations instead of an empty dashboard.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Legacy stamp history → activity_events (analytics keeps the full record)
-- -----------------------------------------------------------------------------

insert into activity_events (
  business_id, customer_id, type, quantity, amount, source, staff_user_id,
  metadata, occurred_at, created_at, external_id
)
select se.business_id,
       se.customer_id,
       case when se.ticket_amount is not null and se.ticket_amount > 0 then 'purchase' else 'visit' end,
       se.stamps_given,
       se.ticket_amount,
       'import',
       se.given_by,
       jsonb_strip_nulls(jsonb_build_object('note', se.note, 'legacy_stamp_event', true)),
       se.created_at,
       se.created_at,
       'legacy_stamp:' || se.id::text
from stamp_events se
where exists (select 1 from customers c where c.id = se.customer_id)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. Current balances → loyalty_accounts + one opening ledger entry
--
-- A single opening entry (rather than replaying every historical stamp as a
-- credit) is what keeps the ledger invariant exact:
--   sum(remaining over open credits) == accounts.balance
-- which FIFO redemption and expiry both depend on.
-- -----------------------------------------------------------------------------

insert into loyalty_accounts (
  business_id, program_id, customer_id, balance, lifetime_earned, created_at
)
select c.business_id,
       p.id,
       c.id,
       greatest(0, coalesce(c.stamp_count, 0)),
       greatest(0, coalesce(c.total_stamps_ever, 0)),
       c.created_at
from customers c
join loyalty_programs p on p.business_id = c.business_id and p.is_default
where not exists (
  select 1 from loyalty_accounts a where a.program_id = p.id and a.customer_id = c.id
)
on conflict (program_id, customer_id) do nothing;

insert into loyalty_ledger (
  business_id, program_id, customer_id, account_id, entry_type, amount,
  balance_after, remaining, reason, idempotency_key, created_at
)
select a.business_id,
       a.program_id,
       a.customer_id,
       a.id,
       'adjust',
       a.balance,
       a.balance,
       a.balance,
       'Opening balance migrated from stamp card',
       'migration:opening:' || a.id::text,
       a.created_at
from loyalty_accounts a
where a.balance > 0
  and not exists (
    select 1 from loyalty_ledger l
     where l.account_id = a.id and l.idempotency_key = 'migration:opening:' || a.id::text
  );

-- -----------------------------------------------------------------------------
-- 3. Legacy redemptions get attached to the migrated program and reward
-- -----------------------------------------------------------------------------

update reward_redemptions rr
   set program_id = p.id,
       reward_id = coalesce(rr.reward_id, (
         select r.id from rewards r where r.program_id = p.id order by r.created_at limit 1
       )),
       cost = coalesce(nullif(rr.cost, 0), p.goal_amount, 0)
  from loyalty_programs p
 where p.business_id = rr.business_id
   and p.is_default
   and rr.program_id is null;

-- -----------------------------------------------------------------------------
-- 4. Referral links recorded on customers become proper referral rows
-- -----------------------------------------------------------------------------

insert into referrals (
  business_id, referrer_customer_id, referred_customer_id, referred_email,
  code, status, qualifying_event_count, qualified_at, created_at
)
select c.business_id,
       c.referred_by,
       c.id,
       c.email,
       coalesce(ref.referral_code, fidelio_random_code(8)),
       'qualified',
       1,
       c.created_at,
       c.created_at
from customers c
join customers ref on ref.id = c.referred_by
where c.referred_by is not null
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 5. Recompute derived stats so the dashboard is accurate on first load
-- -----------------------------------------------------------------------------

do $$
declare
  v_customer uuid;
  v_business uuid;
begin
  for v_customer in select id from customers loop
    perform fidelio_recompute_customer_stats(v_customer);
  end loop;

  for v_business in select id from businesses loop
    perform fidelio_recompute_rfm(v_business);
    perform fidelio_recompute_churn_risk(v_business);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 6. System segments — the audiences every merchant needs on day one
-- -----------------------------------------------------------------------------

insert into segments (business_id, name, description, is_system, key, definition)
select b.id, s.name, s.description, true, s.key, s.definition::jsonb
from businesses b
cross join (values
  ('All customers', 'Everyone in your loyalty program', 'all',
   '{"match":"all","conditions":[]}'),
  ('Active', 'Visited in the last 30 days', 'active',
   '{"match":"all","conditions":[{"field":"last_visit","operator":"within_days","value":30}]}'),
  ('At risk', 'Have not visited in 30-90 days', 'at_risk',
   '{"match":"all","conditions":[{"field":"last_visit","operator":"before_days","value":30},{"field":"last_visit","operator":"within_days","value":90}]}'),
  ('Lost', 'No visit in over 90 days', 'lost',
   '{"match":"all","conditions":[{"field":"last_visit","operator":"before_days","value":90}]}'),
  ('New this month', 'Joined in the last 30 days', 'new',
   '{"match":"all","conditions":[{"field":"created_at","operator":"within_days","value":30}]}'),
  ('VIP', 'Your most valuable customers', 'vip',
   '{"match":"any","conditions":[{"field":"is_vip","operator":"is_true"},{"field":"rfm_segment","operator":"in","value":["champion","loyal"]}]}'),
  ('Birthday this month', 'Celebrating this month', 'birthday_month',
   '{"match":"all","conditions":[{"field":"birthday","operator":"birthday_in_month"}]}'),
  ('Reward ready', 'Enough balance to claim a reward', 'reward_ready',
   '{"match":"all","conditions":[{"field":"reward_available","operator":"is_true"}]}'),
  ('High churn risk', 'Likely to stop coming', 'churn_risk',
   '{"match":"all","conditions":[{"field":"churn_risk","operator":"gte","value":0.6}]}'),
  ('One-time visitors', 'Came once and never returned', 'one_timers',
   '{"match":"all","conditions":[{"field":"visit_count","operator":"lte","value":1}]}')
) as s(name, description, key, definition)
on conflict (business_id, name) do nothing;

-- -----------------------------------------------------------------------------
-- 7. Default reward catalogue entries for the automations below
-- -----------------------------------------------------------------------------

insert into rewards (business_id, program_id, name, description, cost, type, auto_grant_trigger, valid_days)
select p.business_id, p.id, v.name, v.description, 0, 'free_item', v.trigger, v.valid_days
from loyalty_programs p
cross join (values
  ('Welcome gift', 'A small thank-you for joining', 'welcome', 30),
  ('Birthday treat', 'On the house, happy birthday!', 'birthday', 14),
  ('We miss you', 'Come back and enjoy this on us', 'winback', 21)
) as v(name, description, trigger, valid_days)
where p.is_default
  and not exists (
    select 1 from rewards r
     where r.program_id = p.id and r.auto_grant_trigger = v.trigger
  );

-- -----------------------------------------------------------------------------
-- 8. Always-on automations
--
-- These are enabled by default because they are the ones that make merchants
-- money without any work, and the dispatcher independently enforces consent,
-- suppression lists and quiet hours before anything is actually sent.
-- -----------------------------------------------------------------------------

insert into automations (
  business_id, name, description, is_active, trigger, trigger_config,
  delay_minutes, cooldown_days, actions
)
select b.id, a.name, a.description, a.is_active, a.trigger,
       a.trigger_config::jsonb, a.delay_minutes, a.cooldown_days, a.actions::jsonb
from businesses b
cross join (values
  (
    'Welcome new members',
    'Greets every new member and gets them to their first reward',
    true, 'customer_joined', '{}', 5, 3650,
    '[{"type":"send_message","channel":"auto","template":"welcome"},{"type":"grant_reward","trigger":"welcome"}]'
  ),
  (
    'Birthday treat',
    'Sends a gift on their birthday — the highest-converting message you can send',
    true, 'birthday', '{"days_before":0}', 0, 300,
    '[{"type":"send_message","channel":"auto","template":"birthday"},{"type":"grant_reward","trigger":"birthday"}]'
  ),
  (
    'Win back inactive customers',
    'Reaches out when someone has not visited in a while',
    true, 'inactivity', '{"days":30}', 0, 60,
    '[{"type":"send_message","channel":"auto","template":"winback"},{"type":"grant_reward","trigger":"winback"}]'
  ),
  (
    'Reward is ready',
    'Tells customers the moment they can claim — drives the next visit',
    true, 'reward_unlocked', '{}', 15, 7,
    '[{"type":"send_message","channel":"auto","template":"reward_unlocked"}]'
  ),
  (
    'Balance expiring soon',
    'A gentle nudge before points expire',
    true, 'balance_expiring', '{"days_before":14}', 0, 30,
    '[{"type":"send_message","channel":"auto","template":"expiry_warning"}]'
  ),
  (
    'Membership anniversary',
    'Celebrates one year since they joined',
    true, 'anniversary', '{}', 0, 300,
    '[{"type":"send_message","channel":"auto","template":"anniversary"}]'
  ),
  (
    'Ask happy customers for a review',
    'Turns promoters into public reviews',
    false, 'nps_promoter', '{"min_score":9}', 60, 180,
    '[{"type":"send_message","channel":"auto","template":"review_request"}]'
  ),
  (
    'Recover unhappy customers',
    'Alerts you privately so you can fix it before they tell everyone',
    true, 'nps_detractor', '{"max_score":6}', 0, 90,
    '[{"type":"notify_staff","title":"Unhappy customer"},{"type":"add_tag","tag":"needs-attention"}]'
  )
) as a(name, description, is_active, trigger, trigger_config, delay_minutes, cooldown_days, actions)
where not exists (
  select 1 from automations x where x.business_id = b.id and x.name = a.name
);

-- -----------------------------------------------------------------------------
-- 9. Default NPS survey
-- -----------------------------------------------------------------------------

insert into surveys (business_id, type, scale_max, is_active, auto_send_after_hours)
select b.id, 'nps', 10, true, 0
from businesses b
where not exists (select 1 from surveys s where s.business_id = b.id);

-- -----------------------------------------------------------------------------
-- 10. Built-in message templates (business_id null = available to everyone)
-- -----------------------------------------------------------------------------

insert into message_templates (business_id, key, name, channel, subject, body, locale, variables)
values
  (null, 'welcome', 'Welcome', 'email',
   'Welcome to {{business_name}}',
   'Hi {{customer_first_name}}, welcome to {{business_name}}! Your loyalty card is ready — collect {{program_goal}} {{program_unit_plural}} and get {{reward_name}}.',
   'en', array['business_name','customer_first_name','program_goal','program_unit_plural','reward_name']),
  (null, 'welcome', 'Bienvenida', 'email',
   'Bienvenido a {{business_name}}',
   'Hola {{customer_first_name}}, ¡bienvenido a {{business_name}}! Tu tarjeta ya está lista — reúne {{program_goal}} {{program_unit_plural}} y consigue {{reward_name}}.',
   'es', array['business_name','customer_first_name','program_goal','program_unit_plural','reward_name']),
  (null, 'birthday', 'Birthday', 'email',
   'Happy birthday, {{customer_first_name}}!',
   'Happy birthday from all of us at {{business_name}}. Your gift is waiting: {{reward_name}}.',
   'en', array['business_name','customer_first_name','reward_name']),
  (null, 'birthday', 'Cumpleaños', 'email',
   '¡Feliz cumpleaños, {{customer_first_name}}!',
   'Feliz cumpleaños de parte de todo el equipo de {{business_name}}. Te espera un regalo: {{reward_name}}.',
   'es', array['business_name','customer_first_name','reward_name']),
  (null, 'winback', 'Win-back', 'email',
   'We miss you at {{business_name}}',
   'It has been {{days_since_visit}} days, {{customer_first_name}}. Here is something to bring you back: {{reward_name}}.',
   'en', array['business_name','customer_first_name','days_since_visit','reward_name']),
  (null, 'winback', 'Te echamos de menos', 'email',
   'Te echamos de menos en {{business_name}}',
   'Han pasado {{days_since_visit}} días, {{customer_first_name}}. Te dejamos algo para volver: {{reward_name}}.',
   'es', array['business_name','customer_first_name','days_since_visit','reward_name']),
  (null, 'reward_unlocked', 'Reward unlocked', 'email',
   'Your reward at {{business_name}} is ready',
   'Nice work {{customer_first_name}} — you have earned {{reward_name}}. Show this at the counter on your next visit.',
   'en', array['business_name','customer_first_name','reward_name']),
  (null, 'reward_unlocked', 'Recompensa lista', 'email',
   'Tu recompensa en {{business_name}} está lista',
   '¡Enhorabuena {{customer_first_name}}! Has conseguido {{reward_name}}. Enséñalo en tu próxima visita.',
   'es', array['business_name','customer_first_name','reward_name']),
  (null, 'expiry_warning', 'Expiry warning', 'email',
   'Your {{program_unit_plural}} expire soon',
   '{{customer_first_name}}, you have {{balance}} {{program_unit_plural}} expiring on {{expiry_date}}. Use them before they are gone.',
   'en', array['customer_first_name','balance','program_unit_plural','expiry_date']),
  (null, 'expiry_warning', 'Caducidad próxima', 'email',
   'Tus {{program_unit_plural}} caducan pronto',
   '{{customer_first_name}}, tienes {{balance}} {{program_unit_plural}} que caducan el {{expiry_date}}. Úsalos antes de perderlos.',
   'es', array['customer_first_name','balance','program_unit_plural','expiry_date']),
  (null, 'anniversary', 'Anniversary', 'email',
   'One year with {{business_name}}',
   'It has been a year since you joined us, {{customer_first_name}}. Thank you — here is something to celebrate.',
   'en', array['business_name','customer_first_name']),
  (null, 'anniversary', 'Aniversario', 'email',
   'Un año con {{business_name}}',
   'Hace un año que te uniste, {{customer_first_name}}. Gracias — aquí tienes algo para celebrarlo.',
   'es', array['business_name','customer_first_name']),
  (null, 'review_request', 'Review request', 'email',
   'Would you share that with others?',
   'Thanks for the great feedback, {{customer_first_name}}! Would you leave {{business_name}} a quick public review? {{review_url}}',
   'en', array['business_name','customer_first_name','review_url']),
  (null, 'review_request', 'Solicitud de reseña', 'email',
   '¿Nos dejas una reseña?',
   '¡Gracias por tu valoración, {{customer_first_name}}! ¿Le dejarías una reseña pública a {{business_name}}? {{review_url}}',
   'es', array['business_name','customer_first_name','review_url']),
  (null, 'welcome', 'Welcome SMS', 'sms', null,
   '{{business_name}}: welcome {{customer_first_name}}! Your loyalty card is ready: {{card_url}}',
   'en', array['business_name','customer_first_name','card_url']),
  (null, 'welcome', 'Bienvenida SMS', 'sms', null,
   '{{business_name}}: ¡bienvenido {{customer_first_name}}! Tu tarjeta está lista: {{card_url}}',
   'es', array['business_name','customer_first_name','card_url']),
  (null, 'reward_unlocked', 'Reward push', 'push', 'Reward unlocked',
   'You have earned {{reward_name}} at {{business_name}}',
   'en', array['business_name','reward_name']),
  (null, 'reward_unlocked', 'Recompensa push', 'push', 'Recompensa desbloqueada',
   'Has conseguido {{reward_name}} en {{business_name}}',
   'es', array['business_name','reward_name'])
on conflict do nothing;
