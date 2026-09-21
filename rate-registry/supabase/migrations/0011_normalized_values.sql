-- WhatIff — 0011: the two normalized objects, per report (docs/rate-architecture.md §4).
--
-- Run AFTER 0009 (needs rates.benchmark_family) and 0010 (needs benchmark_history
-- + benchmark_asof). These are read-path RPCs: security definer, fixed search_path,
-- granted to anon, mirroring the 0001 aggregates.
--
-- TWO SEPARATELY-NAMED OBJECTS — never one generic "spread":
--   * benchmark_spread = reported_rate - the lender's OWN benchmark (RLLR/PLR/MCLR),
--     within-lender comparable. Needs that lender's dated series; returns NULL where
--     none exists yet (RLLR/PLR history is a fast follow), so the capability is
--     present but naturally NULL today.
--   * repo_markup = reported_rate - national repo, REPO-LINKED (RLLR family) ONLY.
--     Powered now by seed_benchmark_history.sql. A category error for PLR/MCLR/etc,
--     so guarded to RLLR.
--
-- AS-OF RULE (both objects): use the benchmark effective on the report's OWN date
-- (created_at::date), not today's, so an older report is not re-based to a benchmark
-- that has since moved (docs/rate-migration-spec.md §3).
--
-- repo_markup is DESCRIPTIVE, not diagnostic (design §8.0): callers must present it
-- as pricing context, never as "you are overpaying by this much".

-- benchmark_spread: rate - lender's own benchmark of the row's family, as-of report date.
create or replace function public.get_benchmark_spread(p_report_id bigint)
returns numeric
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  r     public.rates%rowtype;
  v_bm  numeric;
begin
  select * into r from public.rates where id = p_report_id;
  if not found then return null; end if;

  -- Only families with a lender-specific benchmark series. Fixed/Unknown never.
  if r.benchmark_family not in ('RLLR','PLR','MCLR','Base') then
    return null;
  end if;

  -- The lender's OWN benchmark, effective on the report's date.
  v_bm := public.benchmark_asof(r.bank, r.benchmark_family, r.created_at::date);
  if v_bm is null then
    return null;           -- no series for this lender/family yet -> no guess
  end if;

  return round((r.rate - v_bm)::numeric, 2);
end;
$$;

-- repo_markup: rate - national repo, as-of report date. RLLR (repo-linked) ONLY.
create or replace function public.get_repo_markup(p_report_id bigint)
returns numeric
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  r      public.rates%rowtype;
  v_repo numeric;
begin
  select * into r from public.rates where id = p_report_id;
  if not found then return null; end if;

  -- Repo-linked only. PLR/MCLR/Base/Fixed/Unknown -> NULL (category error otherwise).
  if r.benchmark_family <> 'RLLR' then
    return null;
  end if;

  v_repo := public.benchmark_asof('National', 'Repo', r.created_at::date);
  if v_repo is null then
    return null;
  end if;

  return round((r.rate - v_repo)::numeric, 2);
end;
$$;

revoke all on function public.get_benchmark_spread(bigint) from public;
grant execute on function public.get_benchmark_spread(bigint) to anon;
revoke all on function public.get_repo_markup(bigint) from public;
grant execute on function public.get_repo_markup(bigint) to anon;
