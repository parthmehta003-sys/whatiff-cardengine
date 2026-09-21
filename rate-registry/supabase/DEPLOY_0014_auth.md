# Deploy: 0014 — sign-in to submit (Google + email/password)

Adds an authenticated identity layer so adding a rate requires sign-in (Google or
email+password). **Reading the registry stays open.** Identity is derived
server-side from the login token and is used ONLY for anti-spam / anti-Sybil —
the UI never shows a name or email, and every viewer still sees anonymous
aggregates only.

## Order matters (same discipline as before)

`app.js` now gates submit behind Supabase Auth and calls it as the `authenticated`
role. So do these **in order**:

1. **Run the SQL** — `migrations/0014_auth_identity.sql` in Supabase → SQL Editor.
2. **Configure Auth providers + URLs** (below) in the Supabase dashboard.
3. **Then deploy the frontend** (merge to `main` → Vercel).

If the frontend ships before 1–2, sign-in won't work and submitting will fail.

## 1. SQL

Paste `migrations/0014_auth_identity.sql` into the SQL Editor and Run. It:
- adds `rates.user_id` + a `banned_users` table,
- rewrites `submit_rate` to require `auth.uid()` (rejects anon with `auth_required`)
  and re-keys the supersede / dedupe on the real user,
- re-keys the rate-limit and revocation onto `user_id`,
- **grants every existing anon RPC to `authenticated` too** (logged-in requests
  run as that role; without this, even reading the landing page would break).

It's additive: existing rows keep `user_id = NULL` and are untouched.

## 2. Supabase dashboard config (do this before shipping the frontend)

**A. Email + password** — Authentication → Providers → **Email**: enable.
- "Confirm email": **ON** is better for spam control (verifies the address); the
  frontend handles both — with confirmation ON, new signups see "check your email
  to confirm", with it OFF they're signed in instantly.

**B. Google** — Authentication → Providers → **Google**: enable, then paste a
Google OAuth **Client ID + Secret**:
- In Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID
  (type: Web application).
- **Authorized redirect URI**: `https://<your-project-ref>.supabase.co/auth/v1/callback`
  (Supabase shows this exact value on the Google provider page — copy it).
- Paste the resulting Client ID + Secret into Supabase and save.

**C. URLs** — Authentication → URL Configuration:
- **Site URL** = your Vercel production URL (e.g. `https://whatiff-cardengine.vercel.app`).
- **Additional Redirect URLs**: add the same production URL (and any preview/custom
  domain). The app redirects back to `location.origin + path`, so the exact origin
  must be allow-listed or Google sign-in will bounce.

## 3. Smoke test (after frontend deploys)

1. Logged out: the registry and bank list still load with no prompt (reads open). ✅
2. Fill the form → click submit → the sign-in panel appears.
3. **Google**: "Continue with Google" → consent → returns to the site with the form
   restored → submit succeeds.
4. **Email**: create an account (or sign in) inline → submit succeeds.
5. Confirm no name/email appears anywhere in the result — only anonymous aggregates.

## Notes

- Identity can't be spoofed: `submit_rate` reads `auth.uid()` from the JWT, the
  client never sends a user id.
- The old `session_id` is still stored (analytics/continuity) but no longer the
  anti-abuse key — `user_id` is. Clearing localStorage / incognito no longer
  resets the rate limit or a ban.
- Rollback is low-risk: additive columns/table, and `submit_rate` is the only
  behavior change. Reverting means restoring the 0013 `submit_rate` and dropping
  the new grants; no data is lost.
