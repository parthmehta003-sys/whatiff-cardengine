-- WhatIff reference benchmarks — 28 lenders, verified from each lender's OWN
-- official pages (seven-batch web-search pass, 2026-09-10). Repo 5.25% (RBI,
-- last changed 05-Dec-2025, held Apr & Aug 2026 MPC).
--
-- RUN ORDER: 0001 -> 0002 -> 0003 -> this file. (This uses the fee columns from
-- 0002/0003.) Re-run safe: it clears these lenders' rows first.
--
-- SANITY-CHECK CORRECTIONS applied on load (do not silently "improve" these back):
--  * "Up to X%" fee CEILINGS were NOT stored as typical fees — they'd show a
--    lakh-rupee fee and kill every recommendation. So processing_fee_pct is NULL
--    for Bajaj (7% ceiling), Piramal (5%), Tata (3%), Godrej (2%); and ICICI is
--    0.5% (its rates-page figure), NOT the 2% fee-schedule ceiling.
--  * FLAT conversion fees are stored in conversion_fee_flat (rupees), not as a %:
--    SBI 5000, HDFC ~5000 (0.25% cap 5k), ICICI 3000, Axis ~3000 (tiered),
--    Kotak ~10000 (0.5% cap 10k), Union 10000, LIC 3000.
--  * Conversion fees that are a SWITCH (fixed<->floating) or a % of the RATE
--    DELTA (not the loan) are NULL — they are not the Door-2 rate-reduction fee:
--    Aadhar (3% switch), Sammaan (% of rate delta), Tata (no floating repricing
--    fee published).
--  * advertised_floor = the LOWEST genuinely-advertised rate (house convention):
--    ICICI 7.55 (pre-approved) not 8.50 card floor; Tata 8.00 (lowest of its
--    three live figures) not 8.95. Both noted.
--  * advertised_floor: every lender now has one (LIC Housing 7.13 filled from its
--    rate page; caveat noted on that row). No lender skips the floor check.
-- Repo 5.25% confirmed against RBI's 19-Aug-2026 MPC minutes (held; next MPC
--    05-07 Oct 2026). HDFC's undated T&C PDF implies 6.25% but is stale.
--
-- Fees left NULL fall back to the app's ASSUMPTION estimate (labelled as such).
--
-- 'Indian Bank' stays in the delete list but is NOT re-inserted below: it was
-- removed from the registry, so re-running this seed drops it from the live DB.

delete from public.benchmarks where bank in (
  'SBI','HDFC Bank','ICICI Bank','Axis Bank','Kotak Mahindra','Bank of Baroda',
  'IDFC First','Canara Bank','Union Bank','Punjab National Bank','Bank of India',
  'IDBI Bank','Yes Bank','IndusInd Bank','Federal Bank','Indian Bank',
  'LIC Housing','PNB Housing','Bajaj Housing','Tata Capital','Godrej Housing',
  'Aadhar Housing Finance','Aavas Financiers','Home First Finance','Repco Home Finance',
  'Can Fin Homes','Sammaan Capital','Piramal Finance','Sundaram Home Finance');

