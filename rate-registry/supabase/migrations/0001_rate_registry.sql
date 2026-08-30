-- WhatIff rate registry — full schema, RLS, aggregate functions and anti-abuse.
--
-- Paste this whole file into the Supabase SQL editor (or run it via the
-- Supabase CLI as a migration). It is idempotent enough to re-run during
-- development, but on a live database run it once.
--
-- Security model in one line: the browser (the `anon` role) can INSERT a rate
-- and nothing else. It can never SELECT, UPDATE or DELETE a raw row. Every read
-- goes through a `security definer` function that returns aggregates (or the
-- bare list of rate values for a cohort) — never identifying columns.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create table if not exists public.rates (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  bank          text        not null,
  rate          numeric(4,2) not null,
  loan_year     int         not null,
  amount_lakh   int         not null,
  rate_type     text        not null,
  session_id    uuid        not null,
  excluded      boolean     not null default false,
  constraint rate_range   check (rate >= 6 and rate <= 15),
  constraint year_range   check (loan_year >= 2015 and loan_year <= 2026),
  constraint amt_allowed  check (amount_lakh in (20,35,50,75,100)),
  constraint type_allowed check (rate_type in ('Floating','Fixed')),
  constraint bank_allowed check (bank in (
    'SBI','HDFC Bank','ICICI Bank','Axis Bank','Kotak Mahindra','LIC Housing',
    'Bank of Baroda','PNB Housing','Bajaj Housing','IDFC First','Canara Bank','Union Bank'))
);

create index if not exists rates_bank_year_active_idx
  on public.rates (bank, loan_year) where excluded = false;

-- Helps the per-session rate-limit lookup.
create index if not exists rates_session_created_idx
  on public.rates (session_id, created_at);

-- ---------------------------------------------------------------------------
-- 2. Row-level security
--    Enable RLS, strip every default privilege, then grant INSERT only.
-- ---------------------------------------------------------------------------

alter table public.rates enable row level security;

revoke all on public.rates from anon, authenticated;

grant insert on public.rates to anon;
-- bigserial default needs the sequence to be usable by the inserting role.
grant usage, select on sequence public.rates_id_seq to anon;

-- No SELECT / UPDATE / DELETE policy exists, so those are all denied even
-- though RLS is on. Only this INSERT policy is present.
drop policy if exists rates_anon_insert on public.rates;
create policy rates_anon_insert
  on public.rates
  for insert
  to anon
  with check (true);

-- ---------------------------------------------------------------------------
-- 3. Anti-abuse: per-session rate limit (max 5 inserts / session / hour)
-- ---------------------------------------------------------------------------

create or replace function public.enforce_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent int;
begin
  select count(*) into v_recent
  from public.rates
  where session_id = new.session_id
    and created_at > now() - interval '1 hour';

  if v_recent >= 5 then
    raise exception 'rate_limit_exceeded: at most 5 submissions per hour'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_rate_limit on public.rates;
create trigger trg_rate_limit
  before insert on public.rates
  for each row execute function public.enforce_rate_limit();

-- ---------------------------------------------------------------------------
-- 4. Anti-abuse: outlier exclusion (run on every insert)
--    Any row more than 3 standard deviations from its bank's mean is flagged
--    excluded = true. The row is kept; it is just dropped from aggregates.
-- ---------------------------------------------------------------------------

create or replace function public.reclassify_bank_outliers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cnt  int;
  v_mean numeric;
  v_sd   numeric;
begin
  select count(*), avg(rate), stddev_samp(rate)
    into v_cnt, v_mean, v_sd
  from public.rates
  where bank = new.bank;

  -- Need a few points before a standard deviation means anything.
  if v_cnt >= 5 and v_sd is not null and v_sd > 0 then
    update public.rates
       set excluded = (abs(rate - v_mean) > 3 * v_sd)
     where bank = new.bank;
  end if;

  return null; -- AFTER trigger, return value ignored
end;
$$;

-- Fires on INSERT only; the UPDATE it issues does not re-enter this trigger.
drop trigger if exists trg_outliers on public.rates;
create trigger trg_outliers
  after insert on public.rates
  for each row execute function public.reclassify_bank_outliers();

