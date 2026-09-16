-- WhatIff deploy bundle: migrations 0009-0013 + benchmark_history repo seed.
-- Apply to a Supabase project that ALREADY has 0001-0008 (the live prod DB).
-- Paste into Supabase Studio -> SQL Editor and Run, or: psql "$DB_URL" -f this file.
-- Idempotent-ish: add-column/CREATE OR REPLACE/ON CONFLICT guards throughout.
-- Wraps everything in one transaction so a failure rolls back cleanly.
begin;

-- ============================================================
-- 0009_benchmark_family.sql
-- ============================================================
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

-- ============================================================
-- 0010_benchmark_history.sql
-- ============================================================
-- WhatIff — 0010: append-only benchmark history (family-keyed dated series).
--
-- Run AFTER 0001 (independent of 0002-0009). This is the infrastructure the rate
-- architecture calls the real cost (docs/rate-architecture.md §11): a DATED series
-- per lender per benchmark family, so a report's spread can be taken against the
-- benchmark effective on its OWN report_date, not today's
-- (docs/rate-migration-spec.md §3, the single spread rule).
--
-- ADDITIVE, NOT A RESTRUCTURE. The existing public.benchmarks (wide: one row per
-- bank/date with repo_rate/rllr/mclr/advertised_floor columns) stays in place and
-- keeps serving bank_benchmark() and the submit_rate floor check UNCHANGED. This
-- migration only adds the new long/append-only table + a read path. Redefining
-- bank_benchmark()/the floor check to read from history, backfilling advertised_floor
-- and RLLR, and eventually dropping the old table are a LATER migration, done once
-- this history is populated and validated (migration spec §2.3).
--
-- APPEND-ONLY: a new rate is a new row (new effective_from). There is deliberately
-- NO effective_to column — storing it would force UPDATEing the prior row on every
-- insert (an update anomaly that breaks append-only). The active row for any date
-- is "latest effective_from <= that date" within (lender, benchmark_family).
--
-- FAMILY NAMING (join-safety, docs/rate-architecture.md §4): the resolver emits
-- RLLR for bank repo-linked loans and NEVER "EBLR"; benchmark_family here must use
-- the SAME values or the spread join returns NULL silently. Repo is the national
-- series (lender = 'National'). AdvertisedFloor is a per-lender pseudo-family.

create table if not exists public.benchmark_history (
  id               bigserial primary key,
  lender           text not null,              -- a lenders/rates allowed value, or 'National' for Repo
  benchmark_family text not null,              -- RLLR | MCLR | Base | PLR | Repo | AdvertisedFloor
  effective_from   date not null,              -- date this figure took effect
  benchmark_rate   numeric(5,2) not null,      -- the figure itself (% p.a.)
  source_url       text not null,              -- REQUIRED: where this number was read
  verified_at      date not null,              -- REQUIRED: when it was verified/captured
  note             text,
  constraint bh_family_allowed check (benchmark_family in
    ('RLLR','MCLR','Base','PLR','Repo','AdvertisedFloor')),  -- no 'EBLR': alias of RLLR
  -- one figure per lender+family+date; a genuine correction re-inserts a later row
  constraint benchmark_history_uidx unique (lender, benchmark_family, effective_from)
);

-- Read pattern is always "latest effective_from <= target date" per (lender, family).
create index if not exists benchmark_history_lookup_idx
  on public.benchmark_history (lender, benchmark_family, effective_from desc);

-- RLS: base table is not directly readable by clients; the read path is the RPC below.
alter table public.benchmark_history enable row level security;
revoke all on public.benchmark_history                 from anon, authenticated;
revoke all on sequence public.benchmark_history_id_seq from anon, authenticated;

-- Convenience view: the CURRENT figure per (lender, family) — the latest row.
create or replace view public.current_benchmark as
  select distinct on (lender, benchmark_family)
         lender, benchmark_family, effective_from, benchmark_rate, source_url, verified_at
  from public.benchmark_history
  order by lender, benchmark_family, effective_from desc;

