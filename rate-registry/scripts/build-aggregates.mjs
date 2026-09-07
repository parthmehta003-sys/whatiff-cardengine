/* Static aggregate page generator.
 *
 * Produces a real crawlable URL per bank and per bank-year:
 *   /rates/hdfc-bank/index.html
 *   /rates/hdfc-bank/2023/index.html
 * with the aggregate rendered at BUILD TIME (not injected by JS after a form
 * submit) and Schema.org Dataset markup, so AI assistants and search engines
 * can fetch and cite what borrowers actually got.
 *
 * Run at build time with SUPABASE_URL and SUPABASE_ANON_KEY in the environment.
 * If credentials are missing or the fetch fails, it writes a minimal index and
 * exits 0 so the deploy still succeeds (the registry may simply be empty).
 *
 * Reads go through the same security-definer RPCs the browser uses — this
 * script never touches raw rows either.
 */
import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'rates');
const SITE = process.env.SITE_URL || 'https://example.netlify.app';
const REF_PRINCIPAL = 5000000, REF_YEARS = 20;

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function inr(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }
function emi(P, rate, years) { const r = rate / 1200, n = years * 12, p = Math.pow(1 + r, n); return P * r * p / (p - 1); }

function page({ title, desc, heading, sub, rows, dataset, computedOn }) {
  const table = rows.length ? `
    <table>
      <thead><tr><th>${rows[0].col}</th><th>Achievable (p25)</th><th>Median</th><th>EMI on ₹50L/20yr</th><th>Reports</th></tr></thead>
      <tbody>${rows.map(r => `<tr><td>${esc(r.key)}</td><td>${r.p25.toFixed(2)}%</td><td>${r.median.toFixed(2)}%</td><td>${inr(emi(REF_PRINCIPAL, r.p25, REF_YEARS))}/mo</td><td>${r.n}</td></tr>`).join('')}</tbody>
    </table>` : `<p class="thin">Not enough reports yet to publish an aggregate here.</p>`;

  return `<!doctype html><html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,600;9..40,700;9..40,800&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="/style.css"/>
<style>
  table{width:100%;border-collapse:collapse;margin-top:14px;font-size:14px}
  th,td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line)}
  th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
  td:nth-child(n+2),th:nth-child(n+2){text-align:right}
  .attrib{font-size:12px;color:var(--muted);margin-top:18px;line-height:1.6}
</style>
<script type="application/ld+json">${JSON.stringify(dataset)}</script>
</head><body><div class="wrap">
  <header class="masthead"><div class="logo">WhatIff · Home Loan Registry</div></header>
  <div class="card">
    <div class="section-title">${esc(heading)}</div>
    <div class="section-sub">${esc(sub)}</div>
    ${table}
    <div class="attrib">Source: WhatIff Home Loan Registry — self-reported rates from borrowers, aggregated.
      Figures are the lowest quarter (p25) and median of reported rates, excluding statistical outliers and any cohort with fewer than four reports.
      Computed on ${computedOn}. <a href="/">Add your rate →</a></div>
  </div>
  <div class="foot"><a href="/">whatiff — what's achievable, not just advertised</a></div>
</div></body></html>`;
}

