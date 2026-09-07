-- WhatIff home-loan registry (v2) — schema, RLS, anti-abuse and read functions.
--
-- Paste this whole file into the Supabase SQL editor (run once) or apply it via
-- the Supabase CLI.
--
-- Security model in one line: the browser (the `anon` role) has NO direct
-- privilege on either table — no SELECT, INSERT, UPDATE or DELETE. Every write
-- goes through a `security definer` RPC that returns only an id (never a raw
-- row); every read goes through a `security definer` RPC that returns only
-- aggregates. So raw rows — and every contact detail — are unreadable from the
-- client. See the note at the bottom and the README for how to verify this.
--
-- Why writes are RPCs, not a direct `insert().select('id')`: PostgREST can only
-- return an inserted row's id if a SELECT policy lets the caller read that row,
-- which would defeat the no-read guarantee. An RPC returns the id alone.

-- ---------------------------------------------------------------------------
-- 1. Tables
--    The schema carries Home, Business and Personal from day one so the table
--    never needs migrating when Business ships. Only Home is wired in the UI.
-- ---------------------------------------------------------------------------

create table if not exists public.rates (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  loan_type     text not null default 'Home',
  bank          text not null,
  rate          numeric(4,2) not null,
  loan_year     int  not null,
  amount_lakh   int  not null,
  rate_type     text not null,
  channel       text not null,
  employment    text,          -- home and personal loans only
  cmr_band      int,           -- business loans only, 1 to 7
  turnover_cr   int,           -- business loans only, banded
  city          text,
  session_id    uuid not null,
  excluded      boolean not null default false,
  exclude_reason text,          -- why a row is excluded: 'outlier', 'below_rllr', 'superseded'
  constraint rate_range  check (rate >= 6 and rate <= 15),
  constraint year_range  check (loan_year >= 2015 and loan_year <= 2026),
  constraint amt_allowed check (amount_lakh in (20,35,50,75,100,150)),
  constraint type_allowed check (rate_type in ('Floating','Fixed')),
  constraint chan_allowed check (channel in ('Branch','Agent or DSA','Online','Builder tie-up','Don''t remember')),
  constraint type_ok      check (loan_type in ('Home','Business','Personal')),
  constraint emp_allowed  check (employment is null or employment in ('Salaried','Self-employed')),
  constraint cmr_ok       check (cmr_band is null or cmr_band between 1 and 7),
  -- home and personal require employment; business requires CMR
  constraint fields_by_type check (
    (loan_type in ('Home','Personal') and employment is not null and cmr_band is null)
    or (loan_type = 'Business' and cmr_band is not null and employment is null)),
  constraint bank_allowed check (bank in (
    'SBI','HDFC Bank','ICICI Bank','Axis Bank','Kotak Mahindra','LIC Housing',
    'Bank of Baroda','PNB Housing','Bajaj Housing','IDFC First','Canara Bank',
    'Union Bank','Tata Capital','Godrej Housing','Other'))
);

create index if not exists rates_home_cohort_idx
  on public.rates (loan_type, bank, loan_year, channel, employment) where excluded = false;
create index if not exists rates_business_cohort_idx
  on public.rates (loan_type, cmr_band, turnover_cr) where excluded = false and loan_type = 'Business';
create index if not exists rates_session_idx
  on public.rates (session_id, created_at);

create table if not exists public.outcomes (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  rate_id     bigint references public.rates(id),
  email       text not null,
  door        text not null,
  result      text,
  new_rate    numeric(4,2),
  notes       text,
  constraint door_allowed check (door in ('Nothing','Conversion','Transfer'))
);
-- One outcomes row per rate submission (a second door updates it in place).
create unique index if not exists outcomes_rate_id_uidx on public.outcomes (rate_id);

