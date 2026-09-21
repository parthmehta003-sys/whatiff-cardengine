-- WhatIff — 0010: append-only benchmark history (family-keyed dated series).
--
-- Run AFTER 0001 (independent of 0002-0009). This is the infrastructure the rate
-- architecture calls the real cost (docs/rate-architecture.md §11): a DATED series
-- per lender per benchmark family, so a report's spread can be taken against the
-- benchmark effective on its OWN report_date, not today's
-- (docs/rate-migration-spec.md §3, the single spread rule).
--
-- ADDITIVE, NOT A RESTRUCTURE. The existing public.benchmarks (wide: one row per
-- bank/date with repo_rate/rllr/mclr/advertised_floor columns) stays in place and
-- keeps serving bank_benchmark() and the submit_rate floor check UNCHANGED. This
-- migration only adds the new long/append-only table + a read path. Redefining
-- bank_benchmark()/the floor check to read from history, backfilling advertised_floor
-- and RLLR, and eventually dropping the old table are a LATER migration, done once
-- this history is populated and validated (migration spec §2.3).
--
-- APPEND-ONLY: a new rate is a new row (new effective_from). There is deliberately
-- NO effective_to column — storing it would force UPDATEing the prior row on every
-- insert (an update anomaly that breaks append-only). The active row for any date
-- is "latest effective_from <= that date" within (lender, benchmark_family).
--
-- FAMILY NAMING (join-safety, docs/rate-architecture.md §4): the resolver emits
-- RLLR for bank repo-linked loans and NEVER "EBLR"; benchmark_family here must use
-- the SAME values or the spread join returns NULL silently. Repo is the national
-- series (lender = 'National'). AdvertisedFloor is a per-lender pseudo-family.

create table if not exists public.benchmark_history (
  id               bigserial primary key,
  lender           text not null,              -- a lenders/rates allowed value, or 'National' for Repo
  benchmark_family text not null,              -- RLLR | MCLR | Base | PLR | Repo | AdvertisedFloor
  effective_from   date not null,              -- date this figure took effect
  benchmark_rate   numeric(5,2) not null,      -- the figure itself (% p.a.)
  source_url       text not null,              -- REQUIRED: where this number was read
  verified_at      date not null,              -- REQUIRED: when it was verified/captured
  note             text,
  constraint bh_family_allowed check (benchmark_family in
    ('RLLR','MCLR','Base','PLR','Repo','AdvertisedFloor')),  -- no 'EBLR': alias of RLLR
  -- one figure per lender+family+date; a genuine correction re-inserts a later row
  constraint benchmark_history_uidx unique (lender, benchmark_family, effective_from)
);

-- Read pattern is always "latest effective_from <= target date" per (lender, family).
create index if not exists benchmark_history_lookup_idx
  on public.benchmark_history (lender, benchmark_family, effective_from desc);

-- RLS: base table is not directly readable by clients; the read path is the RPC below.
alter table public.benchmark_history enable row level security;
revoke all on public.benchmark_history                 from anon, authenticated;
revoke all on sequence public.benchmark_history_id_seq from anon, authenticated;

-- Convenience view: the CURRENT figure per (lender, family) — the latest row.
create or replace view public.current_benchmark as
  select distinct on (lender, benchmark_family)
         lender, benchmark_family, effective_from, benchmark_rate, source_url, verified_at
  from public.benchmark_history
  order by lender, benchmark_family, effective_from desc;

-- Read RPC: the benchmark active for a (lender, family) as of a given date.
-- Security definer + fixed search_path, granted to anon (the read path is unauth),
-- mirroring the 0001 aggregate RPCs.
create or replace function public.benchmark_asof(
  p_lender text,
  p_family text,
  p_asof   date default current_date)
returns numeric
language sql
security definer
set search_path = public
stable
as $$
  select benchmark_rate
  from public.benchmark_history
  where lender = p_lender
    and benchmark_family = p_family
    and effective_from <= p_asof
  order by effective_from desc
  limit 1;
$$;

revoke all on function public.benchmark_asof(text, text, date) from public;
grant execute on function public.benchmark_asof(text, text, date) to anon;