async function main() {
  const computedOn = new Date().toISOString().slice(0, 10);
  await mkdir(OUT, { recursive: true });

  if (!URL || !KEY) {
    console.warn('[build-aggregates] No Supabase creds — writing placeholder index only.');
    await writeFile(join(OUT, 'index.html'), page({
      title: 'Home loan rates by bank — WhatIff', desc: 'What borrowers actually got.',
      heading: 'Home loan rates by bank', sub: 'Aggregates will appear here as borrowers share.',
      rows: [], dataset: {}, computedOn,
    }));
    return;
  }

  const sb = createClient(URL, KEY);
  const { data: banks, error } = await sb.rpc('bank_rates', { p_loan_type: 'Home' });
  if (error) { console.warn('[build-aggregates] fetch failed:', error.message); return; }
  const list = banks || [];

  // Index of all banks.
  const idxRows = list.map(b => ({ col: 'Bank', key: b.bank, p25: Number(b.p25_rate), median: Number(b.median_rate), n: b.n }));
  await writeFile(join(OUT, 'index.html'), page({
    title: 'Home loan rates by bank — what borrowers actually got | WhatIff',
    desc: 'The achievable home-loan rate at each bank, from borrower reports — not the advertised floor.',
    heading: 'Home loan rates by bank', sub: 'The achievable rate (lowest quarter of reports) at each bank.',
    rows: idxRows, computedOn,
    dataset: {
      '@context': 'https://schema.org', '@type': 'Dataset',
      name: 'WhatIff Home Loan Registry — achievable rates by bank',
      description: 'Self-reported home-loan interest rates from Indian borrowers, aggregated to p25 and median per bank.',
      creator: { '@type': 'Organization', name: 'WhatIff' },
      dateModified: computedOn, url: `${SITE}/rates/`,
    },
  }));

  // Per bank, and per bank-year.
  for (const b of list) {
    const s = slug(b.bank);
    const bankRow = [{ col: 'Bank', key: b.bank, p25: Number(b.p25_rate), median: Number(b.median_rate), n: b.n }];

    const { data: years } = await sb.rpc('bank_year_rates', { p_loan_type: 'Home', p_bank: b.bank });
    const yrRows = (years || []).map(y => ({ col: 'Year', key: String(y.loan_year), p25: Number(y.p25_rate), median: Number(y.median_rate), n: y.n }));

    await mkdir(join(OUT, s), { recursive: true });
    await writeFile(join(OUT, s, 'index.html'), page({
      title: `${b.bank} home loan rates — what borrowers actually got | WhatIff`,
      desc: `Achievable ${b.bank} home-loan rate from borrower reports: ${Number(b.p25_rate).toFixed(2)}% (p25), ${Number(b.median_rate).toFixed(2)}% median.`,
      heading: `${b.bank} home loan rates`,
      sub: 'What borrowers actually report paying, by the year they took the loan.',
      rows: yrRows.length ? yrRows : bankRow, computedOn,
      dataset: {
        '@context': 'https://schema.org', '@type': 'Dataset',
        name: `WhatIff — ${b.bank} achievable home-loan rates`,
        description: `Self-reported ${b.bank} home-loan rates, aggregated to p25 and median.`,
        creator: { '@type': 'Organization', name: 'WhatIff' },
        dateModified: computedOn, url: `${SITE}/rates/${s}/`,
      },
    }));

    for (const y of (years || [])) {
      await mkdir(join(OUT, s, String(y.loan_year)), { recursive: true });
      await writeFile(join(OUT, s, String(y.loan_year), 'index.html'), page({
        title: `${b.bank} home loan rates in ${y.loan_year} | WhatIff`,
        desc: `Borrowers who took a ${b.bank} home loan in ${y.loan_year} report ${Number(y.p25_rate).toFixed(2)}% (p25), ${Number(y.median_rate).toFixed(2)}% median.`,
        heading: `${b.bank} home loan rates — ${y.loan_year}`,
        sub: `Reported by borrowers who took a ${b.bank} loan in ${y.loan_year}.`,
        rows: [{ col: 'Year', key: String(y.loan_year), p25: Number(y.p25_rate), median: Number(y.median_rate), n: y.n }],
        computedOn,
        dataset: {
          '@context': 'https://schema.org', '@type': 'Dataset',
          name: `WhatIff — ${b.bank} home-loan rates ${y.loan_year}`,
          description: `Self-reported ${b.bank} home-loan rates for loans taken in ${y.loan_year}.`,
          creator: { '@type': 'Organization', name: 'WhatIff' },
          dateModified: computedOn, url: `${SITE}/rates/${s}/${y.loan_year}/`,
        },
      }));
    }
  }
  console.log(`[build-aggregates] wrote ${list.length} bank pages + year pages.`);
}

main().catch(e => { console.warn('[build-aggregates] non-fatal:', e.message); });