-- Reference benchmarks — NOT crowd data. Published lender/regulator figures used
-- (a) to verify submissions against a real floor, and (b) to show the advertised
-- rate next to the achievable one. Every row is auditable: `source_url` and
-- `as_of` are REQUIRED, so no unsourced number can enter. This table ships EMPTY
-- — populate it only from primary sources (RBI for repo; each bank's own rate-
-- card / RLLR disclosure). See supabase/seed_benchmarks.example.sql. All rate
-- reasoning uses the CURRENT benchmark for floating loans (they reset to it) and
-- the origination-period benchmark for fixed loans.
create table if not exists public.benchmarks (
  id              bigserial primary key,
  bank            text not null,
  effective_from  date not null,              -- date this figure took effect at the bank
  repo_rate       numeric(4,2),               -- RBI repo at effective_from (national)
  rllr            numeric(4,2),               -- bank Repo-Linked Lending Rate (floating floor)
  mclr            numeric(4,2),               -- optional, for pre-2019 (MCLR-regime) loans
  advertised_floor numeric(4,2),              -- the "from X%" the bank markets
  source_url      text not null,              -- REQUIRED: where this number was read
  as_of           date not null,              -- REQUIRED: the date it was verified/captured
  note            text,
  constraint bm_bank_allowed check (bank in (
    'SBI','HDFC Bank','ICICI Bank','Axis Bank','Kotak Mahindra','LIC Housing',
    'Bank of Baroda','PNB Housing','Bajaj Housing','IDFC First','Canara Bank',
    'Union Bank','Tata Capital','Godrej Housing','Other'))
);
create unique index if not exists benchmarks_bank_from_uidx on public.benchmarks (bank, effective_from);

-- ---------------------------------------------------------------------------
-- 2. Row-level security
--    Enable RLS and strip every default privilege from anon/authenticated.
--    No table DML is granted at all; the RPCs below (security definer) are the
--    only access path.
-- ---------------------------------------------------------------------------

alter table public.rates      enable row level security;
alter table public.outcomes   enable row level security;
alter table public.benchmarks enable row level security;

revoke all on public.rates      from anon, authenticated;
revoke all on public.outcomes   from anon, authenticated;
revoke all on public.benchmarks from anon, authenticated;
revoke all on sequence public.rates_id_seq      from anon, authenticated;
revoke all on sequence public.outcomes_id_seq   from anon, authenticated;
revoke all on sequence public.benchmarks_id_seq from anon, authenticated;

-- No policies are defined, so with RLS enabled every direct anon operation is
-- denied even if a grant were ever added by mistake. Defense in depth.

-- ---------------------------------------------------------------------------
-- 3. Anti-abuse
-- ---------------------------------------------------------------------------

-- 3.1 Rate limit: at most 5 inserts per session per hour.
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

-- 3.2 Outlier exclusion: flag any row more than 3 SD from its bank mean.
--     Exclusion is monotonic (only ever set true) so it coexists with the
--     correction logic in submit_rate, which also sets excluded = true on a
--     superseded row. The row is kept; it is only dropped from aggregates.
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
  where loan_type = new.loan_type and bank = new.bank;

  if v_cnt >= 5 and v_sd is not null and v_sd > 0 then
    update public.rates
       set excluded = true, exclude_reason = 'outlier'
     where loan_type = new.loan_type and bank = new.bank
       and excluded = false
       and abs(rate - v_mean) > 3 * v_sd;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_outliers on public.rates;
create trigger trg_outliers
  after insert on public.rates
  for each row execute function public.reclassify_bank_outliers();

-- ---------------------------------------------------------------------------
-- 4. Write path (security definer RPCs)
-- ---------------------------------------------------------------------------

