-- WhatIff — 0018: judge the "below floor" typo-guard against the floor that
-- applied WHEN THE LOAN WAS TAKEN, not today's floor.
--
-- The guard flags a floating rate that sits more than 0.50 below the bank's
-- floor as a likely typo. It was comparing against bank_floor(bank, now()) —
-- today's floor. But rates were far lower in the past (e.g. RBI repo was ~4% in
-- 2021, so HDFC's floor was ~6.7-7.0%), so a genuine 2021 loan at 7.15% was
-- wrongly parked against the 2026 floor of ~7.75%.
--
-- Fix: use bank_floor(bank, <the loan's year>). When we have no benchmark on
-- file for that year (bank_floor returns NULL), the check is skipped — we don't
-- flag what we can't fairly judge. Only the floor line changes; the rest of
-- submit_rate (0017) is carried forward verbatim. Signature unchanged, so this
-- is a plain create-or-replace. Run AFTER 0017.

create or replace function public.submit_rate(
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

  -- Most recent live row for THIS USER + THIS LOAN (loan_type + bank + year).
  select * into v_last
  from public.rates
  where user_id = v_uid and loan_type = p_loan_type
    and bank = p_bank and loan_year = p_loan_year
    and excluded = false
  order by created_at desc, id desc
  limit 1;

  if found
     and v_last.rate = p_rate
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

  -- Floating below-floor check — against the floor that applied in the loan's
  -- YEAR (not today's). NULL floor (no benchmark for that year) => skip.
  if p_rate_type = 'Floating' then
    v_floor := public.bank_floor(p_bank, make_date(p_loan_year, 12, 31));
    if v_floor is not null and p_rate < v_floor - 0.50 then
      update public.rates set excluded = true, exclude_reason = 'below_floor' where id = v_id;
    end if;
  end if;

  -- Supersede only earlier submissions of THE SAME loan (same bank + year).
  update public.rates
     set excluded = true, exclude_reason = 'superseded'
   where user_id = v_uid and loan_type = p_loan_type
     and bank = p_bank and loan_year = p_loan_year
     and id <> v_id and excluded = false;

  return v_id;
end;
$$;

revoke all on function public.submit_rate(uuid,text,text,numeric,int,int,text,text,text,int,int,text,text,int,numeric) from public;
grant execute on function public.submit_rate(uuid,text,text,numeric,int,int,text,text,text,int,int,text,text,int,numeric) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Data fix: re-evaluate rows already parked as 'below_floor' against the
-- loan-year floor, and un-park any that now pass (or that we can't judge for
-- lack of a benchmark that year). This restores id 5 (HDFC 7.15% / 2021).
-- ---------------------------------------------------------------------------
update public.rates r
   set excluded = false, exclude_reason = null
 where r.excluded = true
   and r.exclude_reason = 'below_floor'
   and (
     public.bank_floor(r.bank, make_date(r.loan_year, 12, 31)) is null
     or r.rate >= public.bank_floor(r.bank, make_date(r.loan_year, 12, 31)) - 0.50
   );
