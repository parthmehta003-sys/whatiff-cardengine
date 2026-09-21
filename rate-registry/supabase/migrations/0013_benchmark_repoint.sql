-- WhatIff — 0013: repoint benchmark-VALUE consumers onto benchmark_history.
--
-- Run AFTER 0012. Closes the two-sources-of-truth debt from 0010: benchmark_history
-- exists and is validated, but bank_benchmark() and submit_rate's floating floor
-- check still read benchmark VALUES from the wide public.benchmarks table. This
-- migration makes benchmark_history the single source of truth for benchmark values
-- (repo / RLLR / advertised floor / MCLR), while FEES stay in the wide table.
--
-- IMPORTANT: the wide benchmarks table is NOT retired. It holds per-lender FEE data
-- (conversion/processing) that benchmark_history has no columns for, and bank_rates
-- + bank_benchmark still read fees from it. After this migration its benchmark-VALUE
-- columns (repo_rate, rllr, mclr, advertised_floor) are LEGACY / a deprecation
-- candidate — no longer read — but the table lives on as the fee table.
--
-- ACCEPTANCE (docs/rate-migration-spec.md §2.3): bank_benchmark() and the floor
-- check must return IDENTICAL results on the seed data, before vs after. Validated
-- by diffing bank_benchmark over all lenders and comparing the floor value per bank.

-- ---------------------------------------------------------------------------
-- 1. Backfill benchmark_history from the wide table's benchmark VALUES.
--    AdvertisedFloor / RLLR / MCLR per lender, keyed by the wide row's own
--    effective_from, carrying its source_url + as_of. Repo is NOT backfilled per
--    lender (it is the national series, already seeded). ON CONFLICT DO NOTHING so
--    re-running (and the already-seeded National/Repo) is safe.
-- ---------------------------------------------------------------------------
insert into public.benchmark_history (lender, benchmark_family, effective_from, benchmark_rate, source_url, verified_at, note)
select bank, 'AdvertisedFloor', effective_from, advertised_floor, source_url, as_of, 'backfill from benchmarks (0013)'
from public.benchmarks where advertised_floor is not null
on conflict (lender, benchmark_family, effective_from) do nothing;

insert into public.benchmark_history (lender, benchmark_family, effective_from, benchmark_rate, source_url, verified_at, note)
select bank, 'RLLR', effective_from, rllr, source_url, as_of, 'backfill from benchmarks (0013)'
from public.benchmarks where rllr is not null
on conflict (lender, benchmark_family, effective_from) do nothing;

insert into public.benchmark_history (lender, benchmark_family, effective_from, benchmark_rate, source_url, verified_at, note)
select bank, 'MCLR', effective_from, mclr, source_url, as_of, 'backfill from benchmarks (0013)'
from public.benchmarks where mclr is not null
on conflict (lender, benchmark_family, effective_from) do nothing;

-- ---------------------------------------------------------------------------
-- 2. bank_floor(): the floating-loan floor, from history. Replicates the old
--    least(coalesce(advertised_floor, rllr), coalesce(rllr, advertised_floor))
--    exactly — but sourced from benchmark_history. NULL when neither exists (then
--    the floor check is skipped, as before).
-- ---------------------------------------------------------------------------
create or replace function public.bank_floor(p_bank text, p_asof date default current_date)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select least(coalesce(af.v, rl.v), coalesce(rl.v, af.v))
  from (select public.benchmark_asof(p_bank, 'AdvertisedFloor', p_asof) as v) af,
       (select public.benchmark_asof(p_bank, 'RLLR', p_asof)            as v) rl;
$$;
revoke all on function public.bank_floor(text, date) from public;
grant execute on function public.bank_floor(text, date) to anon;

-- ---------------------------------------------------------------------------
-- 3. bank_benchmark(): same return shape, but benchmark VALUES now come from
--    benchmark_history; FEES + fee_source_url still come from the wide table.
--    source_url / as_of / effective_from track the AdvertisedFloor row (the
--    published-rate citation the app shows), matching the old benchmark citation.
-- ---------------------------------------------------------------------------
drop function if exists public.bank_benchmark(text);
create function public.bank_benchmark(p_bank text)
returns table (
  repo_rate numeric, rllr numeric, advertised_floor numeric,
  conversion_fee_pct numeric, conversion_fee_flat numeric,
  processing_fee_pct numeric, processing_fee_flat numeric,
  source_url text, fee_source_url text, as_of date, effective_from date)
