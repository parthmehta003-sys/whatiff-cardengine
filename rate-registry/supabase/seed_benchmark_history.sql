-- WhatIff — benchmark_history seed, BATCH 1: the national RBI repo series.
--
-- RUN ORDER: 0001 -> 0010 -> this file. Re-run safe (clears the 'National'/'Repo'
-- rows first). Populates docs/rate-architecture.md §11's dated series, starting
-- with the one series every repo-linked lender needs and that can be reliably
-- primary-sourced: the RBI policy repo rate.
--
-- WHY REPO FIRST (and possibly repo ONLY, for the RLLR family) — the benchmark fork:
--   Only ~7 of the repo-linked banks publish a clean numeric RLLR (SBI, BoB,
--   Canara, PNB, Bank of India, IDBI; Union publishes EBLR; ICICI publishes
--   I-EBLR). HDFC Bank, Axis, Kotak, Yes, IndusInd, Federal and IDFC First publish
--   only "repo + spread" with no consolidated RLLR number. Keying spread off each
--   bank's RLLR therefore (a) has no series for half the banks and (b) is not
--   comparable across banks. Keying off the NATIONAL REPO instead — spread =
--   the borrower's all-in markup over the policy rate — needs one series, is
--   uniform across every repo-linked bank, and works at every cohort back-off
--   level. That decision is pending (see the migration/architecture docs); this
--   repo series is required under EITHER model, so it is safe to seed now. Per-
--   lender RLLR / PLR series follow in later batches once the model is confirmed.
--
-- SOURCE: RBI Monetary Policy Committee decisions. 2025 easing cycle = 125 bps
-- across four cuts (6.50 -> 5.25); held through the 2026 MPCs; next MPC 05-07 Oct
-- 2026. Cross-checked against RBI PIB releases and contemporaneous MPC coverage
-- (Business Standard, PRS India, SCC Online) on 2026-09-16, and against the
-- current 5.25% already verified in seed_benchmarks.sql (as_of 2026-09-10).

delete from public.benchmark_history where lender = 'National' and benchmark_family = 'Repo';

insert into public.benchmark_history
  (lender, benchmark_family, effective_from, benchmark_rate, source_url, verified_at, note) values
  ('National','Repo','2023-02-08',6.50,
   'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx',
   '2026-09-16','Repo held at 6.50% from 08-Feb-2023 through the 2025 easing cycle. Anchor row so any report_date before the first 2025 cut resolves.'),
  ('National','Repo','2025-02-07',6.25,
   'https://www.business-standard.com/finance/news/rbi-rate-cut-february-2025-sanjay-malhotra-125020700479_1.html',
   '2026-09-16','MPC cut 25 bps to 6.25% (07-Feb-2025) — first cut in ~2.5 years.'),
  ('National','Repo','2025-04-09',6.00,
   'https://www.pib.gov.in/PressNoteDetails.aspx?NoteId=154573&ModuleId=3&reg=48&lang=2',
   '2026-09-16','MPC cut 25 bps to 6.00% (09-Apr-2025), first MPC of FY26.'),
  ('National','Repo','2025-06-06',5.50,
   'https://www.pib.gov.in/PressNoteDetails.aspx?NoteId=154573&ModuleId=3&reg=48&lang=2',
   '2026-09-16','MPC cut 50 bps to 5.50% (06-Jun-2025). Held at 5.50% through Aug & Oct 2025 MPCs.'),
  ('National','Repo','2025-12-05',5.25,
   'https://www.business-standard.com/finance/news/rbi-mpc-december-2025-rate-cut-announcement-sanjay-malhotra-cpi-inflation-125120500161_1.html',
   '2026-09-16','58th MPC cut 25 bps to 5.25% (05-Dec-2025), the 4th cut of 2025 (125 bps cumulative). Held through the 2026 MPCs; still 5.25% as of 2026-09-16. Matches seed_benchmarks.sql.');
