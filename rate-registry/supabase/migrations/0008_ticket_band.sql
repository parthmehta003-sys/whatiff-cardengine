-- WhatIff — 0008: add a loan ticket-size band as a cohort dimension.
--
-- Why: banks price home loans in TICKET-SIZE SLABS — a ₹25L loan and a ₹1.5Cr
-- loan at the same bank and score are simply not in the same pricing bracket. We
-- already collect the loan amount (it drives the EMI and the door maths) but never
-- used it to define "people like you." This adds it to the cohort ladder at ZERO
-- extra form friction: the band is derived from the amount already submitted.
--
-- Run AFTER 0007 (it extends the cohort_stats that 0007 created). Independent of
-- 0002–0006. As with 0007, APPLY THIS BEFORE deploying the matching app.js — the
-- app sends the new p_amount_lakh argument to cohort_stats.
--
-- Note on the outlier test: it stays segmented by bank + CIBIL band only, NOT by
-- ticket band. Ticket size shifts the rate by ~0.1–0.2%, well inside the
-- median/MAD gate, so legitimate ticket variation isn't mistaken for fraud; and
-- segmenting the outlier test any finer would starve it of the ≥5 peers it needs
-- to judge anything. Cohort matching wants fine granularity (relevance); the
-- fraud test wants enough peers (judgement) — different jobs, different grain.

-- ---------------------------------------------------------------------------
-- 1. Coarse ticket band from amount_lakh. Four brackets that mirror how lenders
--    actually slab pricing. IMMUTABLE so it can be used freely in the cohort
--    predicates. NULL in -> NULL out (older clients that don't send the amount
--    simply won't match a ticket tier and widen past it).
--      1: <= ₹30 lakh   2: ₹30–75 lakh   3: ₹75 lakh–₹2 crore   4: > ₹2 crore
-- ---------------------------------------------------------------------------
create or replace function public.amount_band(n int)
returns int
language sql
immutable
as $$
  select case
    when n is null then null
    when n <= 30   then 1
    when n <= 75   then 2
    when n <= 200  then 3
    else 4
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. cohort_stats — add p_amount_lakh and make the ticket band a matching
--    dimension. Signature change => drop + recreate + re-grant.
--
--    Drop order (weakest rate-signal first, so the two hard pricing levers —
--    score and ticket size — survive longest):
--      tier 1: bank + cibil + ticket + employment + year + channel  (exact)
--      tier 2: bank + cibil + ticket + employment + year            (drop channel)
--      tier 3: bank + cibil + ticket + employment                   (drop year)
--      tier 4: bank + cibil + ticket                                (drop employment)
--      tier 5: bank + cibil                                         (drop ticket)
--      tier 6: bank                                                 (drop cibil; widest)
--
--    A NULL band on either side (older clients / Business) collapses the tiers
--    that use it toward empty and lands on a wider tier — the same graceful
--    widening as before, no regression.
-- ---------------------------------------------------------------------------
drop function if exists public.cohort_stats(text,text,int,text,text,text);

create function public.cohort_stats(
  p_loan_type   text,
  p_bank        text,
  p_year        int,
  p_channel     text,
  p_employment  text,
  p_cibil_band  text default null,
  p_amount_lakh int  default null)
returns table (
  rates numeric[], median_rate numeric, p25_rate numeric,
  n int, tier int, tier_label text)
language plpgsql
security definer
set search_path = public
as $$
declare
  t        int;
  v_tier   int  := 6;                -- widest tier is the fallback
  v_label  text;
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

  -- Predicate that keeps only rows in the caller's ticket band. When the caller
  -- sent no amount, amount_band is NULL and this is 'false' so ticket tiers are
  -- empty and we widen past them.
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

revoke all on function public.cohort_stats(text,text,int,text,text,text,int) from public;
grant execute on function public.cohort_stats(text,text,int,text,text,text,int) to anon;

-- ---------------------------------------------------------------------------
-- 3. Add an ABSOLUTE-DEVIATION FLOOR to the outlier test.
--    The test is segmented by bank + CIBIL band (0007), but within one band
--    rates still legitimately vary by ticket size, employer category, timing and
--    negotiation. When those form tight clusters the MAD collapses toward zero
--    and the pure MAD gate turns hypersensitive — flagging a legitimately
--    different (e.g. larger-ticket, sharper-rate) cluster as fraud. Fix: a rate
--    is an outlier only if it is BOTH statistically far (> 3.5 * 1.4826 * MAD)
--    AND at least 0.75 percentage points off its band median. Ordinary within-
--    band spread is comfortably under 0.75; a real data-entry error or planted
--    fake is points away, so the gross cases we actually want to drop still are.
--    (This is why the outlier grain stays coarser than the cohort grain: the
--    floor absorbs sub-0.75 variation instead of us segmenting the test finer
--    and starving it of the >= 5 peers it needs to judge anything.)
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
       and abs(rate - v_median) > 0.75            -- absolute floor (see note)
       and (
             (v_mad > 0 and abs(rate - v_median) > 3.5 * 1.4826 * v_mad)
          or (coalesce(v_mad, 0) = 0)
       );
  end if;

  -- Revoke any session that has accumulated too many out-of-range reports.
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
