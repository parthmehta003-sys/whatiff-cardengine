# WhatIff Card Engine — standalone test app

A deterministic credit card recommendation engine. All recommendation numbers come from a tested
calculation layer in `src/lib/cardEngine/`. The UI is in `src/components/cardengine/`. Card data is
`src/data/cardDB.json`.

## Run locally
```
npm install
npm run dev
```

## Run on StackBlitz (no install)
Open: `stackblitz.com/github/YOUR-USERNAME/YOUR-REPO`

## Verify it's the real engine (not regenerated content)
Walk the flow with dining ₹8,000 / online ₹15,000 / grocery ₹25,000.
- HDFC Swiggy (CC12) hack must be "Cashback Verification + Cap Awareness" (5 steps)
- HDFC Regalia Gold (CC20) hack must be "Brand Voucher SmartBuy Stacking"
If those render, the real engine is running.

---

# TruDesk — deal underwriting desk

`trudesk.html` is a separate, self-contained single-page app for underwriting guaranteed-sale
mandates on resale homes and tracking portfolio exposure. No build step and no dependencies —
just open the file in a browser.

- **Underwrite** — live-recalculating deal model: verdict (GO / WATCH / PASS), net margin,
  break-even days, peak capital, a max-guaranteed-price solver, a rent-clock stress table, a
  margin-decay chart, price headroom, and a cost waterfall.
- **Portfolio** — KPI tiles, ageing breakdown, a risk list, and a sortable, editable table with
  CSV export.
- **Assumptions** — global, editable settings (cost of capital, verdict thresholds, breach cost,
  working-capital limit, per-configuration rent/renovation defaults).

All data and assumptions persist to browser `localStorage`. Click **Load sample data** to seed six
example mandates.
