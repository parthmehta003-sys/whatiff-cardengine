-- Reference benchmarks — populated from a web-search pass on 2026-09-07, each
-- figure read from the institution's own official page (URLs in source_url) or
-- RBI for the repo rate. RUN THIS AFTER 0001_rate_registry.sql, in the Supabase
-- SQL editor.
--
-- SPOT-CHECK BEFORE RELYING ON IT: open each source_url and confirm the number.
-- Two things flagged from the fetch:
--   * ICICI rllr = 8.95 looks inconsistent (repo + 3.70% vs peers ~+2.5%) and
--     contradicts ICICI's own 7.50% advertised floor. Re-verify; the app uses
--     advertised_floor for display and for the exclusion floor, so a wrong RLLR
--     here does no harm, but fix it if you keep RLLR for later analysis.
--   * Several banks (ICICI, Bank of Baroda, Union) advertise home-loan rates
--     BELOW their RLLR — real, because home loans get concessions. RLLR is
--     therefore NOT a hard floor; submit_rate uses min(advertised_floor, rllr).
--
-- Canara Bank and Godrej Housing could not be verified on official pages and are
-- deliberately omitted. Borrowers can still submit rates for them; there's just
-- no benchmark line or floor check until you add verified rows.
--
-- Re-run safely: this clears prior rows for these banks first.

delete from public.benchmarks where bank in (
  'SBI','HDFC Bank','ICICI Bank','Axis Bank','Kotak Mahindra','LIC Housing',
  'Bank of Baroda','PNB Housing','Bajaj Housing','IDFC First','Union Bank','Tata Capital');

insert into public.benchmarks
  (bank, effective_from, repo_rate, rllr, mclr, advertised_floor, source_url, as_of, note) values
  ('SBI', '2025-12-15', 5.25, 7.50, 8.70, NULL, 'https://sbi.bank.in/web/interest-rates/interest-rates', '2026-09-08', 'RLLR = 7.50 + CRP (eff. 15-Dec-2025). EBLR = 7.90 + CRP + BSP. Both are BASES; actual rate = base + credit-risk premium. 1-yr MCLR 8.70%. Advertised home-loan floor not on this page — get it from the Home Loan product page.'),
  ('HDFC Bank', '2026-09-07', 5.25, 7.75, NULL, 7.75, 'https://homeloans.hdfc.bank.in/checklist/home-loan-interest-rates', '2026-09-07', 'RLLR is Policy Repo Rate + 2.50%. MCLR not found on official site as of 2026-09-07.'),
  ('ICICI Bank', '2025-12-05', 5.25, 8.95, 8.40, 7.50, 'https://www.icici.bank.in/interest-rates', '2026-09-07', 'I-EBLR is 8.95%. Advertised floor is 7.50%. 1-year MCLR is 8.40%. NOTE: I-EBLR looks high vs peers — re-verify.'),
  ('Axis Bank', '2026-09-07', 5.25, NULL, 8.90, NULL, 'https://www.axisbank.com/retail/loans/car-loan', '2026-09-07', '1-year MCLR is 8.90%. RLLR and advertised floor not found on official site as of 2026-09-07.'),
  ('Kotak Mahindra', '2026-09-07', 5.25, NULL, NULL, 7.60, 'https://www.kotak.bank.in/en/personal-banking/loans/home-loan/interest-rates.html', '2026-09-07', 'Advertised floor is 7.60%. RLLR and MCLR not found on official site as of 2026-09-07.'),
  ('LIC Housing', '2026-09-07', 5.25, NULL, NULL, 8.40, 'https://www.lichousing.com/housing-loan/plot-loan', '2026-09-07', 'HFC; rllr not applicable. LHPLR-linked rates start at 8.40%.'),
  ('Bank of Baroda', '2026-08-12', 5.25, 7.90, 8.75, 7.20, 'https://bankofbaroda.bank.in/interest-rate-and-service-charges/retail-loans-interest-rates', '2026-09-07', 'BRLLR is 7.90%. 1-year MCLR is 8.75%. Advertised floor is 7.20% (BRLLR - 0.70%).'),
  ('PNB Housing', '2026-09-04', 5.25, NULL, NULL, 7.50, 'https://www.pnbhousing.com/home-loan/interest-rates', '2026-09-07', 'HFC; rllr not applicable, floating rates linked to PNBHFR. Advertised floor is 7.50%.'),
  ('Bajaj Housing', '2026-08-01', 5.25, NULL, NULL, 7.25, 'https://www.bajajhousingfinance.in/home-loan-interest-rates', '2026-09-07', 'HFC; rllr not applicable, floating reference rate (BHPLR) is 14.95%. Advertised floor is 7.25%.'),
  ('IDFC First', '2026-09-07', 5.25, NULL, NULL, 7.75, 'https://www.idfcfirst.bank.in/personal-banking/loans/home-loan/home-loan-interest-rates', '2026-09-07', 'Advertised floor is 7.75%. RLLR and MCLR not found on official site as of 2026-09-07.'),
  ('Union Bank', '2026-08-21', 5.25, 8.00, 8.80, 7.15, 'https://www.unionbankofindia.bank.in/en/common/interest-rates-loans-and-advances', '2026-09-07', 'EBLR is 8.00%. 1-year MCLR is 8.80%. Advertised floor is 7.15%.'),
  ('Tata Capital', '2026-08-21', 5.25, NULL, NULL, 8.75, 'https://www.tatacapital.com/blog/loan-for-home/what-are-housing-finance-companies/', '2026-09-07', 'HFC; rllr not applicable. Advertised floor is 8.75%. NOTE: source is a blog, not the rate card — re-verify on the product page.');
