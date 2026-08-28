-- =============================================================================
-- 000007 — Analytics
--
-- The original overview endpoint issued eleven sequential round trips (six of
-- them just to build a 6-point growth chart). Everything here answers in one
-- query so the dashboard renders in a single request, and the heavy lifting
-- happens next to the data instead of in a serverless function.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Headline KPIs + trend, one call
-- -----------------------------------------------------------------------------

create or replace function fidelio_analytics_overview(
  p_business_id uuid,
  p_days int default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from timestamptz := now() - make_interval(days => p_days);
  v_prev_from timestamptz := now() - make_interval(days => p_days * 2);
  v_result jsonb;
begin
  with customer_stats as (
    select
      count(*) filter (where status = 'active') as total_customers,
      count(*) filter (where status = 'active' and created_at >= v_from) as new_customers,
      count(*) filter (where status = 'active' and created_at >= v_prev_from and created_at < v_from) as prev_new_customers,
      count(*) filter (where status = 'active' and last_visit >= v_from) as active_customers,
      count(*) filter (where status = 'active' and (last_visit is null or last_visit < now() - interval '60 days')) as lapsed_customers,
      count(*) filter (where status = 'active' and visit_count > 1) as repeat_customers,
      count(*) filter (where is_vip) as vip_customers,
      coalesce(avg(nullif(lifetime_spend, 0)), 0) as avg_lifetime_spend,
      coalesce(avg(nullif(average_ticket, 0)), 0) as avg_ticket,
      coalesce(sum(lifetime_spend), 0) as total_revenue
    from customers
    where business_id = p_business_id and merged_into_customer_id is null
  ),
  event_stats as (
    select
      count(*) filter (where type in ('visit', 'purchase') and occurred_at >= v_from) as visits,
      count(*) filter (where type in ('visit', 'purchase') and occurred_at >= v_prev_from and occurred_at < v_from) as prev_visits,
      coalesce(sum(amount) filter (where type = 'purchase' and occurred_at >= v_from), 0) as revenue,
      coalesce(sum(amount) filter (where type = 'purchase' and occurred_at >= v_prev_from and occurred_at < v_from), 0) as prev_revenue,
      count(*) filter (where type = 'redeem' and occurred_at >= v_from) as redemptions
    from activity_events
    where business_id = p_business_id
      and occurred_at >= v_prev_from
  ),
  ledger_stats as (
    select
      coalesce((
        select sum(amount) from loyalty_ledger
         where business_id = p_business_id and entry_type = 'earn' and created_at >= v_from
      ), 0) as earned,
      coalesce((
        select sum(-amount) from loyalty_ledger
         where business_id = p_business_id and entry_type = 'redeem' and created_at >= v_from
      ), 0) as redeemed,
      coalesce((
        select sum(balance) from loyalty_accounts where business_id = p_business_id
      ), 0) as outstanding
  ),
  nps as (
    select
      count(*) as responses,
      /* Standard NPS: %promoters − %detractors, normalised to the survey scale. */
      case when count(*) = 0 then null else round(
        100.0 * (
          count(*) filter (where score >= (case when scale_max = 5 then 5 else 9 end))
          - count(*) filter (where score <= (case when scale_max = 5 then 3 else 6 end))
        ) / count(*), 1) end as nps_score,
      round(avg(score::numeric), 2) as avg_score
    from survey_responses
    where business_id = p_business_id and responded_at >= v_from
  ),
  growth as (
    select jsonb_agg(jsonb_build_object('month', month, 'customers', customers, 'visits', visits, 'revenue', revenue) order by month) as series
    from (
      select
        to_char(months.month, 'YYYY-MM') as month,
        (select count(*) from customers c
          where c.business_id = p_business_id
            and c.created_at >= months.month
            and c.created_at < months.month + interval '1 month') as customers,
        (select count(*) from activity_events e
          where e.business_id = p_business_id
            and e.type in ('visit', 'purchase')
            and e.occurred_at >= months.month
            and e.occurred_at < months.month + interval '1 month') as visits,
        (select coalesce(sum(amount), 0) from activity_events e
          where e.business_id = p_business_id
            and e.type = 'purchase'
            and e.occurred_at >= months.month
            and e.occurred_at < months.month + interval '1 month') as revenue
      from generate_series(
        date_trunc('month', now()) - interval '11 months',
        date_trunc('month', now()),
        interval '1 month'
      ) as months(month)
    ) monthly
  ),
  daily as (
    select jsonb_agg(jsonb_build_object('date', to_char(d.day, 'YYYY-MM-DD'), 'visits', v.visits, 'revenue', v.revenue) order by d.day) as series
    from generate_series(date_trunc('day', v_from), date_trunc('day', now()), interval '1 day') as d(day)
    left join lateral (
      select count(*) filter (where type in ('visit', 'purchase')) as visits,
             coalesce(sum(amount) filter (where type = 'purchase'), 0) as revenue
        from activity_events e
       where e.business_id = p_business_id
         and e.occurred_at >= d.day
         and e.occurred_at < d.day + interval '1 day'
    ) v on true
  ),
  top_rewards as (
    select coalesce(jsonb_agg(t order by t.redemptions desc), '[]'::jsonb) as list
    from (
      select r.id, r.name, count(rr.id) as redemptions
        from rewards r
        left join reward_redemptions rr on rr.reward_id = r.id and rr.created_at >= v_from
       where r.business_id = p_business_id
       group by r.id, r.name
       having count(rr.id) > 0
       order by count(rr.id) desc
       limit 5
    ) t
  ),
  top_customers as (
    select coalesce(jsonb_agg(t order by t.lifetime_spend desc), '[]'::jsonb) as list
    from (
      select c.id, c.name, c.email::text as email, c.lifetime_spend, c.visit_count, c.is_vip
        from customers c
       where c.business_id = p_business_id and c.status = 'active'
       order by c.lifetime_spend desc, c.visit_count desc
       limit 10
    ) t
  )
  select jsonb_build_object(
    'period_days', p_days,
    'customers', jsonb_build_object(
      'total', cs.total_customers,
      'new', cs.new_customers,
      'new_previous', cs.prev_new_customers,
      'active', cs.active_customers,
      'lapsed', cs.lapsed_customers,
      'vip', cs.vip_customers,
      'repeat_rate', case when cs.total_customers = 0 then 0
                          else round(100.0 * cs.repeat_customers / cs.total_customers, 1) end,
      'retention_rate', case when cs.total_customers = 0 then 0
                             else round(100.0 * cs.active_customers / cs.total_customers, 1) end,
      'churn_rate', case when cs.total_customers = 0 then 0
                         else round(100.0 * cs.lapsed_customers / cs.total_customers, 1) end
    ),
    'revenue', jsonb_build_object(
      'period', es.revenue,
      'previous', es.prev_revenue,
      'lifetime', cs.total_revenue,
      'average_ticket', round(cs.avg_ticket, 2),
      'average_clv', round(cs.avg_lifetime_spend, 2)
    ),
    'engagement', jsonb_build_object(
      'visits', es.visits,
      'visits_previous', es.prev_visits,
      'redemptions', es.redemptions,
      'balance_earned', ls.earned,
      'balance_redeemed', ls.redeemed,
      'balance_outstanding', ls.outstanding
    ),
    'nps', jsonb_build_object(
      'score', n.nps_score,
      'responses', n.responses,
      'average', n.avg_score
    ),
    'growth', coalesce(g.series, '[]'::jsonb),
    'daily', coalesce(dl.series, '[]'::jsonb),
    'top_rewards', tr.list,
    'top_customers', tc.list
  )
  into v_result
  from customer_stats cs, event_stats es, ledger_stats ls, nps n,
       growth g, daily dl, top_rewards tr, top_customers tc;

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Cohort retention — the chart that tells a merchant whether loyalty is working
-- -----------------------------------------------------------------------------

create or replace function fidelio_cohort_retention(
  p_business_id uuid,
  p_months int default 6
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with cohorts as (
    select c.id,
           date_trunc('month', c.created_at) as cohort_month
      from customers c
     where c.business_id = p_business_id
       and c.status = 'active'
       and c.created_at >= date_trunc('month', now()) - make_interval(months => p_months - 1)
  ),
  activity as (
    select co.cohort_month,
           co.id as customer_id,
           floor(
             extract(epoch from (date_trunc('month', e.occurred_at) - co.cohort_month)) / 2629746
           )::int as month_index
      from cohorts co
      join activity_events e
        on e.customer_id = co.id
       and e.business_id = p_business_id
       and e.type in ('visit', 'purchase')
  ),
  sizes as (
    select cohort_month, count(*) as size from cohorts group by cohort_month
  )
  select coalesce(jsonb_agg(item order by item ->> 'cohort'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'cohort', to_char(s.cohort_month, 'YYYY-MM'),
      'size', s.size,
      'retention', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'month', idx.month_index,
                 'customers', coalesce(a.retained, 0),
                 'rate', case when s.size = 0 then 0
                              else round(100.0 * coalesce(a.retained, 0) / s.size, 1) end
               ) order by idx.month_index), '[]'::jsonb)
          from generate_series(0, p_months - 1) as idx(month_index)
          left join (
            select month_index, count(distinct customer_id) as retained
              from activity
             where cohort_month = s.cohort_month
             group by month_index
          ) a on a.month_index = idx.month_index
      )
    ) as item
    from sizes s
  ) cohort_rows;
