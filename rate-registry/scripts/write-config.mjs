/* Writes config.js at build time from environment variables, so the anon key
 * never has to be committed. Both values are public (the anon key is a
 * publishable key; RLS — not secrecy — protects the data). If the env vars are
 * missing, it leaves any existing config.js untouched and exits 0. */
import { writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

if (!URL || !KEY) {
  try { await access(join(ROOT, 'config.js')); console.warn('[write-config] no env vars; keeping existing config.js'); }
  catch { console.warn('[write-config] no env vars and no config.js — the site will show its "not configured" state'); }
} else {
  const body = `window.WHATIFF_CONFIG={SUPABASE_URL:${JSON.stringify(URL)},SUPABASE_ANON_KEY:${JSON.stringify(KEY)}};\n`;
  await writeFile(join(ROOT, 'config.js'), body);
  console.log('[write-config] wrote config.js from environment.');
}
