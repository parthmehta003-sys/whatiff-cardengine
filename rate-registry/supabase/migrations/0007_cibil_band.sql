-- WhatIff — 0007: add a CIBIL score band as a cohort dimension.
--
-- Why: the product hook is "two people, same profile, different rate." For
-- floating home loans in India the rate is largely national (RLLR/EBLR + a
-- spread); the spread is driven mostly by the borrower's CREDIT SCORE, not their
-- city. So the score band is the dimension that actually explains the gap — and
-- it's actionable ("your rate is high for your band — worth a call"). City was
-- considered and rejected: low rate-signal, worsens cohort sparsity, and it's an
-- unverifiable field that just hands a spammer a target.
--
-- Run AFTER 0001 (and after 0006, which last redefined submit_rate — this file
-- carries that body forward). Independent of 0002–0005.
--
-- ORDERING NOTE for deployment: the app sends p_cibil_band to submit_rate and
-- cohort_stats, so APPLY THIS MIGRATION BEFORE deploying the matching app.js,
-- or the RPCs 400 on the unknown argument during the gap.

-- ---------------------------------------------------------------------------
-- 1. Column + allowed values. Nullable on purpose: existing rows (and the
--    Business/Personal types) carry NULL, and a NULL simply doesn't match any
--    score-band cohort tier — it falls through to the bank-wide tier, so nothing
--    regresses. The Home form requires a choice ('Not sure' is the escape hatch).
-- ---------------------------------------------------------------------------
alter table public.rates add column if not exists cibil_band text;
alter table public.rates drop constraint if exists cibil_allowed;
alter table public.rates add  constraint cibil_allowed
  check (cibil_band is null or cibil_band in ('800+','750-799','700-749','Below 700','Not sure'));

-- ---------------------------------------------------------------------------
-- 2. submit_rate — add p_cibil_band (13th arg). Adding an argument changes the
--    signature, so drop the old function and recreate. Body is 0006's, plus:
--      * cibil_band is written on insert,
--      * cibil_band is part of the "identical resubmit" test (a changed band is
--        treated as a correction and supersedes, like any other field).
-- ---------------------------------------------------------------------------
drop function if exists public.submit_rate(uuid,text,text,numeric,int,int,text,text,text,int,int,text);

