-- =============================================================================
-- 000012 — New-business provisioning
--
-- One function that puts a brand-new workspace into exactly the same state as
-- the accounts backfilled in 000009: a working program, earning rules, a reward
-- catalogue, system segments, always-on automations and an NPS survey.
--
-- Having a single definition of "correctly set up" means signup and migration
-- can never drift apart, and an empty dashboard is impossible.
-- =============================================================================

create or replace function fidelio_provision_business(p_business_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business businesses;
  v_program_id uuid;
begin
  select * into v_business from businesses where id = p_business_id;
  if not found then
    raise exception 'Business % not found', p_business_id using errcode = 'no_data_found';
  end if;

  -- Default location -----------------------------------------------------
  insert into locations (business_id, name, city, country, is_default)
  select p_business_id, coalesce(v_business.name, 'Main location'), v_business.city,
         v_business.country, true
  where not exists (select 1 from locations where business_id = p_business_id);

  -- Loyalty program ------------------------------------------------------
  select id into v_program_id from loyalty_programs
   where business_id = p_business_id and is_default;

  if v_program_id is null then
    insert into loyalty_programs (
      business_id, name, type, is_default, unit_singular, unit_plural,
      goal_amount, reward_description, reset_on_reward
    ) values (
      p_business_id, 'Stamp card', 'stamps', true, 'stamp', 'stamps',
      coalesce(v_business.stamp_total, 10),
      coalesce(v_business.reward_description, 'A free item on us'),
      true
    )
    returning id into v_program_id;
  end if;

  -- Earning rules --------------------------------------------------------
  insert into earning_rules (business_id, program_id, name, trigger, award_type, award_amount, priority)
  select p_business_id, v_program_id, r.name, r.trigger, r.award_type, r.award_amount, r.priority
  from (values
    ('Stamp per visit', 'visit', 'fixed', 1, 100),
    ('Welcome stamp', 'signup', 'fixed', 1, 10),
    ('Referral bonus', 'referral', 'fixed', 2, 20),
    ('Friend welcome bonus', 'referred_signup', 'fixed', 1, 30)
  ) as r(name, trigger, award_type, award_amount, priority)
  where not exists (
    select 1 from earning_rules e
     where e.program_id = v_program_id and e.trigger = r.trigger
  );

  -- Reward catalogue -----------------------------------------------------
  insert into rewards (business_id, program_id, name, description, cost, type, sort_order)
  select p_business_id, v_program_id,
         coalesce(nullif(trim(v_business.reward_description), ''), 'Free item'),
         'Your main loyalty reward',
         coalesce(v_business.stamp_total, 10), 'free_item', 0
  where not exists (
    select 1 from rewards where program_id = v_program_id and auto_grant_trigger is null
  );

  insert into rewards (business_id, program_id, name, description, cost, type, auto_grant_trigger, valid_days, sort_order)
  select p_business_id, v_program_id, g.name, g.description, 0, 'free_item', g.trigger, g.valid_days, g.sort_order
  from (values
    ('Welcome gift', 'A small thank-you for joining', 'welcome', 30, 10),
    ('Birthday treat', 'On the house, happy birthday!', 'birthday', 14, 11),
    ('We miss you', 'Come back and enjoy this on us', 'winback', 21, 12)
  ) as g(name, description, trigger, valid_days, sort_order)
  where not exists (
    select 1 from rewards r where r.program_id = v_program_id and r.auto_grant_trigger = g.trigger
  );

  -- System segments ------------------------------------------------------
  insert into segments (business_id, name, description, is_system, key, definition)
  select p_business_id, s.name, s.description, true, s.key, s.definition::jsonb
  from (values
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

  -- Automations ----------------------------------------------------------
  insert into automations (
    business_id, name, description, is_active, trigger, trigger_config,
    delay_minutes, cooldown_days, actions
  )
  select p_business_id, a.name, a.description, a.is_active, a.trigger,
         a.trigger_config::jsonb, a.delay_minutes, a.cooldown_days, a.actions::jsonb
  from (values
    ('Welcome new members',
     'Greets every new member and gets them to their first reward',
     true, 'customer_joined', '{}', 5, 3650,
     '[{"type":"send_message","channel":"auto","template":"welcome"},{"type":"grant_reward","trigger":"welcome"}]'),
    ('Birthday treat',
     'Sends a gift on their birthday — the highest-converting message you can send',
     true, 'birthday', '{"days_before":0}', 0, 300,
     '[{"type":"send_message","channel":"auto","template":"birthday"},{"type":"grant_reward","trigger":"birthday"}]'),
    ('Win back inactive customers',
     'Reaches out when someone has not visited in a while',
     true, 'inactivity', '{"days":30}', 0, 60,
     '[{"type":"send_message","channel":"auto","template":"winback"},{"type":"grant_reward","trigger":"winback"}]'),
    ('Reward is ready',
     'Tells customers the moment they can claim — drives the next visit',
     true, 'reward_unlocked', '{}', 15, 7,
     '[{"type":"send_message","channel":"auto","template":"reward_unlocked"}]'),
    ('Balance expiring soon',
     'A gentle nudge before points expire',
     true, 'balance_expiring', '{"days_before":14}', 0, 30,
     '[{"type":"send_message","channel":"auto","template":"expiry_warning"}]'),
    ('Membership anniversary',
     'Celebrates one year since they joined',
     true, 'anniversary', '{}', 0, 300,
     '[{"type":"send_message","channel":"auto","template":"anniversary"}]'),
    ('Ask happy customers for a review',
     'Turns promoters into public reviews',
     false, 'nps_promoter', '{"min_score":9}', 60, 180,
     '[{"type":"send_message","channel":"auto","template":"review_request"}]'),
    ('Recover unhappy customers',
     'Alerts you privately so you can fix it before they tell everyone',
     true, 'nps_detractor', '{"max_score":6}', 0, 90,
     '[{"type":"notify_staff","title":"Unhappy customer"},{"type":"add_tag","tag":"needs-attention"}]'),
    ('Membership renewal reminder',
     'Tells members three days before they are charged, so a renewal is never a surprise',
     true, 'membership_renewal', '{}', 0, 20,
     '[{"type":"send_message","channel":"auto","template":"membership_renewal"}]')
  ) as a(name, description, is_active, trigger, trigger_config, delay_minutes, cooldown_days, actions)
  where not exists (
    select 1 from automations x where x.business_id = p_business_id and x.name = a.name
  );

  -- Survey ---------------------------------------------------------------
  insert into surveys (business_id, type, scale_max, is_active)
  select p_business_id, 'nps', 10, true
  where not exists (select 1 from surveys where business_id = p_business_id);

  return jsonb_build_object('business_id', p_business_id, 'program_id', v_program_id);
end;
$$;
