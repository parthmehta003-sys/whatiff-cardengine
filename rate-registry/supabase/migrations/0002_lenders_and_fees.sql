-- WhatIff — 0002: add home-loan NBFCs/HFCs, and per-lender verified fees.
--
-- Run this AFTER 0001 (and after you've applied 0001 to your live project).
-- It (a) widens the allowed-lender list on both tables, (b) adds per-lender fee
-- fields to benchmarks, and (c) updates the read functions to surface those fees.
-- Fees left NULL fall back to the app's labelled ASSUMPTION constants, so nothing
-- breaks before you populate them.

-- ---------------------------------------------------------------------------
-- 1. Expanded lender list (banks + housing-finance companies / NBFCs).
--    Keep this list identical to BANKS in app.js.
-- ---------------------------------------------------------------------------
do $$
declare
  lenders text :=
    $list$'SBI','HDFC Bank','ICICI Bank','Axis Bank','Kotak Mahindra','Bank of Baroda',
    'IDFC First','Canara Bank','Union Bank','Punjab National Bank','Bank of India',
    'IDBI Bank','Yes Bank','IndusInd Bank','Federal Bank','Indian Bank',
    'LIC Housing','PNB Housing','Bajaj Housing','Tata Capital','Godrej Housing',
    'Aadhar Housing Finance','Aavas Financiers','Home First Finance','Repco Home Finance',
    'Can Fin Homes','Sammaan Capital','Piramal Finance','Sundaram Home Finance','Other'$list$;
begin
  execute 'alter table public.rates      drop constraint if exists bank_allowed';
  execute 'alter table public.rates      add  constraint bank_allowed    check (bank in (' || lenders || '))';
  execute 'alter table public.benchmarks drop constraint if exists bm_bank_allowed';
  execute 'alter table public.benchmarks add  constraint bm_bank_allowed check (bank in (' || lenders || '))';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Per-lender fee fields on benchmarks. Verified from each lender's own fee
--    schedule / MITC. NULL => the app uses its default ASSUMPTION constant.
--      conversion_fee_pct  — fee to convert/reset the rate on an EXISTING loan
--                            with this lender (drives Door 2, for the user's bank)
--      processing_fee_pct  — this lender's home-loan processing fee for a NEW /
--                            balance-transfer loan (drives Door 3, for the target)
--    Both are fractions of the loan (e.g. 0.005 = 0.5%).
-- ---------------------------------------------------------------------------
alter table public.benchmarks add column if not exists conversion_fee_pct numeric(5,4);
alter table public.benchmarks add column if not exists processing_fee_pct numeric(5,4);
alter table public.benchmarks add column if not exists fee_source_url text;

-- ---------------------------------------------------------------------------
-- 3. Read functions now surface the fees. (Return-type change => drop+create;
--    re-grant execute to anon.)
-- ---------------------------------------------------------------------------
drop function if exists public.bank_benchmark(text);
create function public.bank_benchmark(p_bank text)
returns table (
  repo_rate numeric, rllr numeric, advertised_floor numeric,
  conversion_fee_pct numeric, processing_fee_pct numeric,
  source_url text, fee_source_url text, as_of date, effective_from date)
language sql
security definer
set search_path = public
as $$
  select repo_rate, rllr, advertised_floor, conversion_fee_pct, processing_fee_pct,
         source_url, fee_source_url, as_of, effective_from
  from public.benchmarks
  where bank = p_bank and effective_from <= now()::date
  order by effective_from desc
  limit 1;
$$;

drop function if exists public.bank_rates(text);
create function public.bank_rates(p_loan_type text default 'Home')
returns table (bank text, p25_rate numeric, median_rate numeric, n int, processing_fee_pct numeric)
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
    select distinct on (bank) bank, processing_fee_pct
    from public.benchmarks
    where effective_from <= now()::date
    order by bank, effective_from desc
  )
  select r.bank, r.p25, r.med, r.n, b.processing_fee_pct
  from r left join b on b.bank = r.bank
  order by r.p25 asc;
$$;

revoke all on function public.bank_benchmark(text) from public;
revoke all on function public.bank_rates(text)     from public;
grant execute on function public.bank_benchmark(text) to anon;
grant execute on function public.bank_rates(text)     to anon;