-- Read RPC: the benchmark active for a (lender, family) as of a given date.
-- Security definer + fixed search_path, granted to anon (the read path is unauth),
-- mirroring the 0001 aggregate RPCs.
create or replace function public.benchmark_asof(
  p_lender text,
  p_family text,
  p_asof   date default current_date)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select benchmark_rate
  from public.benchmark_history
  where lender = p_lender
    and benchmark_family = p_family
    and effective_from <= p_asof
  order by effective_from desc
  limit 1;
$$;

revoke all on function public.benchmark_asof(text, text, date) from public;
grant execute on function public.benchmark_asof(text, text, date) to anon;

-- ============================================================
-- 0011_normalized_values.sql
-- ============================================================
-- WhatIff — 0011: the two normalized objects, per report (docs/rate-architecture.md §4).
--
-- Run AFTER 0009 (needs rates.benchmark_family) and 0010 (needs benchmark_history
-- + benchmark_asof). These are read-path RPCs: security definer, fixed search_path,
-- granted to anon, mirroring the 0001 aggregates.
--
-- TWO SEPARATELY-NAMED OBJECTS — never one generic "spread":
--   * benchmark_spread = reported_rate - the lender's OWN benchmark (RLLR/PLR/MCLR),
--     within-lender comparable. Needs that lender's dated series; returns NULL where
--     none exists yet (RLLR/PLR history is a fast follow), so the capability is
--     present but naturally NULL today.
--   * repo_markup = reported_rate - national repo, REPO-LINKED (RLLR family) ONLY.
--     Powered now by seed_benchmark_history.sql. A category error for PLR/MCLR/etc,
--     so guarded to RLLR.
--
-- AS-OF RULE (both objects): use the benchmark effective on the report's OWN date
-- (created_at::date), not today's, so an older report is not re-based to a benchmark
-- that has since moved (docs/rate-migration-spec.md §3).
--
-- repo_markup is DESCRIPTIVE, not diagnostic (design §8.0): callers must present it
-- as pricing context, never as "you are overpaying by this much".

-- benchmark_spread: rate - lender's own benchmark of the row's family, as-of report date.
create or replace function public.get_benchmark_spread(p_report_id bigint)
returns numeric
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  r     public.rates%rowtype;
  v_bm  numeric;
begin
  select * into r from public.rates where id = p_report_id;
  if not found then return null; end if;

  -- Only families with a lender-specific benchmark series. Fixed/Unknown never.
  if r.benchmark_family not in ('RLLR','PLR','MCLR','Base') then
    return null;
  end if;

  -- The lender's OWN benchmark, effective on the report's date.
  v_bm := public.benchmark_asof(r.bank, r.benchmark_family, r.created_at::date);
  if v_bm is null then
    return null;           -- no series for this lender/family yet -> no guess
  end if;

  return round((r.rate - v_bm)::numeric, 2);
end;
$$;

-- repo_markup: rate - national repo, as-of report date. RLLR (repo-linked) ONLY.
create or replace function public.get_repo_markup(p_report_id bigint)
returns numeric
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  r      public.rates%rowtype;
  v_repo numeric;
begin
  select * into r from public.rates where id = p_report_id;
  if not found then return null; end if;

  -- Repo-linked only. PLR/MCLR/Base/Fixed/Unknown -> NULL (category error otherwise).
  if r.benchmark_family <> 'RLLR' then
    return null;
  end if;

  v_repo := public.benchmark_asof('National', 'Repo', r.created_at::date);
  if v_repo is null then
    return null;
  end if;

  return round((r.rate - v_repo)::numeric, 2);
end;
$$;

revoke all on function public.get_benchmark_spread(bigint) from public;
grant execute on function public.get_benchmark_spread(bigint) to anon;
revoke all on function public.get_repo_markup(bigint) from public;
grant execute on function public.get_repo_markup(bigint) to anon;

