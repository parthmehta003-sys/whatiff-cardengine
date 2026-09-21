-- WhatIff — 0015: registry headline stats for the landing trust strip.
--
-- Three honest numbers, all server-computed from real rows:
--   * rates shared            — count of live submissions
--   * home loans tracked      — sum of their loan amounts (shown in ₹ crore)
--   * potential savings        — sum of the recommended-door net benefit we have
--     IDENTIFIED / shown to borrowers. Deliberately NOT "saved": we don't know a
--     borrower acted, so the UI must say "identified", never "saved".
--
-- The potential saving is computed client-side (it depends on the cohort P25,
-- the borrower's entered/estimated balance, tenure and per-lender fees — none of
-- which are fully reconstructable in SQL), so the browser reports it back through
-- record_potential(). That write is bounded: it can only set the value on the
-- caller's OWN row, and it's capped at the loan principal (you can't "save" more
-- than you borrowed) — so the marketing number can't be inflated arbitrarily.
--
-- Run AFTER 0014. Independent of the others. Apply BEFORE the app.js that calls
-- registry_stats()/record_potential().

alter table public.rates add column if not exists potential_saving numeric;

-- Record the identified potential saving on the caller's own row. Capped to
-- [0, principal]; a NULL/<=0 saving is stored as NULL (nothing to count).
create or replace function public.record_potential(p_rate_id bigint, p_saving numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  update public.rates
     set potential_saving = case
           when p_saving is null or p_saving <= 0 then null
           else least(p_saving, amount_lakh * 100000)
         end
   where id = p_rate_id and user_id = v_uid;
end;
$$;

-- Landing stats — aggregates only, over live rows.
create or replace function public.registry_stats()
returns table (n_rates int, tracked_lakh numeric, potential_saving_total numeric)
language sql
security definer
set search_path = public
as $$
  select count(*)::int,
         coalesce(sum(amount_lakh), 0)::numeric,
         coalesce(sum(potential_saving), 0)::numeric
  from public.rates
  where excluded = false;
$$;

revoke all on function public.record_potential(bigint, numeric) from public;
revoke all on function public.registry_stats()                  from public;
grant execute on function public.record_potential(bigint, numeric) to anon, authenticated;
grant execute on function public.registry_stats()                  to anon, authenticated;
