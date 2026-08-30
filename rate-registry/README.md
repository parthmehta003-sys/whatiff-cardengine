# WhatIff — Rate Registry

An anonymous home-loan rate registry. Borrowers add the rate they're actually
paying; everyone sees how theirs compares — as EMIs, a pictograph, and a dot
plot. No login, no signup, no auth of any kind. One static page.

- **Stack:** vanilla HTML/CSS/JS, no framework, no build step.
- **Data:** Supabase (Postgres) via the CDN JS client.
- **Hosting:** Netlify, deployed from GitHub.
- **Analytics:** Plausible (free tier) — visitors → submissions.

Files:

```
rate-registry/
  index.html          page shell
  style.css           design tokens + layout (works down to 360px)
  app.js              all behaviour (landing, form, result)
  config.example.js   copy to config.js with your Supabase values
  .env.example        the two values, documented (for the Netlify build snippet)
  netlify.toml        publish + build-time config.js generation
  supabase/migrations/0001_rate_registry.sql   the whole database
```

---

## 1. Database (Supabase)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and paste the entire contents of
   `supabase/migrations/0001_rate_registry.sql`, then run it.
   (Or, with the Supabase CLI: `supabase db push`.)

That one file creates the `rates` table, enables Row-Level Security, grants the
browser (`anon`) **INSERT only**, and creates the four `security definer` read
functions (`bank_medians`, `cohort_stats`, `total_count`, `headline_gap`) plus
the two anti-abuse triggers.

Grab your credentials from **Project Settings → API**:

- **Project URL** → `SUPABASE_URL`
- **Project API keys → anon / public** → `SUPABASE_ANON_KEY`

The anon key is meant to live in the browser. It is **RLS**, not secrecy, that
keeps raw rows unreadable (see the security note at the bottom).

---

## 2. Run locally

Serve the folder over http (not `file://`, so the module/CDN scripts work):

```bash
cd rate-registry
cp config.example.js config.js       # then edit config.js with your URL + anon key
python3 -m http.server 8000          # or: npx serve .
# open http://localhost:8000
```

---

## 3. Deploy on Netlify (from GitHub)

1. Push this repo to GitHub.
2. In Netlify: **Add new site → Import an existing project → GitHub**, pick the repo.
3. Set **Base directory** to `rate-registry`. Netlify then reads
   `rate-registry/netlify.toml`.
4. Add two **Environment variables** (Site settings → Environment variables):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
5. Deploy. The build command in `netlify.toml` writes `config.js` from those
   env vars at build time, so nothing secret is committed. (Prefer not to use a
   build step? Delete the `command` line in `netlify.toml`, commit a real
   `config.js`, and remove it from the root `.gitignore`.)

### Analytics

In `index.html`, replace `REPLACE_WITH_YOUR_DOMAIN` with your Netlify domain and
add the site in Plausible. The app fires a `Submission` custom event on every
successful insert — create a **Submission** goal in Plausible and you can read
visitors → submissions from day one. (Umami works the same way; swap the
snippet and call `umami.track('Submission')` in `app.js`.)

---

## 4. Seed before launch

The site launches empty and is built to stay honest when thin: under 10 total
rows it hides the bank list, no median is ever shown from fewer than 4 reports,
and the headline number stays qualitative until there are 40+ rows. Still —
before sharing it anywhere, add 40–50 **real** rates from your own network so
the distribution is worth sharing and the headline number is true. There is no
seed/demo data in the repo by design.

---

## Security note — the anon role cannot read raw rows

This is the property to verify yourself.

- RLS is **enabled** on `public.rates`.
- The `anon` role is granted **INSERT only**. There is no SELECT/UPDATE/DELETE
  grant and no SELECT policy, so raw-row reads are rejected.
- Every read goes through a `security definer` function that returns
  **aggregates** (medians, counts) or the **bare list of rate values** for one
  cohort — never `session_id`, `created_at`, or any way to tie a rate to a person.

Verify on the live site — open the browser console and run:

```js
const c = window.supabase.createClient(WHATIFF_CONFIG.SUPABASE_URL, WHATIFF_CONFIG.SUPABASE_ANON_KEY);
await c.from('rates').select('*');
// -> { data: null, error: { message: 'permission denied for table rates', ... } }
```

If that returns rows, RLS is wrong and every submission is public. It must error.
Inserts and the RPCs still work:

```js
await c.rpc('total_count');     // -> a number
await c.rpc('bank_medians');    // -> [{ bank, median_rate, n }, ...]
```
