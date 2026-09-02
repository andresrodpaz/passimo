-- =============================================================================
-- 006 — Customers and CRM
--
-- What the customer base looks like per workspace, whether the derived stats the
-- dashboard renders are actually derived, and whether the CRM surfaces (tags,
-- notes, VIP, segments, consent) have anything in them.
-- =============================================================================

\pset pager off

\echo
\echo '=== Customer base per workspace ==============================================='

select
  b.name as business,
  b.plan,
  count(*) as customers,
  count(*) filter (where c.is_vip) as vip,
  count(*) filter (where c.status = 'blocked') as blocked,
  count(*) filter (where c.anonymized_at is not null) as anonymised,
  count(*) filter (where c.last_visit > now() - interval '30 days') as active_30d,
  count(*) filter (where c.last_visit <= now() - interval '90 days') as lapsed_90d,
  count(*) filter (where c.last_visit is null) as never_visited,
  count(*) filter (where c.visit_count = 1) as one_time_only,
  count(*) filter (where c.visit_count >= 10) as regulars,
  count(*) filter (where c.birthday is not null) as with_birthday,
  count(*) filter (where c.phone is not null) as with_phone,
  count(*) filter (where c.consent_marketing) as marketing_opted_in,
  count(*) filter (where c.referred_by is not null) as referred,
  round(avg(c.visit_count), 1) as avg_visits,
  round(avg(c.lifetime_spend), 2) as avg_lifetime_spend,
  round(avg(c.average_ticket), 2) as avg_ticket
from customers c
join businesses b on b.id = c.business_id
group by b.name, b.plan
order by b.plan;

\echo
\echo '=== Does the demo cover every customer state a reviewer needs to see? ========='
-- A demo where every customer looks the same demonstrates nothing. These are the
-- states the dashboard has distinct UI for; a zero means a screen a reviewer
-- cannot exercise.

select
  case when least(active, vip, lapsed, reward_ready, recent, redeemers) > 0 then 'PASS' else 'WARNING' end as status,
  b.name as business,
  active as "active (visited 30d)",
  vip as "VIP",
  lapsed as "churn risk (90d+)",
  reward_ready as "reward available",
  recent as "joined in 30d",
  redeemers as "has redeemed",
  referred as "referral"
from businesses b
join lateral (
  select
    count(*) filter (where c.last_visit > now() - interval '30 days') as active,
    count(*) filter (where c.is_vip) as vip,
    count(*) filter (where c.last_visit <= now() - interval '90 days') as lapsed,
    count(*) filter (where c.created_at > now() - interval '30 days') as recent,
    count(*) filter (where c.referred_by is not null) as referred
  from customers c where c.business_id = b.id
) s on true
join lateral (
  select count(distinct a.customer_id) as reward_ready
  from loyalty_accounts a
  join loyalty_programs p on p.id = a.program_id
  where a.business_id = b.id and p.goal_amount is not null and a.balance >= p.goal_amount
) r on true
join lateral (
  select count(distinct rr.customer_id) as redeemers
  from reward_redemptions rr where rr.business_id = b.id
) d on true
where b.archived_at is null
order by b.plan;

\echo
\echo '=== Derived stats must be derived =============================================='
-- `visit_count`, `lifetime_spend` and `average_ticket` are computed from
-- `activity_events` by `passimo_recompute_customer_stats`. A customer whose
-- stored value disagrees with the events is a customer whose numbers the next
-- scan will silently change.

with derived as (
  select
    c.id,
    c.business_id,
    c.visit_count as stored_visits,
    c.lifetime_spend as stored_spend,
    count(e.id) filter (where e.type in ('purchase', 'visit')) as event_visits,
    coalesce(sum(e.amount) filter (where e.type = 'purchase'), 0) as event_spend
  from customers c
  left join activity_events e on e.customer_id = c.id
  where c.anonymized_at is null
  group by c.id, c.business_id, c.visit_count, c.lifetime_spend
)
select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as customers_whose_stats_disagree_with_their_events
from derived
where stored_visits <> event_visits
   or abs(stored_spend - event_spend) > 0.01;

\echo '--- A sample of the disagreements ---'
with derived as (
  select
    c.id, b.name as business, c.email,
    c.visit_count as stored_visits,
    c.lifetime_spend as stored_spend,
    count(e.id) filter (where e.type in ('purchase', 'visit')) as event_visits,
    coalesce(sum(e.amount) filter (where e.type = 'purchase'), 0) as event_spend
  from customers c
  join businesses b on b.id = c.business_id
  left join activity_events e on e.customer_id = c.id
  where c.anonymized_at is null
  group by c.id, b.name, c.email, c.visit_count, c.lifetime_spend
)
select business, email, stored_visits, event_visits, stored_spend, event_spend
from derived
where stored_visits <> event_visits or abs(stored_spend - event_spend) > 0.01
order by abs(stored_spend - event_spend) desc
limit 10;

