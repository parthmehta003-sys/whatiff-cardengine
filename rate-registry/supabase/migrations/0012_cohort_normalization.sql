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