language sql
security definer
set search_path = public
as $$
  with bv as (
    select public.benchmark_asof('National','Repo', now()::date)         as repo_rate,
           public.benchmark_asof(p_bank,'RLLR', now()::date)             as rllr,
           public.benchmark_asof(p_bank,'AdvertisedFloor', now()::date)  as advertised_floor
  ),
  af as (  -- citation row for the advertised floor (source_url / as_of / effective_from)
    select source_url, verified_at as as_of, effective_from
    from public.benchmark_history
    where lender = p_bank and benchmark_family = 'AdvertisedFloor' and effective_from <= now()::date
    order by effective_from desc
    limit 1
  ),
  fee as (  -- fees remain in the wide table (still the fee source of truth)
    select conversion_fee_pct, conversion_fee_flat, processing_fee_pct, processing_fee_flat, fee_source_url
    from public.benchmarks
    where bank = p_bank and effective_from <= now()::date
    order by effective_from desc
    limit 1
  )
  select bv.repo_rate, bv.rllr, bv.advertised_floor,
         fee.conversion_fee_pct, fee.conversion_fee_flat,
         fee.processing_fee_pct, fee.processing_fee_flat,
         af.source_url, fee.fee_source_url, af.as_of, af.effective_from
  from bv left join af on true left join fee on true;
$$;
revoke all on function public.bank_benchmark(text) from public;
grant execute on function public.bank_benchmark(text) to anon;

-- ---------------------------------------------------------------------------
-- 4. submit_rate: 0009 body verbatim, EXCEPT the floating floor check now reads
--    bank_floor() (benchmark_history) instead of the wide table. Same 13-arg
--    signature (CREATE OR REPLACE; grants persist).
-- ---------------------------------------------------------------------------
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
  p_city        text default null,
  p_cibil_band  text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last   public.rates%rowtype;
  v_id     bigint;
  v_family text;
  v_conf   text;
  v_floor  numeric;
begin
  if exists (select 1 from public.banned_sessions where session_id = p_session_id) then
    raise exception 'session_revoked: this session is blocked after repeated out-of-range submissions'
      using errcode = 'check_violation';
  end if;

  select * into v_last
  from public.rates
  where session_id = p_session_id and loan_type = p_loan_type and excluded = false
  order by created_at desc, id desc
  limit 1;

  if found
     and v_last.bank = p_bank
     and v_last.rate = p_rate
     and v_last.loan_year = p_loan_year
     and v_last.amount_lakh = p_amount_lakh
     and v_last.rate_type = p_rate_type
     and v_last.channel = p_channel
     and v_last.employment is not distinct from p_employment
     and v_last.cmr_band is not distinct from p_cmr_band
     and v_last.cibil_band is not distinct from p_cibil_band
  then
    return v_last.id;
  end if;

  select rf.benchmark_family, rf.resolution_confidence
    into v_family, v_conf
  from public.resolve_benchmark_family(p_bank, p_loan_year, p_rate_type) rf;

  insert into public.rates(
    session_id, loan_type, bank, rate, loan_year, amount_lakh, rate_type,
    channel, employment, cmr_band, turnover_cr, city, cibil_band,
    benchmark_family, resolution_confidence, family_map_version)
  values (
    p_session_id, p_loan_type, p_bank, p_rate, p_loan_year, p_amount_lakh, p_rate_type,
    p_channel, p_employment, p_cmr_band, p_turnover_cr, p_city, p_cibil_band,
    v_family, v_conf, '2026.09')
  returning id into v_id;

  -- Floating below-floor check — now from benchmark_history via bank_floor().
  if p_rate_type = 'Floating' then
    v_floor := public.bank_floor(p_bank, now()::date);
    if v_floor is not null and p_rate < v_floor - 0.50 then
      update public.rates set excluded = true, exclude_reason = 'below_floor' where id = v_id;
    end if;
  end if;

  update public.rates
     set excluded = true, exclude_reason = 'superseded'
   where session_id = p_session_id and loan_type = p_loan_type
     and id <> v_id and excluded = false;

  return v_id;
end;
$$;

revoke all on function public.submit_rate(uuid,text,text,numeric,int,int,text,text,text,int,int,text,text) from public;
grant execute on function public.submit_rate(uuid,text,text,numeric,int,int,text,text,text,int,int,text,text) to anon;

-- ---------------------------------------------------------------------------
-- 5. Legacy marker. The wide table's benchmark-VALUE columns are no longer read
--    (history is authoritative); they remain only as historical record. Fees stay
--    live here. A future migration may drop the value columns once confidence is
--    high; do NOT drop the table (fees depend on it).
-- ---------------------------------------------------------------------------
comment on column public.benchmarks.repo_rate        is 'LEGACY (0013): superseded by benchmark_history National/Repo; no longer read.';
comment on column public.benchmarks.rllr             is 'LEGACY (0013): superseded by benchmark_history <bank>/RLLR; no longer read.';
comment on column public.benchmarks.mclr             is 'LEGACY (0013): superseded by benchmark_history <bank>/MCLR; no longer read.';
comment on column public.benchmarks.advertised_floor is 'LEGACY (0013): superseded by benchmark_history <bank>/AdvertisedFloor; no longer read.';
