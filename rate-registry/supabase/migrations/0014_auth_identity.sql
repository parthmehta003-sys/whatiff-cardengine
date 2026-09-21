-- WhatIff — 0014: authenticated identity for submissions (spam / Sybil control).
--
-- WHAT changes, and WHY it keeps the site anonymous:
--   * Adding a rate now REQUIRES sign-in (Supabase Auth: Google or email+password).
--     Reading the registry stays fully open — no login to view aggregates.
--   * Each submission is bound to a `user_id` that is DERIVED SERVER-SIDE from the
--     caller's login token (auth.uid()). The browser never sends it, so it cannot
--     be spoofed. The rate-limit, the "one live report per person" supersede, and
--     the revocation logic all re-key from the bypassable `session_id` onto this
--     real `user_id` — so clearing localStorage / incognito no longer resets
--     anything. That is the actual Sybil cost: one verified account = one identity.
--   * `user_id` is treated exactly like `session_id`: NO read RPC ever returns it,
--     and the browser has no direct table access (RLS + security-definer RPCs).
--     Names/emails live only in Supabase's `auth.users`, which the public API never
--     touches. Every viewer still sees anonymous aggregates only.
--
-- This is additive: legacy rows keep their NULL user_id and are untouched.
--
-- Run AFTER 0013. Then, in the Supabase dashboard, enable the Google and Email
-- providers and set the Site URL / redirect URLs (see DEPLOY_0014_auth.md), and
-- only THEN ship the matching app.js — the new frontend gates submit behind login.

-- ---------------------------------------------------------------------------
-- 1. Identity column + revoked-users table.
-- ---------------------------------------------------------------------------
alter table public.rates add column if not exists user_id uuid;
create index if not exists rates_user_idx on public.rates (user_id, created_at) where user_id is not null;

create table if not exists public.banned_users (
  user_id       uuid primary key,
  reason        text not null,
  flagged_count int  not null default 0,
  banned_at     timestamptz not null default now()
);
alter table public.banned_users enable row level security;
revoke all on public.banned_users from anon, authenticated;
-- No policy, no grant: only the security-definer functions below touch it.

-- ---------------------------------------------------------------------------
-- 2. submit_rate — carries forward the 0013 body (benchmark-family resolution,
--    bank_floor below-floor check), plus:
--      * require a signed-in caller (auth.uid()); reject anon with 'auth_required',
--      * derive user_id server-side and store it,
--      * key the identical-resubmit test, the supersede, and the ban check on the
--        real user_id instead of the client session_id.
--    Signature is unchanged (13 args) — identity rides in the JWT, not a param —
--    so the frontend RPC call shape does not change.
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
  p_city        text default null,
  p_cibil_band  text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_last   public.rates%rowtype;
  v_id     bigint;
  v_family text;
  v_conf   text;
  v_floor  numeric;
begin
  if v_uid is null then
    raise exception 'auth_required: please sign in to add your rate'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.banned_users where user_id = v_uid) then
    raise exception 'session_revoked: this account is blocked after repeated out-of-range submissions'
      using errcode = 'check_violation';
  end if;

  -- Most recent live row for THIS USER + loan type.
  select * into v_last
  from public.rates
  where user_id = v_uid and loan_type = p_loan_type and excluded = false
  order by created_at desc, id desc
  limit 1;

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

  select rf.benchmark_family, rf.resolution_confidence
    into v_family, v_conf
  from public.resolve_benchmark_family(p_bank, p_loan_year, p_rate_type) rf;

  insert into public.rates(
    user_id, session_id, loan_type, bank, rate, loan_year, amount_lakh, rate_type,
    channel, employment, cmr_band, turnover_cr, city, cibil_band,
    benchmark_family, resolution_confidence, family_map_version)
  values (
    v_uid, p_session_id, p_loan_type, p_bank, p_rate, p_loan_year, p_amount_lakh, p_rate_type,
    p_channel, p_employment, p_cmr_band, p_turnover_cr, p_city, p_cibil_band,
    v_family, v_conf, '2026.09')
  returning id into v_id;

  -- Floating below-floor check — from benchmark_history via bank_floor() (0013).
  if p_rate_type = 'Floating' then
    v_floor := public.bank_floor(p_bank, now()::date);
    if v_floor is not null and p_rate < v_floor - 0.50 then
      update public.rates set excluded = true, exclude_reason = 'below_floor' where id = v_id;
    end if;
  end if;

  -- Supersede earlier submissions from THIS USER + loan type.
  update public.rates
     set excluded = true, exclude_reason = 'superseded'
   where user_id = v_uid and loan_type = p_loan_type
     and id <> v_id and excluded = false;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Rate limit — re-key onto user_id, reject banned users. Carries forward the
