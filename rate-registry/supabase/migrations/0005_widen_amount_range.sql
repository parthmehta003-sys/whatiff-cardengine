-- WhatIff — 0005: widen the accepted loan amount range.
--
-- The original check limited amount_lakh to the 20-150 lakh buckets. Widen it to
-- a broad 2 lakh - 20 crore range (2 - 2000 lakh) so the form can offer the full
-- span of home-loan sizes. The dropdown in app.js supplies the specific buckets;
-- this just relaxes the DB check to the whole range, so future bucket tweaks need
-- no further migration.
--
-- Run any time after 0001 (independent of the fee migrations and the seed).

alter table public.rates drop constraint if exists amt_allowed;
alter table public.rates add  constraint amt_allowed check (amount_lakh between 2 and 2000);