-- 4.1 Submit a rate. Returns the new row id (and nothing else).
--     * Identical resubmit within the same session+loan_type -> returns the
--       existing id without inserting (back-button safety, belt-and-braces
--       with the client-side dedupe).
--     * A changed resubmit is a correction: the new row is inserted and the
--       prior rows for this session+loan_type are marked excluded = true.
create or replace function public.submit_rate(
  p_session_id  uuid,
  p_loan_type   text,
  p_bank        text,
  p_rate        numeric,
  p_loan_year   int,
  p_amount_lakh int,
  p_rate_type   text,
  p_channel     text,
  p_employment  text default null,
  p_cmr_band    int  default null,
  p_turnover_cr int  default null,
  p_city        text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last public.rates%rowtype;
  v_id   bigint;
begin
  -- Most recent live row for this session + loan type.
  select * into v_last
  from public.rates
  where session_id = p_session_id and loan_type = p_loan_type and excluded = false
  order by created_at desc, id desc
  limit 1;

  -- Identical to the last one? Return it, do not insert.
  if found
     and v_last.bank = p_bank
     and v_last.rate = p_rate
     and v_last.loan_year = p_loan_year
     and v_last.amount_lakh = p_amount_lakh
     and v_last.rate_type = p_rate_type
     and v_last.channel = p_channel
     and v_last.employment is not distinct from p_employment
     and v_last.cmr_band is not distinct from p_cmr_band
  then
    return v_last.id;
  end if;

  insert into public.rates(
    session_id, loan_type, bank, rate, loan_year, amount_lakh, rate_type,
    channel, employment, cmr_band, turnover_cr, city)
  values (
    p_session_id, p_loan_type, p_bank, p_rate, p_loan_year, p_amount_lakh, p_rate_type,
    p_channel, p_employment, p_cmr_band, p_turnover_cr, p_city)
  returning id into v_id;

  -- Benchmark verification: a FLOATING loan cannot legally price below the
  -- bank's current RLLR. If we have a verified RLLR for this bank, a sub-RLLR
  -- floating submission is almost certainly a data-entry error — keep the row
  -- but drop it from aggregates. Skipped entirely when no benchmark is on file,
  -- so the check degrades gracefully to nothing until the table is populated.
  if p_rate_type = 'Floating' then
    declare v_rllr numeric;
    begin
      select rllr into v_rllr
      from public.benchmarks
      where bank = p_bank and rllr is not null and effective_from <= now()::date
      order by effective_from desc
      limit 1;

      if v_rllr is not null and p_rate < v_rllr - 0.25 then
        update public.rates
           set excluded = true, exclude_reason = 'below_rllr'
         where id = v_id;
      end if;
    end;
  end if;

  -- Supersede earlier submissions from this session + loan type.
  update public.rates
     set excluded = true, exclude_reason = 'superseded'
   where session_id = p_session_id and loan_type = p_loan_type
     and id <> v_id and excluded = false;

  return v_id;
end;
$$;

-- 4.2 Record an opened door with an email. Upserts on rate_id, so opening a
--     second door in the same session updates the row rather than duplicating.
create or replace function public.record_outcome(
  p_rate_id bigint,
  p_door    text,
  p_email   text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  insert into public.outcomes(rate_id, door, email)
  values (p_rate_id, p_door, p_email)
  on conflict (rate_id) do update
    set door = excluded.door, email = excluded.email
  returning id into v_id;
  return v_id;
end;
$$;

-- 4.3 Three-week follow-up. Updates the outcome by id (the id is the token the
--     follow-up link carries). Free text `notes` is the negotiation playbook.
create or replace function public.record_followup(
  p_outcome_id bigint,
  p_result     text,
  p_new_rate   numeric default null,
  p_notes      text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.outcomes
     set result = p_result, new_rate = p_new_rate, notes = p_notes
   where id = p_outcome_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Read path (security definer, aggregates only)
-- ---------------------------------------------------------------------------

-- 5.1 Landing: achievable rate per bank for one loan type. Banks with fewer
--     than 4 active reports are omitted (never a median from < 4). Cheapest
--     achievable (p25) first.
create or replace function public.bank_rates(p_loan_type text default 'Home')
returns table (bank text, p25_rate numeric, median_rate numeric, n int)
language sql
security definer
set search_path = public
as $$
  select r.bank,
         round(percentile_cont(0.25) within group (order by r.rate)::numeric, 2) as p25_rate,
         round(percentile_cont(0.50) within group (order by r.rate)::numeric, 2) as median_rate,
         count(*)::int as n
  from public.rates r
  where r.excluded = false and r.loan_type = p_loan_type
  group by r.bank
  having count(*) >= 4
  order by p25_rate asc;
$$;

-- 5.2 Per-bank-per-year aggregate, used by the static aggregate page generator.
--     Only cells with >= 4 active reports are returned.
create or replace function public.bank_year_rates(
  p_loan_type text default 'Home',
  p_bank      text default null)
returns table (bank text, loan_year int, p25_rate numeric, median_rate numeric, n int)
language sql
security definer
set search_path = public
as $$
  select r.bank, r.loan_year,
         round(percentile_cont(0.25) within group (order by r.rate)::numeric, 2),
         round(percentile_cont(0.50) within group (order by r.rate)::numeric, 2),
         count(*)::int
  from public.rates r
  where r.excluded = false and r.loan_type = p_loan_type
    and (p_bank is null or r.bank = p_bank)
  group by r.bank, r.loan_year
  having count(*) >= 4
  order by r.bank, r.loan_year;
$$;

-- 5.3 Cohort match with graceful widening. Returns the tightest tier that has
--     at least 4 rows, with the bare list of cohort rates (for the dot plot),
--     p25, median, count, tier number and a human label. When even the widest
--     tier has < 4 rows, median/p25 come back NULL so nothing is shown.
create or replace function public.cohort_stats(
  p_loan_type  text,
  p_bank       text,
  p_year       int,
  p_channel    text,
  p_employment text)
returns table (
  rates numeric[], median_rate numeric, p25_rate numeric,
  n int, tier int, tier_label text)
language plpgsql
security definer
set search_path = public
as $$
declare
  t       int;
  v_tier  int  := 4;                 -- widest tier is the fallback
  v_label text;
  v_where text;
  v_cnt   int;
begin
  -- Pick the tightest tier that has >= 4 rows (else the widest, tier 4).
  for t in 1..4 loop
    if t = 1 then
      v_where := format(
        'loan_type=%L and bank=%L and loan_year=%s and channel=%L and employment=%L',
        p_loan_type, p_bank, p_year, p_channel, p_employment);
    elsif t = 2 then
      v_where := format(
        'loan_type=%L and bank=%L and loan_year=%s and employment=%L',
        p_loan_type, p_bank, p_year, p_employment);
    elsif t = 3 then
      v_where := format('loan_type=%L and bank=%L and loan_year=%s',
                        p_loan_type, p_bank, p_year);
    else
      v_where := format('loan_type=%L and bank=%L', p_loan_type, p_bank);
    end if;

    execute format('select count(*) from public.rates where excluded=false and %s', v_where)
      into v_cnt;

    if v_cnt >= 4 or t = 4 then
      v_tier := t;
      exit;
    end if;
  end loop;

  v_label := case v_tier
    when 1 then 'your exact group'
    when 2 then format('%s %s borrowers who took a loan in %s (any channel)',
                       p_bank, lower(coalesce(p_employment,'')), p_year)
    when 3 then format('all %s borrowers who took a loan in %s', p_bank, p_year)
    else format('all %s borrowers across every year', p_bank)
  end;

  -- Emit exactly one row for the chosen tier.
  return query execute format($q$
    select array_agg(rate order by rate),
           case when count(*) >= 4
                then round(percentile_cont(0.50) within group (order by rate)::numeric, 2)
                else null end,
           case when count(*) >= 4
                then round(percentile_cont(0.25) within group (order by rate)::numeric, 2)
                else null end,
           count(*)::int, %s, %L
    from public.rates
    where excluded = false and %s
  $q$, v_tier, v_label, v_where);
end;
$$;

-- 5.4 Business cohort — matches on CMR band and ticket size ACROSS lenders.
--     Built now, wired later. Tier 1: cmr + turnover. Tier 2: cmr.
--     Tier 3: adjacent CMR bands.
create or replace function public.business_cohort_stats(
  p_cmr int, p_turnover int)
returns table (
  by_lender jsonb, best_rate numeric, median_rate numeric,
  n int, tier int, tier_label text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier int;
  v_label text;
  v_where text;
  v_n int;
begin
  for v_tier in 1..3 loop
    if v_tier = 1 then
      v_where := format('loan_type=%L and cmr_band=%s and turnover_cr=%s', 'Business', p_cmr, p_turnover);
      v_label := format('CMR-%s businesses of similar turnover', p_cmr);
    elsif v_tier = 2 then
      v_where := format('loan_type=%L and cmr_band=%s', 'Business', p_cmr);
      v_label := format('all CMR-%s businesses', p_cmr);
    else
      v_where := format('loan_type=%L and cmr_band between %s and %s', 'Business',
                        greatest(1, p_cmr - 1), least(7, p_cmr + 1));
      v_label := format('businesses in CMR bands %s-%s',
                        greatest(1, p_cmr - 1), least(7, p_cmr + 1));
    end if;

    execute format('select count(*) from public.rates where excluded=false and %s', v_where)
      into v_n;

    if v_n >= 4 or v_tier = 3 then
      return query execute format($q$
        with c as (select * from public.rates where excluded=false and %s)
        select
          (select jsonb_agg(x) from (
             select bank,
                    round(percentile_cont(0.25) within group (order by rate)::numeric,2) as p25,
                    round(percentile_cont(0.50) within group (order by rate)::numeric,2) as median,
                    count(*)::int as n
             from c group by bank having count(*) >= 4
             order by p25) x),
          case when count(*)>=4 then round(min(rate)::numeric,2) else null end,
          case when count(*)>=4 then round(percentile_cont(0.50) within group (order by rate)::numeric,2) else null end,
          count(*)::int, %s, %L
        from c
      $q$, v_where, v_tier, v_label);
      return;
    end if;
  end loop;
end;
$$;

-- 5.5 Total active submission count (all loan types; only Home exists at launch).
create or replace function public.total_count()
returns int
language sql
security definer
set search_path = public
as $$
  select count(*)::int from public.rates where excluded = false;
$$;

-- 5.6 Latest verified benchmark for a bank — the advertised floor / RLLR shown
--     next to the achievable rate. Returns the source and as-of date so the
--     figure is always attributable. Returns no row when the table is empty for
--     that bank, and the UI simply omits the advertised line.
create or replace function public.bank_benchmark(p_bank text)
returns table (
  repo_rate numeric, rllr numeric, advertised_floor numeric,
  source_url text, as_of date, effective_from date)
language sql
security definer
set search_path = public
as $$
  select repo_rate, rllr, advertised_floor, source_url, as_of, effective_from
  from public.benchmarks
  where bank = p_bank and effective_from <= now()::date
  order by effective_from desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants — execute on the client-facing RPCs only. The trigger helpers and
--    the internal functions are never called directly by the browser.
-- ---------------------------------------------------------------------------

revoke all on function public.submit_rate(uuid,text,text,numeric,int,int,text,text,text,int,int,text) from public;
revoke all on function public.record_outcome(bigint,text,text)                 from public;
revoke all on function public.record_followup(bigint,text,numeric,text)        from public;
revoke all on function public.bank_rates(text)                                 from public;
revoke all on function public.bank_year_rates(text,text)                       from public;
revoke all on function public.cohort_stats(text,text,int,text,text)            from public;
revoke all on function public.business_cohort_stats(int,int)                   from public;
revoke all on function public.total_count()                                    from public;
revoke all on function public.bank_benchmark(text)                             from public;
revoke all on function public.enforce_rate_limit()                             from public;
revoke all on function public.reclassify_bank_outliers()                       from public;

grant execute on function public.submit_rate(uuid,text,text,numeric,int,int,text,text,text,int,int,text) to anon;
grant execute on function public.record_outcome(bigint,text,text)              to anon;
grant execute on function public.record_followup(bigint,text,numeric,text)     to anon;
grant execute on function public.bank_rates(text)                              to anon;
grant execute on function public.bank_year_rates(text,text)                    to anon;
grant execute on function public.cohort_stats(text,text,int,text,text)         to anon;
grant execute on function public.business_cohort_stats(int,int)                to anon;
grant execute on function public.total_count()                                 to anon;
grant execute on function public.bank_benchmark(text)                          to anon;
