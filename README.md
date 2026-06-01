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