insert into public.benchmarks
  (bank, effective_from, repo_rate, rllr, mclr, advertised_floor,
   conversion_fee_pct, conversion_fee_flat, processing_fee_pct, source_url, fee_source_url, as_of, note) values
  ('SBI','2026-04-01',5.25,7.50,8.70,7.25, NULL,5000,NULL,
   'https://sbi.bank.in/web/interest-rates/interest-rates/loan-schemes-interest-rates/home-loans-interest-rates-current','https://homeloans.sbi.bank.in/downloads/Processing-Fee-Card-Rates.pdf','2026-09-10',
   'Rate 7.25% onwards w.e.f. 01.04.2026. RLLR 7.50+CRP; EBLR 7.90+CRP+BSP. PROCESSING RESOLVED from official SBI Home Loan MITC (user-supplied): mostly FLAT — Rs 6500 (25-75L), Rs 10000 (>75L), 0.25% min Rs 1000 (<=25L). Stored flat 6500 (modal 25-75L band, see UPDATE); processing_fee_pct NULL (the prior 0.35% card-rate is superseded by the MITC). CONVERSION: MITC documents only the fixed->floating switch (0.56% of outstanding; "no fixed option now") — the Door-2 floating rate-reduction fee is not in the MITC, so kept the ~Rs 5000 flat from SBI''s fee schedule. Foreclosure NIL (MITC).'),
  ('HDFC Bank','2026-09-10',5.25,NULL,NULL,7.75, 0.005,NULL,0.005,
   'https://homeloans.hdfc.bank.in/ps/home-loans-in-india/interest-rates','https://www.hdfc.com/content/dam/housing-development-finance-corporation/pdf/most-important-terms-and-conditions.pdf','2026-09-10',
   'CONVERSION RESOLVED from official HDFC MITC Sr.13: switch-to-lower-rate on variable loans = 0.50% of principal outstanding, cap Rs 50,000, WHICHEVER LOWER (NOT the flat 5k previously stored; the 0.25%/5k figure is not in the MITC). Cap rarely binds under ~1cr outstanding, so stored as 0.5%. PF (MITC Sr.1 resident housing salaried/SEP): up to 0.50% or Rs 3000 whichever higher. RATE: official T&C confirms special housing = Repo + 2.45-3.30% (standard +3.15-3.70%); advertised_floor kept at freshly-observed 7.75%. The T&C illustrative "8.70-9.55%" bakes in Repo 6.25% but RBI 19-Aug-2026 MPC confirms Repo 5.25%, so that PDF text is stale.'),
  ('ICICI Bank','2026-09-10',5.25,NULL,8.35,7.55, NULL,3000,0.005,
   'https://www.icici.bank.in/personal-banking/loans/home-loan/home-loan-interest-rates','https://www.icici.bank.in/personal-banking/loans/home-loan/service-charges','2026-09-10',
   'advertised_floor 7.55 = pre-approved digital rate; standard rate-card floor 8.50 (till 30.09.2026). Benchmark I-EBLR 8.95 (EBLR, so rllr NULL). Conversion floating-to-floating FLAT Rs 3000+GST. PF 0.5% on rates page (fee schedule ceiling up to 2% NOT used).'),
  ('Axis Bank','2026-09-10',5.25,NULL,NULL,8.00, NULL,3000,0.01,
   'https://www.axis.bank.in/docs/default-source/default-document-library/home-loan-fees-charges.pdf?sfvrsn=454e11d6_7','https://www.axis.bank.in/docs/default-source/default-document-library/home-loan-fees-charges.pdf?sfvrsn=454e11d6_7','2026-09-10',
   'Rate floor 8.00% = Repo 5.25 + Spread 2.75 (CIBIL 751+; carded range 8.00-8.85%), from the official Axis Home Loan Interest Rates page (user screenshot; a 4th doc confirming Repo 5.25). Repo-linked floating, no numeric EBLR published. FEES CONFIRMED from official Axis Home Loan Fees & Charges + Schedule of Charges + Super Saver docs: CONVERSION = Higher-Floating-to-Lower-Floating admin charge, FLAT tiered by outstanding (<=10L 1000; 10-30L 2000; 30.01-75L 3000; >75L 5000) -> stored 3000 (30-75L band, the Door-2 fee). PF up to 1% or Rs 10000 whichever higher (+Rs 5000 upfront). Foreclosure NIL on floating. (Asha HL is higher: Repo+4.65% up = 10.15%+; Fixed HL 14%.)'),
  ('Kotak Mahindra','2026-09-10',5.25,NULL,NULL,7.60, NULL,10000,NULL,
   'https://www.kotak.bank.in/en/personal-banking/loans/home-loan/interest-rates.html','https://www.kotak.bank.in/content/dam/Kotak/gsfcfiles/loan/hf-gsfc.pdf','2026-09-10',
   'Rate 7.60% CONFIRMED (official Home Loan Interest Rates page: "From 7.60%* p.a."). Floating EBLR/repo-linked (hybrid = Repo + spread). FEES from the official Kotak Home Loan GSFC (user-supplied): CONVERSION confirmed = Switch (Floating->Floating, to repo-linked benchmark) 0.5% of POS capped at Rs 10,000 -> stored flat 10000 (the cap binds for any outstanding >~20L, so flat is faithful). PROCESSING corrected: the GSFC gives only "Upto 2%" (a ceiling) + Rs 5000 non-refundable login — no verified typical figure (the prior 0.5%/1% was unsourced), so processing_fee_pct is NULL and Door 3 uses the labelled 0.5% estimate. Prepayment NIL for individual floating loans.'),
  ('Bank of Baroda','2025-12-06',5.25,7.90,8.75,7.25, NULL,NULL,NULL,
   'https://bankofbaroda.bank.in/interest-rate-and-service-charges/retail-loans-interest-rates','https://bankofbaroda.bank.in/loans/home-loan/baroda-home-loan','2026-09-10',
   'Rate "From 7.25%" floating (BRLLR - 0.70; page BRLLR ~7.90-7.95, +0.05% risk premium without credit insurance). PROCESSING RESOLVED from official rates & charges page (w.e.f. 01.04.2025): the "50%"/"25%" render was stripped decimals for 0.50%/0.25% (min 8500; max 15000 <=50L / 25000 >50L) — confirmed. Door 3 is a TAKEOVER, and BoB takeover PF is a FLAT Rs 8,500 -> stored in processing_fee_flat (see UPDATE below), not the capped %. Conversion fee not published.'),
  ('Canara Bank','2026-03-12',5.25,8.00,8.75,7.15, NULL,NULL,0.005,
   'https://www.canarabank.bank.in/pages/rates-of-interest-for-retail-lending-schemes-linked-to-rllr','https://www.canarabank.bank.in/pages/housing-loan','2026-09-10',
   'RATE CONFIRMED from official Canara rate pages (user screenshots): RLLR 8.00% w.e.f. 12.03.2026; Housing Loan range 7.15-10.00%, mean 8.06% (contracted w.e.f. 12.12.2025). Floor 7.15% = RLLR 8.00 - 0.85 (best CRG-PRIME/women concession). PF 0.5% (min 1500 max 10000)+GST from the fee schedule (not shown in these rate tables); festival 50% waiver excluded. Conversion fee not published.'),
  ('Union Bank','2026-07-24',5.25,NULL,8.80,7.15, NULL,NULL,0.005,
   'https://www.unionbankofindia.bank.in/pdf/retail_roi.pdf','https://www.unionbankofindia.bank.in/pdf/service-charges-pertaining-to-domestic-rupee-advances.pdf','2026-09-10',
   'Verified from the official Retail ROI PDF (w.e.f. 24.07.2026, updated 18.08.2026). EBLR 8.00% = Repo 5.25 + Spread 2.75 (a 3rd doc confirming Repo 5.25). Floor 7.15% = EBLR - 0.85 (CIC 825+ salaried, or Govt/PSU 750+); published range 7.15-9.35%, mean 8.25%. CONVERSION CORRECTED to NULL: the Rs 10000(<=50L)/15000(>50L) charge in the ROI PDF is the FLOATING->FIXED switchover fee (borrower moves to fixed at +1%, i.e. pays MORE) — a rate-TYPE switch, NOT the Door-2 floating rate-reduction fee; the ROI PDF publishes no floating-reset fee. PF 0.5% max 15000+GST is from the separate service-charges doc (not in this ROI PDF).'),
  ('Punjab National Bank','2026-09-10',5.25,7.75,8.80,7.20, NULL,NULL,0.0035,
   'https://pnb.bank.in/Retail-Advances-interst-rate-on-advances-linked-to-mclr.html','https://pnb.bank.in/service-charges-related-to-retail-advances.html','2026-09-10',
   'PF CONFIRMED from the official PNB Services Charges page (Housing Loan, Star Campaign 2027 valid 01.10.2025-31.12.2026): 0.35% of loan, Min Rs 2500, Max Rs 15000 (+ Rs 1350 documentation; PNB Max Saver top-up Rs 2500 one-time). Rate 7.20% for CIBIL 800+, >30L (RLLR base 7.75; composite 8.10 w.e.f. 01.07.2026) — the dense rate card screenshot was not machine-readable, so the rate is kept from the prior fetch. Conversion fee not in the retail charges schedule.'),
  ('Bank of India','2026-07-01',5.25,8.10,NULL,7.10, NULL,NULL,0.0035,
   'https://bankofindia.bank.in/documents/20121/28761619/FloatingROIwef01072026.pdf','https://bankofindia.bank.in/documents/20121/28761619/FloatingROIwef01072026.pdf','2026-09-10',
   'CONFIRMED from the official BOI Floating ROI schedule (w.e.f. 01.07.2026, user-supplied). RBLR 8.10% (w.e.f. 01.01.2026, branded RLLR). Star Home Loan floor 7.10% = RBLR 8.10 - BSD 1.00 (Salaried, CIBIL 840+; hard min 7.10%; the 7.10 the site advertises). PF 0.35% of loan, Min Rs 3500 Max Rs 30000 (Star Diamond flat Rs 60000). NOTE: a temporary promo makes PF NIL for CIBIL 725+ and ALL takeovers for 01.07.26-30.09.26 — standard 0.35% stored for durability (promo expiring). No floating-to-floating conversion fee in the schedule (Door 2 -> labelled estimate).'),
  ('IDBI Bank','2025-12-12',5.25,8.15,8.75,7.40, NULL,5000,NULL,
   'https://www.idbi.bank.in/interest-rates.aspx','https://www.idbi.bank.in/pdf/soc/SOC-HOME-LOAN.pdf','2026-09-10',
   'Verified from official IDBI Home Loan rate page + SOC (w.e.f. 01.10.2026, user-supplied). Plain Vanilla Home Loan floor 7.40% (Salaried/SEP 7.40-10.00%). RLLR 8.15. CONVERSION: SOC 7 individual floating-rate conversion administrative cost is FLAT Rs 5000 (the 0.5% entries are fixed<->floating type switches, not the Door-2 rate-reduction) -> stored flat 5000. PROCESSING: fresh-loan PF is FLAT (Rs 10000 <=75L Salaried/SEP, Rs 15000 >75L) so processing_fee_pct NULL; but INWARD BALANCE TRANSFER = NIL and Door 3 IS a BT -> processing_fee_flat 0 (see UPDATE). Foreclosure NIL on floating individuals.'),
  ('Yes Bank','2026-07-01',5.25,NULL,9.90,8.65, 0.005,NULL,0.01,
   'https://www.yes.bank.in/sites/web/content/published/api/v1.1/assets/CONTAAFF46763FBC47088DF4A6653A18A42C/native/lending_rate.pdf','https://www.yes.bank.in/sites/web/content/published/api/v1.1/assets/CONTB09B05DE03A041B1953DF5E0E9C8124B/native/homeloan_pdf.pdf','2026-09-10',
   'Verified from Yes Bank official Home Loan Schedule of Charges (v HL_SOC_Jan 2026) + home-loan product page (user-supplied). Floor 8.65% onwards (from the product page; Yes standard-product floor not separately verified, may differ — Yes is a higher-rate lender so a false below-floor flag is unlikely). External benchmark linked to RBI Repo (no numeric EBLR published). CONVERSION confirmed 0.5%: SOC lists "Higher Floating rate to Lower Floating rate - 0.5% of outstanding" — the Door-2 fee. PF corrected to 1% (product page: 1% of loan or Rs 10000 whichever higher; SOC gives an "up to 1.5%" ceiling, not stored). Foreclosure NIL on floating; login fee Rs 5000.'),
  ('IndusInd Bank','2026-09-10',5.25,NULL,NULL,7.60, 0.005,NULL,0.01,
   'https://www.indusind.bank.in/content/dam/indusind-corporate/Other/soc/SOC.pdf','https://www.indusind.bank.in/content/dam/indusind-corporate/schedule-of-charges/others/Schedule-of-Charges-Home-Loan.pdf','2026-09-10',
   'Verified from official IndusInd Home Loan APR disclosure (Q1 FY27) + Schedule of Charges + Rates-at-a-glance (Jun26). advertised_floor 7.60% = Bank ROI Min (Q1 FY27; avg 8.07%, max 10.00%); quick-glance notes the MAJORITY range is 8.00-15.00% with min cases below. Rate linked to External Benchmark (repo-linked; no numeric EBLR published). CONVERSION confirmed = Repricing 0.50% of POS (min Rs 5000) — the Door-2 rate-reduction fee. PF up to 1% + IMD up to Rs 2500. Foreclosure & part-prepay NIL on floating.'),
  ('Federal Bank','2026-09-07',5.25,NULL,9.00,7.65, NULL,NULL,0.005,
   'https://www.federal.bank.in/retail-loans-interest-rates','https://www.federal.bank.in/documents/d/guest/retail-loan-charges-w-e-f-from-01-04-2026-1','2026-09-10',
   'Verified from the official Federal Interest Rates page + Retail Loan Charges PDF (user-supplied); page shows Present Repo 5.25% (a 6th doc confirming). Repo-linked, no numeric benchmark label. Regular Home Loan: Term Loan from 7.95%, Overdraft from 7.65% (rates for >35L; <35L +1%) -> advertised_floor 7.65% (lowest REGULAR HL rate; the prior 7.35% was actually the distinct Home Loan Plot+Construction variant). PF 0.50% of limit, min Rs 10000 (bundles CIBIL/CERSAI/valuation/legal). CONVERSION corrected to NULL: the 0.25% charge is for switching FIXED<->FLOATING (a rate-TYPE switch), not the Door-2 floating rate-reduction fee, which Federal does not publish. Foreclosure NIL for floating individuals.'),
  ('IDFC First','2026-09-10',5.25,NULL,NULL,7.75, NULL,NULL,NULL,
   'https://www.idfcfirstbank.com/personal-banking/loans/home-loan/home-loan-interest-rates','https://www.idfcfirstbank.com/personal-banking/loans/home-loan/fees-and-charges','2026-09-10',
   'Rate "ROI starting from 7.75%" (official product rates page, user-supplied screenshots 2026-09-10). EBR-linked (External Benchmark Rate), reset every 3 months; no numeric EBR published so rllr NULL. FEES NULL BY DESIGN (both are "up to" ceilings, per house convention): Switch/repricing fee (Door 2) up to 2% of principal outstanding; Processing fee (Door 3) up to 3% of loan amount (IMD/admin Rs 6500 is part of PF). Foreclosure NIL on floating. Both door fees fall back to labelled estimate.'),
  ('LIC Housing','2026-09-10',5.25,NULL,NULL,7.15, NULL,3000,NULL,
   'https://www.lichousing.com/lhplr-for-retail-loans','https://cdn.lichousing.com/2026/01/fees_and_other_charges.pdf','2026-09-10',
   'Verified from LIC HFL Home Loan rate tables (salaried + self-employed, user screenshots) + Fees & Other Charges PDF (updated Jan 2026). advertised_floor 7.15% = salaried, CIBIL >=825, up to Rs 5cr (self-employed floor 7.30%; CIBIL/slab-tiered, LHPLR-based). CONVERSION confirmed = IHL Rewriting/conversion fee FLAT Rs 3000 (the 0.25% entry is floating->fixed, a type switch). PROCESSING is FLAT by slab: Rs 3000 (<=25L), 5000 (25-50L), 7500 (50L-1Cr), 15000 (1-5Cr) -> processing_fee_flat 5000 (modal 25-50L band, see UPDATE); processing_fee_pct NULL. Foreclosure NIL for floating individuals.'),
  ('PNB Housing','2026-09-10',5.25,NULL,NULL,8.50, 0.005,NULL,0.01,
   'https://www.pnbhousing.com/home-loan','https://www.pnbhousing.com/documents/d/guest/know-schedule-of_charges','2026-09-10',
   'PNB Housing Finance (PNBHFL) — NOT Punjab National Bank (separate row). FEES CONFIRMED from the official MITC / Schedule of Charges v31.0.0 (eff 01-Jan-2026): PF 1% of loan +GST (min Rs 10000); CONVERSION = "ROI Change Floating-to-Floating (reduction in rate) 0.5% of POS +GST" — the Door-2 fee (distinct from the 3% fixed-switch). Floating benchmark is PNBRRR (no numeric published). Prepayment NIL for individual floating loans. Rate 8.50% from product heading (homepage says from 8.25; /interest-rates 406, slab table unread).'),
  ('Bajaj Housing','2026-09-10',5.25,NULL,NULL,7.30, NULL,NULL,NULL,
   'https://www.bajajhousingfinance.in/home-loan-interest-rates','https://www.bajajhousingfinance.in/documents/37350/3993180/MITC+-+Retail+(Secured+and+Unsecured)+-+English+(2).pdf','2026-09-10',
   'Verified from Bajaj Housing Home Loan rate page + official MITC & List of Penal/Other Charges (July 2026, user-supplied). Rates (floating): fresh Home Loan from 7.99% salaried / 7.79% self-employed; Home Loan Balance Transfer from 7.30% salaried / 7.55% SE -> advertised_floor 7.30% (lowest advertised; keeps the floor check from flagging legit BT rates). FEES CONFIRMED as CEILINGS ONLY, so NULL (fall back to labelled estimate): Processing "up to 7% of loan"; Switch to Lower Rate (Door 2) "up to 4.5% of POS"; existing-loan product conversion up to 2%. Foreclosure & part-prepay NIL for individual floating home loans.'),
  ('Tata Capital','2026-09-10',5.25,NULL,NULL,8.00, NULL,NULL,NULL,
   'https://www.tatacapital.com/home-loan/interest-rates-and-charges.html','https://www.tatacapital.com/content/dam/tata-capital/tchfl/mitc/hl/TCHFL%20Home%20Loans%20MITC%20v19%20_%20English.pdf','2026-09-10',
   'RATE DISPUTED at source: 8.95 (rates page), 8.00-13% (/home-loan.html, title "at 8%"), NRPLR 10.70 benchmark. Stored 8.00 (lowest advertised). FEES NULL: no floating-to-floating repricing fee published; PF is up to 3% ceiling.'),
  ('Godrej Housing','2026-09-10',5.25,NULL,NULL,7.65, 0.01,NULL,NULL,
   'https://www.godrejcapital.com/home-loan/interest-rate','https://godrejhf.com/information_and_policies/content/ghfl/ghfl-mitc-english-apr-2026.pdf','2026-09-10',
   'Rate 7.65% onwards salaried/NRI (page H1 says 7.60 but its own table says 7.65). Benchmarks are GHF PLRs (no RLLR). Conversion = Repricing 1% POS. PF up to 2% (ceiling) so processing_fee_pct NULL.'),
  ('Aadhar Housing Finance','2024-06-16',5.25,NULL,NULL,11.75, NULL,NULL,NULL,
   'https://aadharhousing.com/ready-reckoner/services-and-charges','https://aadharhousing.com/ready-reckoner/services-and-charges','2026-09-10',
   'Rate 11.75-16.50 salaried. RPLR 17.65 (no RLLR). Conversion is a fixed<->floating Switch 3% (NOT a rate-reduction) so NULL. No row named Processing Fee (admin charges only) so processing_fee_pct NULL.'),
  ('Aavas Financiers','2026-06-01',5.25,NULL,NULL,8.50, 0.02,NULL,0.02,
   'https://www.aavas.in/uploads/pdf/information-booklet-english-60546963.pdf','https://www.aavas.in/img/pdf/Schedule-of-Charges-in-English-01.pdf','2026-09-10',
   'Rate 8.50 onwards. AFL PLR value not published. Conversion 2%+GST (all switch directions). PF 2%+GST on sanctioned. Both fees confirmed in two separate official docs — most internally consistent lender in the set.'),
  ('Home First Finance','2026-01-01',5.25,NULL,NULL,8.00, 0.015,NULL,NULL,
   'https://homefirstindia.com/policy/schedule-of-charges','https://homefirstindia.com/policy/schedule-of-charges','2026-09-10',
   'Rate 8.00-17.50 PROVISIONAL (single read, could not re-confirm — re-verify). HFFC PLR 17.00. Conversion/repricing up to 1.5% POS. Fees are FLAT Login (Rs 2500) so processing_fee_pct NULL.'),
  ('Repco Home Finance','2026-09-10',5.25,NULL,NULL,8.75, NULL,NULL,NULL,
   'https://www.repcohome.com/products/branches',NULL,'2026-09-10',
   'Rate 8.75% LOW CONFIDENCE: from a marketing/branches page, conditions unstated (a stale cache showed 9.15). Re-verify against the official ROI PDF. Fee PDFs URLs could not be obtained (href stripped) so both fees NULL.'),
  ('Can Fin Homes','2026-09-10',5.25,NULL,NULL,8.95, 0.005,NULL,0.005,
   'https://www.canfinhomes.com/pages/interestrates','https://www.canfinhomes.com/downloads/f99e1f47-388d-4aec-a225-69158bd9eb79.pdf','2026-09-10',
   'Rate 8.95-10.10 floating salaried/professional (floor is best internal grade). Can Fin publishes NO benchmark. Conversion = IAC 0.5% of outstanding+GST (rate reduction before quarterly reset). PF 0.5% (min 5000 max 25000) direct channel; DSA/self-employed 0.75-1.25%.'),
  ('Sammaan Capital','2026-09-10',5.25,NULL,NULL,8.75, NULL,NULL,0.005,
   'https://www.sammaancapital.com/home-loan/interest-rate','https://www.sammaancapital.com/home-loan/fees-and-charges','2026-09-10',
   'Formerly Indiabulls Housing. Rate 8.75 onwards. RMLR 12.60 (no RLLR). Conversion is a % of the RATE DELTA (25% onwards of the difference), NOT of the loan — unstorable, so NULL. PF 0.5% onwards (no cap stated).'),
  ('Piramal Finance','2026-09-10',5.25,NULL,NULL,9.99, 0.01,NULL,NULL,
   'https://www.piramalfinance.com/home-loan/home-loan-interest-rates','https://www.piramalfinance.com/schedule-of-charges','2026-09-10',
   'Rate 9.99 onwards (same floor across all slabs). RPLR 20.92 / RFRR 16.65 (no RLLR). Conversion up to 1% POS. PF is up to 5% ceiling (outlier) so processing_fee_pct NULL.'),
  ('Sundaram Home Finance','2026-01-01',5.25,NULL,NULL,10.65, 0.005,NULL,0.0075,
   'https://www.sundaramhome.in/uploads/downloads/Annual_Percentage_rate_on_Loans.pdf','https://www.sundaramhome.in/uploads/downloads/Fee_and_Other_Charges_-_Prime_-_01-01-2026.pdf','2026-09-10',
   'Rate 10.65 onwards salaried (HTML page carries no rates). SH-PLR 17.60 (no RLLR). Conversion = Re-pricing/Switch 0.5% of outstanding+GST. PF up to 0.75%+GST housing.');