$$;

-- -----------------------------------------------------------------------------
-- Churn model — a transparent, explainable heuristic
--
-- Deliberately not a black box: risk is a function of how overdue a customer is
-- relative to *their own* visit rhythm, damped by how much history we have.
-- Merchants trust a number they can reason about, and the AI layer can quote it.
-- -----------------------------------------------------------------------------

create or replace function fidelio_recompute_churn_risk(p_business_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_median_gap numeric;
begin
  -- Fallback rhythm for customers with too little history of their own.
  select coalesce(percentile_cont(0.5) within group (order by days_between_visits), 30)
    into v_median_gap
    from customers
   where business_id = p_business_id and days_between_visits is not null;

  with scored as (
    select
      c.id,
      least(0.99, greatest(0.01, round(
        (
          -- Overdue ratio: 1.0 means "a full expected gap late".
          least(3.0,
            extract(epoch from (now() - coalesce(c.last_visit, c.created_at))) / 86400.0
            / greatest(1, coalesce(c.days_between_visits, v_median_gap))
          ) / 3.0
        ) * (
          -- Confidence weight: a one-visit customer is inherently uncertain.
          case when c.visit_count >= 5 then 1.0
               when c.visit_count >= 2 then 0.8
               else 0.6 end
        )
      , 4))) as risk,
      coalesce(c.average_ticket, 0) as ticket,
      greatest(1, coalesce(c.visit_count, 1)) as visits
    from customers c
    where c.business_id = p_business_id
      and c.status = 'active'
      and c.merged_into_customer_id is null
  )
  update customers c
     set churn_risk = s.risk,
         -- Expected future value scales with survival probability.
         predicted_clv = round(s.ticket * s.visits * (1 + (1 - s.risk) * 2), 2),
         stats_updated_at = now()
    from scored s
   where c.id = s.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Campaign attribution — did the campaign actually cause visits?
-- -----------------------------------------------------------------------------

create or replace function fidelio_attribute_campaign(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign campaigns;
  v_visits int;
  v_revenue numeric;
begin
  select * into v_campaign from campaigns where id = p_campaign_id;
  if not found then return null; end if;

  -- A visit counts as attributed when it happens after the message was sent
  -- and inside the attribution window, for a customer who received it.
  select count(distinct e.id), coalesce(sum(e.amount), 0)
    into v_visits, v_revenue
    from messages m
    join activity_events e
      on e.customer_id = m.customer_id
     and e.business_id = m.business_id
     and e.type in ('visit', 'purchase')
     and e.occurred_at > m.sent_at
     and e.occurred_at <= m.sent_at + make_interval(days => v_campaign.attribution_window_days)
   where m.campaign_id = p_campaign_id
     and m.sent_at is not null;

  update campaigns
     set attributed_visits = v_visits,
         attributed_revenue = v_revenue
   where id = p_campaign_id;

  return jsonb_build_object('visits', v_visits, 'revenue', v_revenue);
end;
$$;

-- -----------------------------------------------------------------------------
-- Business-level anomaly detection feed for the AI layer
-- -----------------------------------------------------------------------------

create or replace function fidelio_detect_anomalies(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with recent as (
    select date_trunc('day', occurred_at) as day,
           count(*) filter (where type in ('visit', 'purchase')) as visits,
           coalesce(sum(amount) filter (where type = 'purchase'), 0) as revenue
      from activity_events
     where business_id = p_business_id
       and occurred_at >= now() - interval '60 days'
     group by 1
  ),
  stats as (
    select avg(visits) as avg_visits,
           coalesce(stddev_samp(visits), 0) as sd_visits,
           avg(revenue) as avg_revenue,
           coalesce(stddev_samp(revenue), 0) as sd_revenue
      from recent
     where day < date_trunc('day', now()) - interval '7 days'
  )
  select jsonb_build_object(
    'baseline', jsonb_build_object(
      'avg_daily_visits', round(coalesce(s.avg_visits, 0), 2),
      'avg_daily_revenue', round(coalesce(s.avg_revenue, 0), 2)
    ),
    'outliers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', to_char(r.day, 'YYYY-MM-DD'),
        'visits', r.visits,
        'revenue', r.revenue,
        'visit_z', case when s.sd_visits = 0 then 0 else round((r.visits - s.avg_visits) / s.sd_visits, 2) end,
        'revenue_z', case when s.sd_revenue = 0 then 0 else round((r.revenue - s.avg_revenue) / s.sd_revenue, 2) end
      ) order by r.day desc)
      from recent r
      where r.day >= date_trunc('day', now()) - interval '14 days'
        and (
          (s.sd_visits > 0 and abs(r.visits - s.avg_visits) > 2 * s.sd_visits)
          or (s.sd_revenue > 0 and abs(r.revenue - s.avg_revenue) > 2 * s.sd_revenue)
        )
    ), '[]'::jsonb)
  )
  from stats s;
$$;
