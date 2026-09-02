-- =============================================================================
-- 010 — Campaigns, automations and messaging
--
-- What has been sent, to whom, whether anybody was reachable, and what it did.
-- The recurring failure in this area is a campaign that "sent" to an audience of
-- zero, which looks identical to a broken send.
-- =============================================================================

\pset pager off

\echo
\echo '=== Every campaign ============================================================'

select
  b.name as business,
  b.plan,
  c.name as campaign,
  c.type,
  c.status,
  c.channels,
  s.name as segment,
  c.scheduled_at,
  c.reach_count as reach,
  c.sent_count as sent,
  c.delivered_count as delivered,
  c.opened_count as opened,
  c.clicked_count as clicked,
  c.failed_count as failed,
  c.unsubscribed_count as unsubscribed,
  c.attributed_visits as visits,
  round(c.attributed_revenue, 2) as revenue,
  c.generated_by_ai as ai
from campaigns c
join businesses b on b.id = c.business_id
left join segments s on s.id = c.segment_id
order by b.name, c.created_at desc;

\echo
\echo '=== Campaign coverage per workspace ==========================================='
-- Which campaign types each workspace has. A workspace with only `manual`
-- campaigns has never used the templates, which is where the value is.

select
  b.name as business,
  b.plan,
  count(*) as campaigns,
  count(*) filter (where c.status = 'draft') as draft,
  count(*) filter (where c.status = 'scheduled') as scheduled,
  count(*) filter (where c.status = 'sending') as sending,
  count(*) filter (where c.status = 'sent') as sent,
  count(distinct c.type) as distinct_types,
  string_agg(distinct c.type, ', ' order by c.type) as types
from businesses b
left join campaigns c on c.business_id = b.id
where b.archived_at is null
group by b.name, b.plan
order by b.plan;

\echo
\echo '=== Campaigns that could not have reached anybody ============================='
-- A sent campaign with zero reach, or an email campaign in a workspace where
-- nobody has marketing consent. Both produce a report of zeroes that the merchant
-- reads as a bug in the product.

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as sends_that_reached_nobody
from campaigns c
where c.status in ('sent', 'sending') and coalesce(c.sent_count, 0) = 0;

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as workspaces_with_campaigns_but_no_consenting_customers
from businesses b
where exists (select 1 from campaigns c where c.business_id = b.id)
  and not exists (
    select 1 from customers cu
    where cu.business_id = b.id and cu.consent_marketing and cu.anonymized_at is null
  );

\echo
\echo '=== Reachable audience per workspace and channel =============================='
-- The denominator behind every campaign report.

select
  b.name as business,
  count(*) filter (where c.consent_marketing) as marketing_consent,
  count(*) filter (where c.consent_marketing and c.consent_email and c.email is not null and c.email not like '%.invalid') as email_reachable,
  count(*) filter (where c.consent_marketing and c.consent_sms and c.phone is not null) as sms_reachable,
  count(*) filter (where c.consent_marketing and c.consent_whatsapp and c.phone is not null) as whatsapp_reachable,
  count(*) filter (where c.consent_push) as push_consent,
  (select count(*) from suppressions s where s.business_id = b.id) as suppressed
from customers c
join businesses b on b.id = c.business_id
where c.anonymized_at is null and c.status = 'active'
group by b.name, b.id
order by b.name;

\echo
\echo '=== Campaign copy completeness ================================================'
-- A campaign that declares a channel it has no body for sends an empty message.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as campaigns_missing_copy_for_a_declared_channel
from campaigns c
where c.status in ('scheduled', 'sending', 'sent')
  and (
    ('email' = any (c.channels) and coalesce(c.body_html, c.body_text, '') = '')
    or ('sms' = any (c.channels) and coalesce(c.sms_body, '') = '')
    or ('whatsapp' = any (c.channels) and coalesce(c.whatsapp_body, '') = '')
    or ('push' = any (c.channels) and coalesce(c.push_body, '') = '')
    or ('wallet' = any (c.channels) and coalesce(c.wallet_message, '') = '')
  );

select b.name as business, c.name as campaign, c.status, c.channels
from campaigns c
join businesses b on b.id = c.business_id
where c.status in ('scheduled', 'sending', 'sent')
  and (
    ('email' = any (c.channels) and coalesce(c.body_html, c.body_text, '') = '')
    or ('sms' = any (c.channels) and coalesce(c.sms_body, '') = '')
    or ('whatsapp' = any (c.channels) and coalesce(c.whatsapp_body, '') = '')
    or ('push' = any (c.channels) and coalesce(c.push_body, '') = '')
    or ('wallet' = any (c.channels) and coalesce(c.wallet_message, '') = '')
  )