--    0006 window (8 inserts / 24h). Legacy session-only rows keep the old path.
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
  if new.user_id is not null then
    if exists (select 1 from public.banned_users where user_id = new.user_id) then
      raise exception 'session_revoked: this account is blocked after repeated out-of-range submissions'
        using errcode = 'check_violation';
    end if;
    select count(*) into v_recent
    from public.rates
    where user_id = new.user_id and created_at > now() - interval '24 hours';
  else
    if exists (select 1 from public.banned_sessions where session_id = new.session_id) then
      raise exception 'session_revoked: this session is blocked after repeated out-of-range submissions'
        using errcode = 'check_violation';
    end if;
    select count(*) into v_recent
    from public.rates
    where session_id = new.session_id and created_at > now() - interval '24 hours';
  end if;

  if v_recent >= 8 then
    raise exception 'rate_limit_exceeded: too many submissions in the last 24 hours'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_rate_limit on public.rates;
create trigger trg_rate_limit
  before insert on public.rates
  for each row execute function public.enforce_rate_limit();

-- ---------------------------------------------------------------------------
-- 4. Outlier reclassification — carries forward the 0008 body (per bank + CIBIL
--    band, median/MAD with the 0.75 absolute floor), but accrues bans onto
--    banned_USERS by user_id (the durable identity) instead of banned_sessions.
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
       and abs(rate - v_median) > 0.75
       and (
             (v_mad > 0 and abs(rate - v_median) > 3.5 * 1.4826 * v_mad)
          or (coalesce(v_mad, 0) = 0)
       );
  end if;

  -- Revoke any USER who has accumulated too many out-of-range reports.
  insert into public.banned_users (user_id, reason, flagged_count)
  select user_id, 'too_many_flagged_reports', count(*)
  from public.rates
  where excluded = true
    and exclude_reason in ('outlier', 'below_floor')
    and user_id is not null
    and user_id in (
      select user_id from public.rates
      where loan_type = new.loan_type and bank = new.bank
        and exclude_reason in ('outlier', 'below_floor')
        and user_id is not null
    )
  group by user_id
  having count(*) >= public.abuse_ban_threshold()
  on conflict (user_id) do update
    set flagged_count = excluded.flagged_count, banned_at = now();

  return null;
end;
$$;

drop trigger if exists trg_outliers on public.rates;
create trigger trg_outliers
  after insert on public.rates
  for each row execute function public.reclassify_bank_outliers();

-- ---------------------------------------------------------------------------
-- 5. Grants. submit_rate stays callable by anon (so a logged-out call returns a
--    clean 'auth_required' rather than a raw permission error) and authenticated.
--    CRUCIAL: signed-in requests run as the `authenticated` role, and grants to
--    `anon` do NOT extend to it. Mirror every anon EXECUTE grant onto
--    authenticated so logged-in users can read the registry and submit. Doing it
--    dynamically keeps the two roles exactly in sync, now and for past migrations.
-- ---------------------------------------------------------------------------
revoke all on function public.submit_rate(uuid,text,text,numeric,int,int,text,text,text,int,int,text,text) from public;
grant execute on function public.submit_rate(uuid,text,text,numeric,int,int,text,text,text,int,int,text,text) to anon;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  loop
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;