-- ---------------------------------------------------------------------------
-- 5. Read path: security definer aggregate functions
--    These run as the function owner and so can read the table, but they only
--    ever return aggregates or a bare array of rate values.
-- ---------------------------------------------------------------------------

-- 5.1 Landing list: median rate per bank across all years.
--     Only banks with at least 4 active reports are returned, so a median is
--     never computed from fewer than 4 people.
create or replace function public.bank_medians()
returns table (bank text, median_rate numeric, n int)
language sql
security definer
set search_path = public
as $$
  select r.bank,
         round(percentile_cont(0.5) within group (order by r.rate)::numeric, 2) as median_rate,
         count(*)::int as n
  from public.rates r
  where r.excluded = false
  group by r.bank
  having count(*) >= 4
  order by median_rate asc;
$$;

-- 5.2 Cohort stats for the result screen.
--     Returns the bare list of rates in the cohort (for the dot plot), the
--     median and the count. If the bank+year cohort has fewer than 4 rows it
--     falls back to the bank across all years and sets fell_back = true.
--     median_rate is left NULL whenever the returned cohort still has < 4 rows,
--     so a median is never surfaced from fewer than 4 reports.
create or replace function public.cohort_stats(p_bank text, p_year int)
returns table (rates numeric[], median_rate numeric, n int, fell_back boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.rates r
  where r.excluded = false and r.bank = p_bank and r.loan_year = p_year;

  if v_count >= 4 then
    return query
      select array_agg(r.rate order by r.rate),
             round(percentile_cont(0.5) within group (order by r.rate)::numeric, 2),
             count(*)::int,
             false
      from public.rates r
      where r.excluded = false and r.bank = p_bank and r.loan_year = p_year;
  else
    return query
      select array_agg(r.rate order by r.rate),
             case when count(*) >= 4
                  then round(percentile_cont(0.5) within group (order by r.rate)::numeric, 2)
                  else null end,
             count(*)::int,
             true
      from public.rates r
      where r.excluded = false and r.bank = p_bank;
  end if;
end;
$$;

-- 5.3 Total active submission count for the header.
create or replace function public.total_count()
returns int
language sql
security definer
set search_path = public
as $$
  select count(*)::int from public.rates where excluded = false;
$$;

-- 5.4 Headline gap: the median absolute distance between an individual rate and
--     its own bank+year cohort median, plus the overall median rate and total
--     count. The client turns `gap` into a monthly EMI difference on a ₹50 lakh
--     loan, and only uses it once n >= 40.
create or replace function public.headline_gap()
returns table (gap numeric, base_rate numeric, n int)
language sql
security definer
set search_path = public
as $$
  with meds as (
    select bank, loan_year,
           percentile_cont(0.5) within group (order by rate) as med
    from public.rates
    where excluded = false
    group by bank, loan_year
  ),
  gaps as (
    select abs(r.rate - m.med) as g
    from public.rates r
    join meds m on m.bank = r.bank and m.loan_year = r.loan_year
    where r.excluded = false
  )
  select
    round(percentile_cont(0.5) within group (order by g)::numeric, 4),
    round((select percentile_cont(0.5) within group (order by rate)
           from public.rates where excluded = false)::numeric, 2),
    (select count(*)::int from public.rates where excluded = false)
  from gaps;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants on the read functions
--    Revoke the default PUBLIC execute, then grant to anon explicitly.
-- ---------------------------------------------------------------------------

revoke all on function public.bank_medians()            from public;
revoke all on function public.cohort_stats(text, int)   from public;
revoke all on function public.total_count()             from public;
revoke all on function public.headline_gap()            from public;

grant execute on function public.bank_medians()          to anon;
grant execute on function public.cohort_stats(text, int) to anon;
grant execute on function public.total_count()           to anon;
grant execute on function public.headline_gap()          to anon;

-- The trigger helper functions are never called directly by the client.
revoke all on function public.enforce_rate_limit()        from public;
revoke all on function public.reclassify_bank_outliers()  from public;
