-- WhatIff — 0004: represent flat processing (takeover) fees faithfully.
--
-- Door 3 is a balance transfer TO the cheapest bank. Some lenders charge that as
-- a small FLAT takeover fee (e.g. Bank of Baroda: flat Rs 8,500), not a % of the
-- loan. Storing those as a % — or falling back to the 0.5% ASSUMPTION estimate —
-- overstates Door 3's cost badly (Rs 8,500 shown as ~Rs 22,500) and wrongly
-- suppresses the recommendation, exactly when the target bank is a cheap one.
-- Add a rupee column, mirroring conversion_fee_flat (0003). For the processing
-- portion of Door 3 the app uses: processing_fee_flat if set, else
-- processing_fee_pct x outstanding, else the ASSUMPTION default. (MOD and
-- legal/valuation are added on top either way.)
--
-- Run AFTER 0003.

alter table public.benchmarks add column if not exists processing_fee_flat numeric(9,2);

-- Return-type change on both readers => drop+create, then re-grant to anon.
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
  select repo_rate, rllr, advertised_floor,
         conversion_fee_pct, conversion_fee_flat,
         processing_fee_pct, processing_fee_flat,
         source_url, fee_source_url, as_of, effective_from
  from public.benchmarks
  where bank = p_bank and effective_from <= now()::date
  order by effective_from desc
  limit 1;
$$;

drop function if exists public.bank_rates(text);
create function public.bank_rates(p_loan_type text default 'Home')
returns table (bank text, p25_rate numeric, median_rate numeric, n int,
               processing_fee_pct numeric, processing_fee_flat numeric)
language sql
security definer
set search_path = public
as $$
  with r as (
    select bank,
           round(percentile_cont(0.25) within group (order by rate)::numeric, 2) as p25,
           round(percentile_cont(0.50) within group (order by rate)::numeric, 2) as med,
           count(*)::int as n
    from public.rates
    where excluded = false and loan_type = p_loan_type
    group by bank
    having count(*) >= 4
  ),
  b as (
    select distinct on (bank) bank, processing_fee_pct, processing_fee_flat
    from public.benchmarks
    where effective_from <= now()::date
    order by bank, effective_from desc
  )
  select r.bank, r.p25, r.med, r.n, b.processing_fee_pct, b.processing_fee_flat
  from r left join b on b.bank = r.bank
  order by r.p25 asc;
$$;

revoke all on function public.bank_benchmark(text) from public;
revoke all on function public.bank_rates(text)     from public;
grant execute on function public.bank_benchmark(text) to anon;
grant execute on function public.bank_rates(text)     to anon;