-- Flat processing fees — set in the 0004 column so Door 3 uses the real rupee cost
-- of a balance transfer, not a % (which would overstate it). Each is the lender's
-- own published figure for a typical (25-75L) home loan:
--   Bank of Baroda — flat Rs 8,500 takeover (its fresh-loan PF is a capped
--     0.50%/0.25%, not what a transferring borrower pays).
--   SBI — flat Rs 6,500 for 25-75L (Rs 10,000 above 75L; 0.25% min 1000 up to
--     25L), per the official SBI Home Loan MITC.
--   IDBI — Rs 0: its SOC charges NIL processing for an INWARD balance transfer
--     (a fresh loan is a flat Rs 10,000/15,000, but Door 3 is a BT), so a transfer
--     to IDBI carries no processing fee (MOD + legal still apply on top in Door 3).
--   LIC Housing — flat Rs 5,000 for the 25-50L IHL slab (Rs 3000 <=25L, 7500
--     50L-1Cr, 15000 1-5Cr), per the LIC HFL Fees & Charges schedule.
update public.benchmarks set processing_fee_flat = 8500 where bank = 'Bank of Baroda';
update public.benchmarks set processing_fee_flat = 6500 where bank = 'SBI';
update public.benchmarks set processing_fee_flat = 0    where bank = 'IDBI Bank';
update public.benchmarks set processing_fee_flat = 5000 where bank = 'LIC Housing';