-- ============================================================
-- 0012_cohort_normalization.sql
-- ============================================================
-- WhatIff — 0012: cohort statistics gain the normalized layers.
--
-- Run AFTER 0011 (needs benchmark_asof + rates.benchmark_family) and 0008 (extends
-- the cohort_stats it defined). Signature-compatible for the CALLER: same 7 input
-- args, so app.js's rpc call is unchanged; the RETURN TYPE gains columns (drop +
-- recreate + re-grant). Existing columns (rates, median_rate, p25_rate, n, tier,
-- tier_label) keep their names so the current app keeps reading them.
--
-- WHAT'S ADDED, all from ONE coherent tier (docs/rate-migration-spec.md §4): the
-- back-off picks a single tier, and EVERY statistic below is computed from that
-- same row set — never a bank-year median mixed with a bank-level P25.
--   * peer rate:        p25 / median / p75
--   * benchmark_spread: p25 / median / p75  (rate − lender's own benchmark, where a
--                       series exists; NULL until RLLR/PLR history is added)
--   * repo_markup:      p25 / median / p75  (rate − national repo; RLLR rows only)
--   * n, as_of (max report date in the cohort), cohort_level (machine tier slug)
--
-- Each normalized set is gated on its OWN non-null count >= 4 (percentile_cont
-- ignores NULLs), so a metric shows only when at least 4 rows actually support it.
--
-- NORMALIZATION BY NODE: this ladder is bank-scoped at every tier (the product's
-- peer question is "others AT YOUR BANK"), so benchmark_spread is always within-
-- lender and valid here. There is deliberately no cross-bank peer tier — mixing
-- lenders' RLLRs would make benchmark_spread meaningless; a market-wide repo_markup
-- view, if ever wanted, is a separate RPC, not this peer cohort.

drop function if exists public.cohort_stats(text,text,int,text,text,text,int);

create function public.cohort_stats(
  p_loan_type   text,
  p_bank        text,
  p_year        int,
  p_channel     text,
  p_employment  text,
  p_cibil_band  text default null,
  p_amount_lakh int  default null)
returns table (
  rates numeric[], median_rate numeric, p25_rate numeric, p75_rate numeric,
  bspread_p25 numeric, bspread_median numeric, bspread_p75 numeric,
  repo_p25 numeric, repo_median numeric, repo_p75 numeric,
  n int, tier int, tier_label text, cohort_level text, as_of date)
language plpgsql
security definer
set search_path = public
as $$
declare
  t        int;
  v_tier   int  := 6;                -- widest tier is the fallback
  v_label  text;
  v_level  text;
  v_where  text;
  v_cnt    int;
  v_cibil  text;                     -- human phrase for the score band
  v_ticket text;                     -- human phrase for the ticket band
  v_tmatch text;                     -- SQL predicate matching the ticket band
