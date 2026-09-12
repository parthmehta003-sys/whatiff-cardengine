// Copy this file to `config.js` and fill in your Supabase project values.
//
//   cp config.example.js config.js
//
// Both values are safe to expose in the browser: the anon key is a public,
// publishable key. It is Row-Level Security (see the migration) — NOT secrecy —
// that keeps raw rows unreadable. `config.js` is git-ignored so each deploy
// wires its own project; see the README for injecting these on Netlify.
window.WHATIFF_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT-ref.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-PUBLIC-ANON-KEY',
};
