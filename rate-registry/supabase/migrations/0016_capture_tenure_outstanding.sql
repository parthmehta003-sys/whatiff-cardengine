-- WhatIff — 0016: persist loan tenure and outstanding balance.
--
-- These two inputs were previously computed in the browser and never stored.
-- This migration captures them: adds the columns and threads them through
-- submit_rate so every submission records them. Additive; existing rows keep
-- NULL for both. Adding arguments changes submit_rate's signature, so the 0014
-- version is dropped and recreated (body carried forward verbatim).
--
-- Run AFTER 0014. Apply BEFORE the app.js that sends p_tenure_years /
-- p_outstanding_lakh, or those arguments are rejected during the gap.

-- ---------------------------------------------------------------------------
-- 1. Columns + sane bounds. tenure is the sanctioned term in years; outstanding
--    is what the borrower still owes, in ₹ lakh (the form takes ₹ crore and the
--    app converts). Both optional.
-- ---------------------------------------------------------------------------
alter table public.rates add column if not exists tenure_years    int;
alter table public.rates add column if not exists outstanding_lakh numeric(9,2);
alter table public.rates drop constraint if exists tenure_ok;
alter table public.rates add  constraint tenure_ok
  check (tenure_years is null or tenure_years between 5 and 40);
alter table public.rates drop constraint if exists outstanding_ok;
alter table public.rates add  constraint outstanding_ok
  check (outstanding_lakh is null or (outstanding_lakh >= 0 and outstanding_lakh <= 2000));

-- ---------------------------------------------------------------------------
-- 2. submit_rate — add p_tenure_years + p_outstanding_lakh (15 args). Body is
--    the 0014 version (auth.uid() gate, banned check, per-user supersede,
--    benchmark-family resolution, bank_floor below-floor check) plus: the two
--    new fields are stored, and are part of the identical-resubmit test so a
--    changed tenure/outstanding is treated as a correction.
-- ---------------------------------------------------------------------------
drop function if exists public.submit_rate(uuid,text,text,numeric,int,int,text,text,text,int,int,text,text);

create function public.submit_rate(
  p_session_id     uuid,
  p_loan_type      text,
  p_bank           text,
  p_rate           numeric,
  p_loan_year      int,
  p_amount_lakh    int,
  p_rate_type      text,
  p_channel        text,
  p_employment     text    default null,
  p_cmr_band       int     default null,
  p_turnover_cr    int     default null,
  p_city           text    default null,
  p_cibil_band     text    default null,
  p_tenure_years   int     default null,
  p_outstanding_lakh numeric default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_last   public.rates%rowtype;
  v_id     bigint;
  v_family text;
  v_conf   text;
  v_floor  numeric;
begin
  if v_uid is null then
    raise exception 'auth_required: please sign in to add your rate'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.banned_users where user_id = v_uid) then
    raise exception 'session_revoked: this account is blocked after repeated out-of-range submissions'
      using errcode = 'check_violation';
  end if;

  -- Most recent live row for THIS USER + loan type.
  select * into v_last
  from public.rates
  where user_id = v_uid and loan_type = p_loan_type and excluded = false
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
     and v_last.tenure_years is not distinct from p_tenure_years
     and v_last.outstanding_lakh is not distinct from p_outstanding_lakh
  then
    return v_last.id;
  end if;

  select rf.benchmark_family, rf.resolution_confidence
    into v_family, v_conf
  from public.resolve_benchmark_family(p_bank, p_loan_year, p_rate_type) rf;

  insert into public.rates(
    user_id, session_id, loan_type, bank, rate, loan_year, amount_lakh, rate_type,
    channel, employment, cmr_band, turnover_cr, city, cibil_band,
    tenure_years, outstanding_lakh,
    benchmark_family, resolution_confidence, family_map_version)
  values (
    v_uid, p_session_id, p_loan_type, p_bank, p_rate, p_loan_year, p_amount_lakh, p_rate_type,
    p_channel, p_employment, p_cmr_band, p_turnover_cr, p_city, p_cibil_band,
    p_tenure_years, p_outstanding_lakh,
    v_family, v_conf, '2026.09')
  returning id into v_id;

  -- Floating below-floor check — from benchmark_history via bank_floor() (0013).
  if p_rate_type = 'Floating' then
    v_floor := public.bank_floor(p_bank, now()::date);
    if v_floor is not null and p_rate < v_floor - 0.50 then
      update public.rates set excluded = true, exclude_reason = 'below_floor' where id = v_id;
    end if;
  end if;

  -- Supersede earlier submissions from THIS USER + loan type.
  update public.rates
     set excluded = true, exclude_reason = 'superseded'
   where user_id = v_uid and loan_type = p_loan_type
     and id <> v_id and excluded = false;

  return v_id;
end;
$$;

revoke all on function public.submit_rate(uuid,text,text,numeric,int,int,text,text,text,int,int,text,text,int,numeric) from public;
grant execute on function public.submit_rate(uuid,text,text,numeric,int,int,text,text,text,int,int,text,text,int,numeric) to anon, authenticated;
