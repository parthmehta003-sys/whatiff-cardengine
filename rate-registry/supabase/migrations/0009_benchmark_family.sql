-- WhatIff — 0009: observation facts + server-side benchmark-family resolution.
--
-- Run AFTER 0008 (carries forward the submit_rate body from 0007; independent of
-- 0010). Adds the columns docs/rate-migration-spec.md §1 designates as immutable
-- facts, and resolves benchmark_family SERVER-SIDE from (lender, origination_year,
-- rate_type) per docs/benchmark-family-mapping.md — the user is never asked the
-- rate mechanism (EBLR/MCLR is jargon). Unknown is a first-class, safe outcome:
-- it simply gets no spread/markup downstream.
--
-- NO SIGNATURE CHANGE to submit_rate: the resolver reads bank, loan_year and
-- rate_type, all already passed. So this CREATE OR REPLACEs submit_rate with the
-- same 13-arg signature (grants persist) and adds the resolver + the new columns
-- to the insert. The floating below-floor check is unchanged (still reads the wide
-- public.benchmarks table, which 0010 leaves in place).

-- ---------------------------------------------------------------------------
-- 1. Stored-fact columns. All nullable / defaulted so existing rows and non-Home
--    types degrade gracefully (a NULL family just never matches a spread path).
-- ---------------------------------------------------------------------------
alter table public.rates add column if not exists benchmark_family     text;
alter table public.rates add column if not exists resolution_confidence text;
alter table public.rates add column if not exists family_map_version    text;
alter table public.rates add column if not exists benchmark_at_report   numeric(5,2);  -- audit snapshot only (spec §1.3); read-time derivation is source of truth
alter table public.rates add column if not exists benchmark_source      text;          -- provenance of benchmark_at_report, if ever filled
alter table public.rates add column if not exists source_type           text not null default 'self_reported';

alter table public.rates drop constraint if exists bench_family_allowed;
alter table public.rates add  constraint bench_family_allowed
  check (benchmark_family is null or benchmark_family in
    ('RLLR','MCLR','Base','PLR','Fixed','Unknown'));   -- no 'EBLR' (alias of RLLR)
alter table public.rates drop constraint if exists resolution_conf_allowed;
alter table public.rates add  constraint resolution_conf_allowed
  check (resolution_confidence is null or resolution_confidence in ('high','medium','unknown'));
alter table public.rates drop constraint if exists source_type_allowed;
alter table public.rates add  constraint source_type_allowed
  check (source_type in ('self_reported','document_verified','partner_verified'));

