-- Reference benchmarks — verified against each lender's OWN official pages over
-- two web-search passes (benchmark bases: 2026-09-07; advertised home-loan rates
-- from product pages: 2026-09-09). RUN THIS AFTER 0001_rate_registry.sql.
--
-- SPOT-CHECK BEFORE RELYING ON IT: open each source_url and confirm the number.
--
-- Conventions used here:
--   * advertised_floor = the LOWEST rate the lender genuinely advertises to ANY
--     real customer segment (incl. pre-approved / govt-employee / top-CIBIL
--     concessions). This is deliberate: it keeps the sub-floor exclusion in
--     submit_rate from wrongly dropping a real borrower's low rate, and matches
--     the product's "a rate almost nobody gets" framing. Conditions are in note.
--   * rllr / repo_rate / mclr are BASES (actual rate = base + credit-risk
--     premium). They are secondary; advertised_floor drives the UI and the floor.
--   * repo_rate 5.25% corroborated across lenders (e.g. SBI RLLR 7.50 = 5.25 + 2.25).
--
-- Re-verify flags (left in place, values are plausible but single-source or messy):
--   * ICICI rllr 8.95 looks high vs peers; harmless (advertised_floor drives floor/UI).
--   * PNB 7.50 and IDFC 7.75: home-loan pages 406'd / client-rendered on re-check.
--   * Tata Capital & LIC Housing advertised_floor = NULL: contradictory / wrong-
--     product sources — no benchmark line or floor check until verified.
--   * SBI advertised 7.25% is effective 01-04-2026 (a few months stale but current).
--
-- Re-run safely: clears prior rows for these banks first.

delete from public.benchmarks where bank in (
  'SBI','HDFC Bank','ICICI Bank','Axis Bank','Kotak Mahindra','LIC Housing',
  'Bank of Baroda','PNB Housing','Bajaj Housing','IDFC First','Canara Bank',
  'Union Bank','Tata Capital','Godrej Housing');

insert into public.benchmarks
  (bank, effective_from, repo_rate, rllr, mclr, advertised_floor, source_url, as_of, note) values
  ('SBI', '2026-04-01', 5.25, 7.50, 8.70, 7.25, 'https://sbi.bank.in/web/interest-rates/interest-rates/loan-schemes-interest-rates/home-loans-interest-rates-current', '2026-09-09', 'Home loan 7.25% onwards (w.e.f. 01-04-2026). RLLR base 7.50 + CRP; EBLR base 7.90 + CRP + BSP. CIBIL slab card published as image.'),
  ('HDFC Bank', '2026-09-09', 5.25, 7.75, NULL, 7.75, 'https://homeloans.hdfc.bank.in/checklist/home-loan-interest-rates', '2026-09-09', 'Starting 7.75% p.a., salaried and self-employed; Repo 5.25% + 2.50% spread. Page title claims 7.15% but that figure is absent from the body.'),
  ('ICICI Bank', '2026-09-09', 5.25, 8.95, 8.40, 7.55, 'https://www.icici.bank.in/personal-banking/loans/home-loan/interest-rates', '2026-09-09', 'Advertised 7.55% for pre-approved customers via the digital journey; standard rate-card floor is 8.50% salaried (valid till 30-09-2026). Using the lower advertised figure per convention. I-EBLR 8.95 looks high vs peers — re-verify.'),
  ('Axis Bank', '2026-09-09', 5.25, NULL, 8.90, 8.00, 'https://www.axis.bank.in/loans/home-loan/interest-rates-charges', '2026-09-09', 'Starting 8.00% for CIBIL 751+; quoted as Repo + 2.75% to Repo + 3.60%. 1-yr MCLR 8.90%.'),
  ('Kotak Mahindra', '2026-09-09', 5.25, NULL, NULL, 7.60, 'https://www.kotak.bank.in/en/personal-banking/loans/home-loan/interest-rates.html', '2026-09-09', 'Product page advertises starting @7.60% salaried; internal rate schedule shows 7.70%. Using the advertised figure.'),
  ('LIC Housing', '2026-09-09', 5.25, NULL, NULL, NULL, 'https://www.lichousing.com/housing-loan', '2026-09-09', 'HFC. Home-loan rate could not be verified — product pages render rates client-side ("Loading..."); prior 8.40% came from a plot-loan page (wrong product). advertised_floor NULL until verified.'),
  ('Bank of Baroda', '2026-09-09', 5.25, 7.90, 8.75, 7.20, 'https://bankofbaroda.bank.in/loans/home-loan', '2026-09-09', 'Home loan starting @7.20% = BRLLR 7.90% (w.e.f. 06-12-2025) minus lowest spread 0.70%; varies by loan limit and CIBIL. 1-yr MCLR 8.75%.'),
  ('PNB Housing', '2026-09-09', 5.25, NULL, NULL, 7.50, 'https://www.pnbhousing.com/home-loan/interest-rates', '2026-09-09', 'HFC; floating linked to PNBHFR. 7.50% from the rate page (first pass); re-check page returned HTTP 406. Single-source — re-verify.'),
  ('Bajaj Housing', '2026-09-09', 5.25, NULL, NULL, 7.25, 'https://www.bajajhousingfinance.in/home-loan-interest-rates', '2026-09-09', 'HFC. Starting 7.25% p.a. salaried (range to 10.25%); self-employed floor 7.70%. Floating reference (BHPLR) 14.95%.'),
  ('IDFC First', '2026-09-09', 5.25, NULL, NULL, 7.75, 'https://www.idfcfirst.bank.in/personal-banking/loans/home-loan/home-loan-interest-rates', '2026-09-09', '7.75% from the home-loan page (first pass); re-check served rates client-side and could not confirm. Single-source — re-verify.'),
  ('Canara Bank', '2026-09-09', 5.25, 8.00, NULL, 7.15, 'https://www.canarabank.bank.in/rates-of-interest-for-retail-lending-schemes-linked-to-rllr', '2026-09-09', 'Effective 7.15% for women borrowers, CRG-PRIME grade, loans above Rs 100 lakh; RLLR 8.00% (w.e.f. 12-03-2026). Disclosure page shows 7.15%-10.00%.'),
  ('Union Bank', '2026-09-09', 5.25, 8.00, 8.80, 7.15, 'https://www.unionbankofindia.bank.in/pdf/retail_roi.pdf', '2026-09-09', 'Rate-card floor 7.15% for Government/PSU employees, CIC 750+; EBLR 8.00% minus 0.85%. HTML product page separately claims 8.60%. 1-yr MCLR 8.80%.'),
  ('Tata Capital', '2026-09-09', 5.25, NULL, NULL, NULL, 'https://www.tatacapital.com/home-loan/rates-and-charges.html', '2026-09-09', 'Own pages give three contradictory figures (7.50% / 8.00% / 8.75%). advertised_floor NULL until resolved — no benchmark line or floor check.'),
  ('Godrej Housing', '2026-09-09', 5.25, NULL, NULL, 7.65, 'https://www.godrejcapital.com/home-loan/interest-rate', '2026-09-09', 'HFC. Rate-table floor 7.65% salaried resident/NRI, 7.90% self-employed. Page headline claims 7.60% but is contradicted by its own table.');