\echo
\echo '=== Contact reachability ======================================================'
-- A customer with neither a real email nor a phone cannot be reached by any
-- channel, so every campaign silently skips them. Placeholder addresses at
-- `*.invalid` are the product''s own marker for "enrolled at the counter with no
-- contact details", and are expected — but the merchant should know how many.

select
  b.name as business,
  count(*) as customers,
  count(*) filter (where c.email is not null and c.email not like '%.invalid') as real_email,
  count(*) filter (where c.email like '%.invalid') as placeholder_email,
  count(*) filter (where c.phone is not null) as phone,
  count(*) filter (
    where (c.email is null or c.email like '%.invalid') and c.phone is null
  ) as unreachable
from customers c
join businesses b on b.id = c.business_id
where c.anonymized_at is null
group by b.name
order by b.name;

\echo
\echo '=== Duplicate customers within a workspace ====================================='
-- Email is unique per business by constraint, so a duplicate here means the
-- constraint is missing. Phone is not constrained, and a duplicate phone is a
-- merge candidate rather than a bug.

select
  case when count(*) = 0 then 'FAIL' else 'PASS' end as status,
  count(*) as unique_email_constraints_on_customers
from pg_constraint
where conrelid = 'customers'::regclass
  and contype = 'u'
  and pg_get_constraintdef(oid) ilike '%business_id%'
  and pg_get_constraintdef(oid) ilike '%email%';

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as duplicate_emails_within_a_workspace
from (
  select business_id, lower(email)
  from customers
  where email is not null and anonymized_at is null
  group by business_id, lower(email)
  having count(*) > 1
) d;

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as duplicate_phones_within_a_workspace
from (
  select business_id, phone
  from customers
  where phone is not null and anonymized_at is null
  group by business_id, phone
  having count(*) > 1
) d;

\echo
\echo '=== Referral codes ============================================================'
-- The code is the growth loop. A duplicate sends a referral to the wrong person;
-- a null means that customer cannot refer anybody.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as duplicate_referral_codes
from (
  select business_id, referral_code
  from customers
  where referral_code is not null
  group by business_id, referral_code
  having count(*) > 1
) d;

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as customers_without_a_referral_code
from customers
where referral_code is null and anonymized_at is null;

\echo
\echo '=== RFM and churn scoring ====================================================='
-- Populated by `passimo_recompute_rfm` and `passimo_recompute_churn_risk`. All
-- null means the nightly job has never run, and every segment and insight built
-- on them is empty.

select
  b.name as business,
  count(*) as customers,
  count(*) filter (where c.rfm_segment is not null) as scored,
  count(*) filter (where c.churn_risk is not null) as churn_scored,
  count(*) filter (where c.predicted_clv is not null) as clv_scored,
  string_agg(distinct c.rfm_segment, ', ') as segments_seen
from customers c
join businesses b on b.id = c.business_id
where c.anonymized_at is null
group by b.name
order by b.name;

\echo
\echo '=== Tags, notes and segments =================================================='

select
  b.name as business,
  (select count(*) from tags t where t.business_id = b.id) as tags_defined,
  (select count(*) from customer_tags ct where ct.business_id = b.id) as tag_assignments,
  (select count(*) from customer_notes n where n.business_id = b.id) as notes,
  (select count(*) from segments s where s.business_id = b.id) as segments,
  (select count(*) from segments s where s.business_id = b.id and s.is_system) as system_segments,
  (select count(*) from customer_imports i where i.business_id = b.id) as imports
from businesses b
where b.archived_at is null
order by b.name;

\echo
\echo '=== notes_count stays in step with the notes table ============================'
-- A denormalised counter kept by a trigger. If it drifts, the customer list shows
-- a note badge on a customer with no notes.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as customers_with_a_stale_notes_count
from customers c
where c.notes_count <> (select count(*) from customer_notes n where n.customer_id = c.id);

\echo
\echo '=== Consent and GDPR =========================================================='
-- A customer with marketing consent but no timestamp cannot be defended if
-- challenged: the record of *when* they agreed is the evidence.

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as consent_without_a_timestamp
from customers
where consent_marketing and consent_updated_at is null;

select
  count(*) as anonymised,
  count(*) filter (where deletion_requested_at is not null) as deletion_requested,
  count(*) filter (where merged_into_customer_id is not null) as merged
from customers
where anonymized_at is not null or deletion_requested_at is not null or merged_into_customer_id is not null;

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as anonymised_rows_still_holding_personal_data
from customers
where anonymized_at is not null
  and (
    (email is not null and email not like '%.invalid' and email not like 'anon%')
    or phone is not null
    or birthday is not null
  );

\echo
\echo '=== Outstanding data requests ================================================='

select b.name as business, d.*
from data_requests d
join businesses b on b.id = d.business_id
order by d.created_at desc
limit 20;