begin
  v_cibil := case
    when p_cibil_band is null      then ''
    when p_cibil_band = 'Not sure' then ' whose score isn''t shared'
    else format(' in the %s CIBIL band', p_cibil_band)
  end;

  v_ticket := case public.amount_band(p_amount_lakh)
    when 1 then ' borrowing up to ₹30 lakh'
    when 2 then ' borrowing ₹30-75 lakh'
    when 3 then ' borrowing ₹75 lakh-₹2 crore'
    when 4 then ' borrowing over ₹2 crore'
    else ''
  end;

  v_tmatch := case when public.amount_band(p_amount_lakh) is null
    then 'false'
    else format('public.amount_band(amount_lakh) = %s', public.amount_band(p_amount_lakh))
  end;

  -- Pick the tightest tier that has >= 4 rows (else the widest, tier 6).
  for t in 1..6 loop
    if t = 1 then
      v_where := format(
        'loan_type=%L and bank=%L and cibil_band=%L and %s and employment=%L and loan_year=%s and channel=%L',
        p_loan_type, p_bank, p_cibil_band, v_tmatch, p_employment, p_year, p_channel);
    elsif t = 2 then
      v_where := format(
        'loan_type=%L and bank=%L and cibil_band=%L and %s and employment=%L and loan_year=%s',
        p_loan_type, p_bank, p_cibil_band, v_tmatch, p_employment, p_year);
    elsif t = 3 then
      v_where := format(
        'loan_type=%L and bank=%L and cibil_band=%L and %s and employment=%L',
        p_loan_type, p_bank, p_cibil_band, v_tmatch, p_employment);
    elsif t = 4 then
      v_where := format(
        'loan_type=%L and bank=%L and cibil_band=%L and %s',
        p_loan_type, p_bank, p_cibil_band, v_tmatch);
    elsif t = 5 then
      v_where := format(
        'loan_type=%L and bank=%L and cibil_band=%L',
        p_loan_type, p_bank, p_cibil_band);
    else
      v_where := format('loan_type=%L and bank=%L', p_loan_type, p_bank);
    end if;

    execute format('select count(*) from public.rates where excluded=false and %s', v_where)
      into v_cnt;

    if v_cnt >= 4 or t = 6 then
      v_tier := t;
      exit;
    end if;
  end loop;

  v_label := case v_tier
    when 1 then 'your exact group'
    when 2 then format('%s %s borrowers%s%s who took a loan in %s (any channel)',
                       p_bank, lower(coalesce(p_employment,'')), v_cibil, v_ticket, p_year)
    when 3 then format('%s %s borrowers%s%s',
                       p_bank, lower(coalesce(p_employment,'')), v_cibil, v_ticket)
    when 4 then format('%s borrowers%s%s', p_bank, v_cibil, v_ticket)
    when 5 then format('%s borrowers%s', p_bank, v_cibil)
    else format('all %s borrowers across every year', p_bank)
  end;

  v_level := case v_tier
    when 1 then 'bank_cibil_ticket_emp_year_channel'
    when 2 then 'bank_cibil_ticket_emp_year'
    when 3 then 'bank_cibil_ticket_emp'
    when 4 then 'bank_cibil_ticket'
    when 5 then 'bank_cibil'
    else 'bank'
  end;

  -- Emit exactly one row for the chosen tier. Every metric comes from the SAME
  -- row set (the CTE), so the statistic set is internally coherent.
  return query execute format($q$
    with c as (
      select rate, bank, benchmark_family, created_at,
        case when benchmark_family = 'RLLR'
             then rate - public.benchmark_asof('National','Repo', created_at::date)
        end as repo_mk,
        case when benchmark_family in ('RLLR','PLR','MCLR','Base')
             then rate - public.benchmark_asof(bank, benchmark_family, created_at::date)
        end as bspread
      from public.rates
      where excluded = false and %s
    )
    select
      array_agg(rate order by rate),
      case when count(rate)    >= 4 then round(percentile_cont(0.50) within group (order by rate)::numeric, 2) end,
      case when count(rate)    >= 4 then round(percentile_cont(0.25) within group (order by rate)::numeric, 2) end,
      case when count(rate)    >= 4 then round(percentile_cont(0.75) within group (order by rate)::numeric, 2) end,
      case when count(bspread) >= 4 then round(percentile_cont(0.25) within group (order by bspread)::numeric, 2) end,
      case when count(bspread) >= 4 then round(percentile_cont(0.50) within group (order by bspread)::numeric, 2) end,
      case when count(bspread) >= 4 then round(percentile_cont(0.75) within group (order by bspread)::numeric, 2) end,
      case when count(repo_mk) >= 4 then round(percentile_cont(0.25) within group (order by repo_mk)::numeric, 2) end,
      case when count(repo_mk) >= 4 then round(percentile_cont(0.50) within group (order by repo_mk)::numeric, 2) end,
      case when count(repo_mk) >= 4 then round(percentile_cont(0.75) within group (order by repo_mk)::numeric, 2) end,
      count(*)::int, %s, %L, %L, max(created_at)::date
    from c
  $q$, v_where, v_tier, v_label, v_level);
end;
$$;

revoke all on function public.cohort_stats(text,text,int,text,text,text,int) from public;
grant execute on function public.cohort_stats(text,text,int,text,text,text,int) to anon;

