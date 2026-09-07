-- Reference benchmarks — TEMPLATE. This file is intentionally NOT run by any
-- build step and ships with NO real numbers.
--
-- READ THIS: the figures below are placeholders (all rates are 0.00 and every
-- source_url says REPLACE_ME). Nobody has verified them. Do not run this file
-- as-is — it would poison the very verification it exists to provide.
--
-- To populate it, put in ONE row per bank per change, each read from a PRIMARY
-- source, and record where and when you read it:
--   * repo_rate       -> RBI, https://www.rbi.org.in (MPC / policy rates page)
--   * rllr            -> the bank's OWN interest-rates / RLLR disclosure page
--   * advertised_floor-> the bank's home-loan product page ("from X%")
--   * mclr (optional) -> the bank's MCLR disclosure, for pre-2019 loans
-- source_url and as_of are REQUIRED by the schema, so an unsourced number can't
-- get in. Refresh whenever the RBI repo rate moves (a bank's RLLR follows it).
--
-- Because floating loans reset to the CURRENT benchmark, keep the latest row
-- accurate; older rows are only needed to reason about fixed loans by vintage.
--
-- Example shape (bank, effective_from, repo, rllr, mclr, advertised_floor,
--                source_url, as_of, note):

/*  UNCOMMENT and fill with figures YOU have verified. Delete the 0.00s.

insert into public.benchmarks
  (bank, effective_from, repo_rate, rllr, mclr, advertised_floor, source_url, as_of, note) values
  ('SBI',        '2025-XX-XX', 0.00, 0.00, null, 0.00, 'REPLACE_ME: sbi.co.in rates page',        '2025-XX-XX', 'verify before launch'),
  ('HDFC Bank',  '2025-XX-XX', 0.00, 0.00, null, 0.00, 'REPLACE_ME: hdfcbank.com rates page',      '2025-XX-XX', 'verify before launch'),
  ('ICICI Bank', '2025-XX-XX', 0.00, 0.00, null, 0.00, 'REPLACE_ME: icicibank.com rates page',     '2025-XX-XX', 'verify before launch');
  -- ... one per bank in the allowed list you want to benchmark.

*/

-- Sanity check you can run AFTER populating — every row must be sourced:
--   select bank, effective_from, rllr, advertised_floor, source_url, as_of
--   from public.benchmarks order by bank, effective_from desc;