order by b.name;

\echo
\echo '=== Scheduling sanity ========================================================='

select
  case when count(*) = 0 then 'PASS' else 'WARNING' end as status,
  count(*) as scheduling_problems
from campaigns
where (status = 'scheduled' and scheduled_at is null)
   or (status = 'scheduled' and scheduled_at < now() - interval '1 day')
   or (status = 'draft' and scheduled_at is not null)
   or (send_window_start is not null and send_window_end is not null and send_window_start >= send_window_end);

select
  b.name as business, c.name as campaign, c.status, c.scheduled_at,
  case
    when c.status = 'scheduled' and c.scheduled_at is null then 'scheduled with no date'
    when c.status = 'scheduled' and c.scheduled_at < now() - interval '1 day'
      then 'overdue by ' || (now()::date - c.scheduled_at::date) || ' days — the scheduler is not running'
    when c.status = 'draft' and c.scheduled_at is not null then 'draft with a date — will not send'
    else 'inverted send window'
  end as finding
from campaigns c
join businesses b on b.id = c.business_id
where (c.status = 'scheduled' and c.scheduled_at is null)
   or (c.status = 'scheduled' and c.scheduled_at < now() - interval '1 day')
   or (c.status = 'draft' and c.scheduled_at is not null)
   or (c.send_window_start is not null and c.send_window_end is not null and c.send_window_start >= c.send_window_end)
order by b.name;

\echo
\echo '=== Counter consistency ======================================================='
-- `delivered + failed` can never exceed `sent`, and opens can never exceed
-- deliveries. A violation means a counter is being incremented twice.

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as campaigns_with_impossible_counters
from campaigns
where coalesce(delivered_count, 0) + coalesce(failed_count, 0) > coalesce(sent_count, 0)
   or coalesce(opened_count, 0) > coalesce(delivered_count, 0)
   or coalesce(clicked_count, 0) > coalesce(opened_count, 0)
   or coalesce(sent_count, 0) > coalesce(reach_count, 0);

\echo
\echo '=== Automations ==============================================================='

select
  b.name as business,
  b.plan,
  a.name as automation,
  a.trigger,
  a.is_active as active,
  a.delay_minutes as delay,
  a.cooldown_days as cooldown,
  s.name as segment,
  a.enrolled_count as enrolled,
  a.completed_count as completed,
  a.attributed_visits as visits,
  round(a.attributed_revenue, 2) as revenue,
  jsonb_array_length(a.actions) as actions
from automations a
join businesses b on b.id = a.business_id
left join segments s on s.id = a.segment_id
order by b.name, a.trigger;

\echo
\echo '=== Automations that cannot do anything ======================================='

select
  case when count(*) = 0 then 'PASS' else 'FAIL' end as status,
  count(*) as broken_automations
from automations a
where a.is_active
  and (
    a.actions is null
    or jsonb_array_length(a.actions) = 0
    or (a.segment_id is not null and not exists (select 1 from segments s where s.id = a.segment_id))
  );

\echo
\echo '=== Automation runs ==========================================================='

select
  b.name as business,
  a.name as automation,
  count(*) as runs,
  count(*) filter (where r.status = 'completed') as completed,
  count(*) filter (where r.status = 'failed') as failed,
  count(*) filter (where r.status = 'pending') as pending,
  max(r.created_at) as most_recent
from automation_runs r
join automations a on a.id = r.automation_id
join businesses b on b.id = r.business_id
group by b.name, a.name
order by b.name;

\echo
\echo '=== Messages ==================================================================='

select
  b.name as business,
  m.channel,
  m.status,
  count(*) as messages,
  max(m.created_at) as most_recent
from messages m
join businesses b on b.id = m.business_id
group by b.name, m.channel, m.status
order by b.name, m.channel;

\echo
\echo '=== Message failures worth reading ============================================'

select b.name as business, m.channel, m.status, m.error, count(*) as occurrences
from messages m
join businesses b on b.id = m.business_id
where m.status in ('failed', 'bounced')
group by b.name, m.channel, m.status, m.error
order by count(*) desc
limit 20;

\echo
\echo '=== Suppression list =========================================================='
-- Unsubscribes and hard bounces. Sending to a suppressed address is the fastest
-- way to lose a sending domain.

select b.name as business, s.channel, s.reason, count(*) as addresses
from suppressions s
join businesses b on b.id = s.business_id
group by b.name, s.channel, s.reason
order by b.name;