-- ============================================================
-- 0013_benchmark_repoint.sql
-- ============================================================
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

-- ============================================================
-- seed_benchmark_history.sql (national RBI repo series)
-- ============================================================
-- WhatIff — benchmark_history seed, BATCH 1: the national RBI repo series.
--
-- RUN ORDER: 0001 -> 0010 -> this file. Re-run safe (clears the 'National'/'Repo'
-- rows first). Populates docs/rate-architecture.md §11's dated series, starting
-- with the one series every repo-linked lender needs and that can be reliably
-- primary-sourced: the RBI policy repo rate.
--
-- WHY REPO FIRST — the two normalized objects (docs/rate-architecture.md §4):
--   WhatIff computes TWO separately-named things, never one generic "spread":
--     * benchmark_spread = rate - the lender's own RLLR/PLR (within-lender
--       comparable; needs that lender's dated series);
--     * repo_markup      = rate - national repo (RLLR/repo-linked family ONLY;
--       cross-bank comparable; the borrower's all-in markup over the policy rate).
--   repo_markup is NOT a lender spread and is never computed for HFC (PLR) loans.
--   The national repo series below powers repo_markup for all 15 repo-linked banks
--   from a single sourced series. Only 8 banks publish a numeric RLLR, so their
--   benchmark_spread additionally needs an RLLR history (a later batch);
--   reconstructing that as repo + constant markup is only an approximation (a bank
--   can revise its RLLR markup even when repo holds), so prefer published
--   effective-dated RLLR points. This repo series is needed regardless, so it is
--   correct to seed now.
--
-- SOURCE: RBI Monetary Policy Committee decisions. 2025 easing cycle = 125 bps
-- across four cuts (6.50 -> 5.25); held through the 2026 MPCs; next MPC 05-07 Oct
-- 2026. Cross-checked against RBI PIB releases and contemporaneous MPC coverage
-- (Business Standard, PRS India, SCC Online) on 2026-09-16, and against the
-- current 5.25% already verified in seed_benchmarks.sql (as_of 2026-09-10).

delete from public.benchmark_history where lender = 'National' and benchmark_family = 'Repo';

insert into public.benchmark_history
  (lender, benchmark_family, effective_from, benchmark_rate, source_url, verified_at, note) values
  ('National','Repo','2023-02-08',6.50,
   'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx',
   '2026-09-16','Repo held at 6.50% from 08-Feb-2023 through the 2025 easing cycle. Anchor row so any report_date before the first 2025 cut resolves.'),
  ('National','Repo','2025-02-07',6.25,
   'https://www.business-standard.com/finance/news/rbi-rate-cut-february-2025-sanjay-malhotra-125020700479_1.html',
   '2026-09-16','MPC cut 25 bps to 6.25% (07-Feb-2025) — first cut in ~2.5 years.'),
  ('National','Repo','2025-04-09',6.00,
   'https://www.pib.gov.in/PressNoteDetails.aspx?NoteId=154573&ModuleId=3&reg=48&lang=2',
   '2026-09-16','MPC cut 25 bps to 6.00% (09-Apr-2025), first MPC of FY26.'),
  ('National','Repo','2025-06-06',5.50,
   'https://www.pib.gov.in/PressNoteDetails.aspx?NoteId=154573&ModuleId=3&reg=48&lang=2',
   '2026-09-16','MPC cut 50 bps to 5.50% (06-Jun-2025). Held at 5.50% through Aug & Oct 2025 MPCs.'),
  ('National','Repo','2025-12-05',5.25,
   'https://www.business-standard.com/finance/news/rbi-mpc-december-2025-rate-cut-announcement-sanjay-malhotra-cpi-inflation-125120500161_1.html',
   '2026-09-16','58th MPC cut 25 bps to 5.25% (05-Dec-2025), the 4th cut of 2025 (125 bps cumulative). Held through the 2026 MPCs; still 5.25% as of 2026-09-16. Matches seed_benchmarks.sql.');

commit;