-- ---------------------------------------------------------------------------
-- 2. The resolver. Deterministic, versioned, pure — institution TYPE x vintage
--    (docs/benchmark-family-mapping.md). Family map version: 2026.09.
--      * Fixed rate_type            -> Fixed (no spread downstream)
--      * HFCs/NBFCs, any vintage    -> PLR   (Oct-2019 repo mandate never applied)
--      * Banks, floating, >= 2020   -> RLLR  (repo-linked)
--      * Banks, floating, = 2019    -> Unknown (Oct-2019 boundary; year alone can't tell)
--      * Banks, floating, <= 2018   -> Unknown (MCLR-era; may have converted; no series)
--      * HDFC special (merger 01-Jul-2023): <=2022 PLR (HDFC Ltd), 2023 Unknown, >=2024 RLLR
--      * 'Other'/unrecognized       -> Unknown
--    Never guesses from year alone: ambiguous -> Unknown.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_benchmark_family(
  p_bank      text,
  p_year      int,
  p_rate_type text)
returns table (benchmark_family text, resolution_confidence text)
language sql
immutable
as $$
  select f, c from (
    select case
      -- Fixed: the borrower told us the rate doesn't change.
      when p_rate_type = 'Fixed' then 'Fixed'

      -- HDFC merger special case (single label spans two regimes).
      when p_bank = 'HDFC Bank' and p_year <= 2022 then 'PLR'
      when p_bank = 'HDFC Bank' and p_year  = 2023 then 'Unknown'
      when p_bank = 'HDFC Bank' and p_year >= 2024 then 'RLLR'

      -- HFCs / NBFCs: PLR-family at any vintage.
      when p_bank in ('LIC Housing','PNB Housing','Bajaj Housing','Tata Capital',
                      'Godrej Housing','Aadhar Housing Finance','Home First Finance',
                      'Repco Home Finance','Piramal Finance','Sundaram Home Finance')
        then 'PLR'

      -- Pure banks: repo-linked (RLLR) for floating loans from 2020 on.
      when p_bank in ('SBI','ICICI Bank','Axis Bank','Kotak Mahindra','Bank of Baroda',
                      'IDFC First','Canara Bank','Union Bank','Punjab National Bank',
                      'Bank of India','IDBI Bank','Yes Bank','IndusInd Bank','Federal Bank')
           and p_year >= 2020
        then 'RLLR'

      -- Everything else (banks <= 2019, 'Other', unrecognized) is ambiguous.
      else 'Unknown'
    end as f,
    case
      when p_rate_type = 'Fixed' then 'high'
      when p_bank = 'HDFC Bank' and p_year = 2023 then 'medium'
      when p_bank in ('LIC Housing','PNB Housing','Bajaj Housing','Tata Capital',
                      'Godrej Housing','Aadhar Housing Finance','Home First Finance',
                      'Repco Home Finance','Piramal Finance','Sundaram Home Finance')
        then 'high'
      when p_bank = 'HDFC Bank' and (p_year <= 2022 or p_year >= 2024) then 'high'
      when p_bank in ('SBI','ICICI Bank','Axis Bank','Kotak Mahindra','Bank of Baroda',
                      'IDFC First','Canara Bank','Union Bank','Punjab National Bank',
                      'Bank of India','IDBI Bank','Yes Bank','IndusInd Bank','Federal Bank')
           and p_year >= 2020
        then 'high'
      when p_bank in ('SBI','ICICI Bank','Axis Bank','Kotak Mahindra','Bank of Baroda',
                      'IDFC First','Canara Bank','Union Bank','Punjab National Bank',
                      'Bank of India','IDBI Bank','Yes Bank','IndusInd Bank','Federal Bank')
           and p_year = 2019
        then 'medium'
      else 'unknown'
    end as c
  ) r;
$$;

-- ---------------------------------------------------------------------------
-- 3. submit_rate — same 13-arg signature (grants persist across REPLACE). Resolve
--    the family at write time and store it with the row; everything else is the
--    0007 body verbatim (dedupe, insert, below-floor check, supersede).
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
begin
  if exists (select 1 from public.banned_sessions where session_id = p_session_id) then
    raise exception 'session_revoked: this session is blocked after repeated out-of-range submissions'
      using errcode = 'check_violation';
  end if;

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
     and v_last.cibil_band is not distinct from p_cibil_band
  then
    return v_last.id;
  end if;

  -- Resolve the benchmark family server-side (docs/benchmark-family-mapping.md).
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

  -- Benchmark verification for FLOATING loans (see 0001 for the reasoning).
  if p_rate_type = 'Floating' then
    declare v_floor numeric;
    begin
      select least(coalesce(advertised_floor, rllr), coalesce(rllr, advertised_floor))
        into v_floor
      from public.benchmarks
      where bank = p_bank
        and (advertised_floor is not null or rllr is not null)
        and effective_from <= now()::date
      order by effective_from desc
      limit 1;

      if v_floor is not null and p_rate < v_floor - 0.50 then
        update public.rates
           set excluded = true, exclude_reason = 'below_floor'
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

revoke all on function public.submit_rate(uuid,text,text,numeric,int,int,text,text,text,int,int,text,text) from public;
grant execute on function public.submit_rate(uuid,text,text,numeric,int,int,text,text,text,int,int,text,text) to anon;

revoke all on function public.resolve_benchmark_family(text,int,text) from public;
grant execute on function public.resolve_benchmark_family(text,int,text) to anon;
