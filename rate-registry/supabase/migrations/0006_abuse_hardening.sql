-- WhatIff — 0006: abuse hardening (rate-limit window, robust outlier test, revocation).
--
-- Run this AFTER 0001 (independent of 0002–0005; run any time after the schema
-- exists). It answers three data-quality asks:
--
--   (1) "one person can't post more than once in 24 hours"
--   (2) "checks on values being way different than the median for the region/bank"
--   (3) "access revoked after posting beyond a certain number of (bad) reports"
--
-- Honest scope — read this before relying on it.
-- The registry has NO sign-up and NO auth, so a "person" is only ever a
-- client-generated session_id kept in localStorage. Clearing storage, using a
-- private window, or scripting the RPC mints a fresh session_id, so ANY
-- per-session limit (this file's included) is bypassable by a determined actor.
-- That is exactly the point raised in the feedback. The real defence against
-- systematic fake data is therefore layered and does NOT lean on the session id
-- alone:
--   * submissions SUPERSEDE within a session+loan_type (see submit_rate in 0001):
--     resubmitting corrects the prior report instead of adding a new one, so a
--     single session already ends up with exactly ONE live report per loan type
--     — that is the "once" guarantee, enforced by construction, not by trust.
--   * a robust median/MAD outlier test (below) drops rows that sit far from the
--     bank's median, and — crucially — uses the median/MAD, not the mean/SD, so a
--     burst of coordinated fakes can't drag the centre to make itself look normal.
--   * a session that accrues several out-of-range reports is revoked.
--   * aggregates never show from < 4 reports (0001), so one or two bad rows that
--     slip past the tests still cannot move a published number on their own.
-- For a hard "one real human, once" guarantee you need an identity signal we
-- don't collect (phone/email OTP, or a login). If/when abuse justifies the
-- signup friction, add it; until then this raises the cost without pretending to
-- be unbypassable.

-- ---------------------------------------------------------------------------
-- 1. Revoked sessions. A session lands here once it has posted too many
--    out-of-range reports; submit_rate then refuses it. Populated by the
--    outlier trigger below.
-- ---------------------------------------------------------------------------
create table if not exists public.banned_sessions (
  session_id    uuid primary key,
  reason        text not null,
  flagged_count int  not null default 0,
  banned_at     timestamptz not null default now()
);
alter table public.banned_sessions enable row level security;
revoke all on public.banned_sessions from anon, authenticated;
-- No policy + no grant: the browser can never read or write this table; only the
-- security-definer functions below touch it.

-- How many flagged (outlier / below-floor) reports from one session trigger a ban.
-- Kept as a single knob so it is easy to tune.
create or replace function public.abuse_ban_threshold() returns int
  language sql immutable as $$ select 3 $$;

-- ---------------------------------------------------------------------------
-- 2. Rate limit — now a 24-hour window, and it rejects revoked sessions.
--    Replaces the 5-per-hour trigger from 0001. The cap is a generous burst
--    ceiling (honest corrections resubmit and are deduped/superseded by
--    submit_rate, so they rarely reach it); its job is to stop a single session
--    scripting a flood, not to police normal editing. The one-live-report
--    guarantee comes from the supersede logic, not from this number.
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
  -- Revoked session? Refuse before doing anything else.
  if exists (select 1 from public.banned_sessions where session_id = new.session_id) then
    raise exception 'session_revoked: this session is blocked after repeated out-of-range submissions'
      using errcode = 'check_violation';
  end if;

  select count(*) into v_recent
  from public.rates
  where session_id = new.session_id
    and created_at > now() - interval '24 hours';

  if v_recent >= 8 then
    raise exception 'rate_limit_exceeded: too many submissions in the last 24 hours'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Trigger name is unchanged from 0001, so the create-or-replace above already
-- rewires it; re-assert it in case 0001's trigger was dropped.
drop trigger if exists trg_rate_limit on public.rates;
create trigger trg_rate_limit
  before insert on public.rates
  for each row execute function public.enforce_rate_limit();

-- ---------------------------------------------------------------------------
-- 3. Robust outlier exclusion + revocation.
--    Replaces the mean/SD test from 0001 with a MEDIAN + MAD test. The mean and
--    SD are themselves poisoned by the fake data we want to catch (a cluster of
--    identical bogus rows pulls the mean toward itself and inflates the SD, so a
--    3-SD gate stops flagging them). The median and the median absolute
--    deviation (MAD) are resistant to up to ~50% contamination, so "way
--    different from the median" is judged against a centre the fakes can't move.
--
--    A row is flagged when |rate - median| > 3.5 * (1.4826 * MAD). The 1.4826
--    scales MAD to a normal-consistent SD estimate; 3.5 of those is a wide,
--    conservative gate (only clear outliers, never ordinary spread). When every
--    kept rate is identical (MAD = 0) we fall back to a flat 1.00-point
--    tolerance so a lone very different value is still caught.
--
--    Then: any session whose count of flagged (outlier/below_floor) live-or-dead
--    reports reaches the ban threshold is revoked. Rows stay in the table
--    (excluded = true); they are only dropped from every aggregate.
-- ---------------------------------------------------------------------------
create or replace function public.reclassify_bank_outliers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cnt    int;
  v_median numeric;
  v_mad    numeric;
begin
  select count(*),
         percentile_cont(0.5) within group (order by rate)
    into v_cnt, v_median
  from public.rates
  where loan_type = new.loan_type and bank = new.bank and excluded = false;

  if v_cnt >= 5 and v_median is not null then
    -- MAD = median of the absolute deviations from the median.
    select percentile_cont(0.5) within group (order by abs(rate - v_median))
      into v_mad
    from public.rates
    where loan_type = new.loan_type and bank = new.bank and excluded = false;

    update public.rates
       set excluded = true, exclude_reason = 'outlier'
     where loan_type = new.loan_type and bank = new.bank
       and excluded = false
       and (
             (v_mad > 0 and abs(rate - v_median) > 3.5 * 1.4826 * v_mad)
          or (coalesce(v_mad, 0) = 0 and abs(rate - v_median) > 1.00)
       );
  end if;

  -- Revoke any session that has now accumulated too many out-of-range reports.
  -- Counted across all banks/loan types (the concern is a person feeding bad
  -- data, wherever they aim it), flagged rows only (superseded corrections and
  -- clean rows never count against anyone).
  insert into public.banned_sessions (session_id, reason, flagged_count)
  select session_id, 'too_many_flagged_reports', count(*)
  from public.rates
  where excluded = true
    and exclude_reason in ('outlier', 'below_floor')
    and session_id in (
      select session_id from public.rates
      where loan_type = new.loan_type and bank = new.bank
        and exclude_reason in ('outlier', 'below_floor')
    )
  group by session_id
  having count(*) >= public.abuse_ban_threshold()
  on conflict (session_id) do update
    set flagged_count = excluded.flagged_count, banned_at = now();

  return null;
end;
$$;

drop trigger if exists trg_outliers on public.rates;
create trigger trg_outliers
  after insert on public.rates
  for each row execute function public.reclassify_bank_outliers();

-- ---------------------------------------------------------------------------
-- 4. Fail fast in submit_rate too, so a revoked session gets a clean error
--    (the same one the trigger would raise) before any work is done. The
--    security model is unchanged — this only short-circuits.
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

-- Re-assert grants (create-or-replace keeps them, but be explicit).
revoke all on function public.submit_rate(uuid,text,text,numeric,int,int,text,text,text,int,int,text) from public;
revoke all on function public.enforce_rate_limit()       from public;
revoke all on function public.reclassify_bank_outliers() from public;
revoke all on function public.abuse_ban_threshold()      from public;
grant execute on function public.submit_rate(uuid,text,text,numeric,int,int,text,text,text,int,int,text) to anon;
