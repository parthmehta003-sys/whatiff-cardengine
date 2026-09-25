-- WhatIff — 0017: allow one person to register more than one home loan.
--
-- Until now submit_rate treated "one live rate per user + loan_type" as the unit:
-- any new home-loan submission SUPERSEDED the user's previous one. That was meant
-- as an anti-duplicate / self-correction mechanism, but it wrongly collapses the
-- genuine case of a borrower who has TWO home loans (e.g. two properties) — the
-- second entry silently excluded the first.
--
-- Fix: narrow "the same loan" from (user, loan_type) to
-- (user, loan_type, bank, loan_year). So:
--   - re-submitting the SAME loan (same bank + year) still supersedes → the
--     correct/self-edit flow is unchanged;
--   - a DIFFERENT loan (different bank OR different year) is kept alongside → a
--     person with multiple home loans can register each of them.
--
-- Same-bank + same-year is still one live row per person, so no one can stack
-- multiple rows into a single cohort. Signature is unchanged, so this is a plain
-- create-or-replace (grants are preserved; re-granted here to be safe).
--
-- Run AFTER 0016. No app change is needed — the RPC is called exactly as before.

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
  -- Scoping to bank + year is what lets a person hold several distinct loans.
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

  -- Floating below-floor check — from benchmark_history via bank_floor() (0013).
  if p_rate_type = 'Floating' then
    v_floor := public.bank_floor(p_bank, now()::date);
    if v_floor is not null and p_rate < v_floor - 0.50 then
      update public.rates set excluded = true, exclude_reason = 'below_floor' where id = v_id;
    end if;
  end if;

  -- Supersede only earlier submissions of THE SAME loan (same bank + year) from
  -- this user — not their other loans.
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
-- Data fix: restore any rows that the old (too-broad) rule superseded but which
-- are actually distinct loans — i.e. a superseded row that does NOT share its
-- (user, loan_type, bank, loan_year) with a still-live row. This un-parks
-- Ankit's SBI loan without resurrecting genuine duplicates.
-- ---------------------------------------------------------------------------
update public.rates r
   set excluded = false, exclude_reason = null
 where r.excluded = true
   and r.exclude_reason = 'superseded'
   and not exists (
     select 1 from public.rates x
     where x.excluded = false
       and x.user_id = r.user_id
       and x.loan_type = r.loan_type
       and x.bank = r.bank
       and x.loan_year = r.loan_year
   );
