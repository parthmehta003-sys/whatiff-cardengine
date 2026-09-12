-- WhatIff — 0003: represent flat conversion fees faithfully.
--
-- Many lenders charge the rate-conversion (Door 2) fee as a small FLAT amount
-- (or a % with a low cap that behaves like a flat fee), not a % of the loan.
-- Storing those as a % overstates Door 2's fee badly (₹5k charged as ₹20k), so
-- add a rupee column. The app uses: conversion_fee_flat if set, else
-- conversion_fee_pct × outstanding, else the ASSUMPTION default.
--
-- Run AFTER 0002.

alter table public.benchmarks add column if not exists conversion_fee_flat numeric(9,2);

drop function if exists public.bank_benchmark(text);
create function public.bank_benchmark(p_bank text)
returns table (
  repo_rate numeric, rllr numeric, advertised_floor numeric,
  conversion_fee_pct numeric, conversion_fee_flat numeric, processing_fee_pct numeric,
  source_url text, fee_source_url text, as_of date, effective_from date)
language sql
security definer
set search_path = public
as $$
  select repo_rate, rllr, advertised_floor,
         conversion_fee_pct, conversion_fee_flat, processing_fee_pct,
         source_url, fee_source_url, as_of, effective_from
  from public.benchmarks
  where bank = p_bank and effective_from <= now()::date
  order by effective_from desc
  limit 1;
$$;

revoke all on function public.bank_benchmark(text) from public;
grant execute on function public.bank_benchmark(text) to anon;