create function public.submit_rate(
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
     and v_last.cibil_band is not distinct from p_cibil_band
  then
    return v_last.id;
  end if;

  insert into public.rates(
    session_id, loan_type, bank, rate, loan_year, amount_lakh, rate_type,
    channel, employment, cmr_band, turnover_cr, city, cibil_band)
  values (
    p_session_id, p_loan_type, p_bank, p_rate, p_loan_year, p_amount_lakh, p_rate_type,
    p_channel, p_employment, p_cmr_band, p_turnover_cr, p_city, p_cibil_band)
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

-- ---------------------------------------------------------------------------
-- 3. cohort_stats — add p_cibil_band and make the score band a matching
--    dimension. Signature change => drop + recreate + re-grant.
--
--    Drop order (weakest rate-signal first, so the score band survives longest):
--      tier 1: bank + employment + cibil + year + channel   (exact)
--      tier 2: bank + employment + cibil + year             (drop channel)
--      tier 3: bank + employment + cibil                    (drop year)
--      tier 4: bank + cibil                                 (drop employment)
--      tier 5: bank                                         (drop cibil; widest)
--
--    A NULL p_cibil_band (older clients / Business) collapses tiers 1–4 toward
--    empty and lands on tier 5 — same graceful widening as before. When the
--    caller passes a band but the tight cells are thin, it widens the same way.
-- ---------------------------------------------------------------------------
drop function if exists public.cohort_stats(text,text,int,text,text);

create function public.cohort_stats(
  p_loan_type  text,
  p_bank       text,
  p_year       int,
  p_channel    text,
  p_employment text,
  p_cibil_band text default null)
returns table (
  rates numeric[], median_rate numeric, p25_rate numeric,
  n int, tier int, tier_label text)
language plpgsql
security definer
set search_path = public
as $$
declare
  t       int;
  v_tier  int  := 5;                 -- widest tier is the fallback
  v_label text;
  v_where text;
  v_cnt   int;
  v_cibil text;                      -- human phrase for the band
begin
  v_cibil := case
    when p_cibil_band is null      then ''
    when p_cibil_band = 'Not sure' then ' whose score isn''t shared'
    else format(' in the %s CIBIL band', p_cibil_band)
  end;

  -- Pick the tightest tier that has >= 4 rows (else the widest, tier 5).
  for t in 1..5 loop
    if t = 1 then
      v_where := format(
        'loan_type=%L and bank=%L and employment=%L and cibil_band=%L and loan_year=%s and channel=%L',
        p_loan_type, p_bank, p_employment, p_cibil_band, p_year, p_channel);
    elsif t = 2 then
      v_where := format(
        'loan_type=%L and bank=%L and employment=%L and cibil_band=%L and loan_year=%s',
        p_loan_type, p_bank, p_employment, p_cibil_band, p_year);
    elsif t = 3 then
      v_where := format(
        'loan_type=%L and bank=%L and employment=%L and cibil_band=%L',
        p_loan_type, p_bank, p_employment, p_cibil_band);
    elsif t = 4 then
      v_where := format(
        'loan_type=%L and bank=%L and cibil_band=%L',
        p_loan_type, p_bank, p_cibil_band);
    else
      v_where := format('loan_type=%L and bank=%L', p_loan_type, p_bank);
    end if;

    execute format('select count(*) from public.rates where excluded=false and %s', v_where)
      into v_cnt;

    if v_cnt >= 4 or t = 5 then
      v_tier := t;
      exit;
    end if;
  end loop;

  v_label := case v_tier
    when 1 then 'your exact group'
    when 2 then format('%s %s borrowers%s who took a loan in %s (any channel)',
                       p_bank, lower(coalesce(p_employment,'')), v_cibil, p_year)
    when 3 then format('%s %s borrowers%s', p_bank, lower(coalesce(p_employment,'')), v_cibil)
    when 4 then format('%s borrowers%s', p_bank, v_cibil)
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

revoke all on function public.cohort_stats(text,text,int,text,text,text) from public;
grant execute on function public.cohort_stats(text,text,int,text,text,text) to anon;

-- ---------------------------------------------------------------------------
-- 4. Make outlier detection SCORE-BAND-AWARE.
--    0006 judged each rate against the whole bank's median/MAD. That was fine
--    until now, but with score bands it's wrong: a lower credit band legitimately
--    carries a higher rate, so a whole band would be flagged as "outliers"
--    against a bank median dominated by the top band — nuking exactly the
--    variation this feature exists to show. Segment the test by cibil_band so a
--    rate is judged against its OWN band's peers (which is also the more correct
--    fraud test: a suspiciously low rate claimed at "Below 700" is compared with
--    other Below-700 reports, not with 800+ borrowers). Rows with a NULL band
--    (older submissions) form their own segment via IS NOT DISTINCT FROM. The
--    revocation accrual is unchanged.
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
  where loan_type = new.loan_type and bank = new.bank
    and cibil_band is not distinct from new.cibil_band
    and excluded = false;

  if v_cnt >= 5 and v_median is not null then
    select percentile_cont(0.5) within group (order by abs(rate - v_median))
      into v_mad
    from public.rates
    where loan_type = new.loan_type and bank = new.bank
      and cibil_band is not distinct from new.cibil_band
      and excluded = false;

    update public.rates
       set excluded = true, exclude_reason = 'outlier'
     where loan_type = new.loan_type and bank = new.bank
       and cibil_band is not distinct from new.cibil_band
       and excluded = false
       and (
             (v_mad > 0 and abs(rate - v_median) > 3.5 * 1.4826 * v_mad)
          or (coalesce(v_mad, 0) = 0 and abs(rate - v_median) > 1.00)
       );
  end if;

  -- Revoke any session that has accumulated too many out-of-range reports
  -- (counted across all banks/bands; the concern is a person feeding bad data).
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
