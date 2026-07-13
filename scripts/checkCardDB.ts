/**
 * WhatIff CardEngine — Data Integrity Checker
 *
 * READ-ONLY. Never mutates cardDB.json. Never imported by the engine.
 * Run:  npx tsx scripts/checkCardDB.ts
 * CI:   exits 1 if any ERROR-severity finding exists.
 *
 * Three layers:
 *   L1 Structural  — states that are impossible regardless of issuer terms
 *   L2 Contamination — copy-paste bleed between cards
 *   L3 Self-consistency — the card contradicting itself
 *
 * This checker CANNOT prove a number is correct. Only an issuer document can.
 * It proves the DB is internally coherent and paste-free. That is a different,
 * cheaper, and fully automatable claim.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM shim: this repo is `"type": "module"`, so __dirname is not defined natively.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type EarnRow = {
  cardId: string; ladderId?: string; category: string; rowType: string;
  earnNum: number | null; earnPer: number | null; rewardUnit?: string;
  redemptionRoute?: string; redeemValue: number | null;
  trigger?: string | null; thresholdAmount?: number | null; thresholdPeriod?: string | null;
  stacks?: boolean; excluded?: boolean;
  capAmount?: number | null; capPeriod?: string | null; sharedCapId?: string | null;
  multiplierNote?: string | null; sourceNote?: string | null;
};
type Card = { cardId: string; name: string; bank: string; pros?: any; cons?: any; tips?: any; [k: string]: any };
type LadderRung = {
  cardId: string; ladderId: string; rewardUnit: string; rungName: string;
  valuePerPoint: number | null; route: string; isCommonUseDefault?: boolean;
};
type DB = { cards: Card[]; earnRows: EarnRow[]; ladder: LadderRung[]; [k: string]: any };

type Severity = 'ERROR' | 'WARN' | 'INFO';
type Finding = { check: string; severity: Severity; cardId: string; detail: string };

const findings: Finding[] = [];
const add = (check: string, severity: Severity, cardId: string, detail: string) =>
  findings.push({ check, severity, cardId, detail });

const dbPath = process.argv[2] ?? path.join(__dirname, '..', 'src', 'data', 'cardDB.json');
const db: DB = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const rows = db.earnRows;
const cards = new Map(db.cards.map(c => [c.cardId, c]));
const bankOf = (id: string) => cards.get(id)?.bank ?? '?';

const isEarning = (r: EarnRow) => !r.excluded;
const rateOf = (r: EarnRow): number | null => {
  if (!r.earnNum || !r.earnPer || r.redeemValue == null) return null;
  return (r.earnNum / r.earnPer) * r.redeemValue * 100;
};

// ladderId -> route -> valuePerPoint. The ladder is the SOURCE OF TRUTH for point value.
const ladderIndex = new Map<string, Map<string, number | null>>();
for (const l of db.ladder ?? []) {
  if (!ladderIndex.has(l.ladderId)) ladderIndex.set(l.ladderId, new Map());
  ladderIndex.get(l.ladderId)!.set(l.route, l.valuePerPoint);
}

/* ══════════════════════════════════════════════════════════════════
   LAYER 1 — STRUCTURAL INVARIANTS
   Violations are bugs by definition. No issuer document required.
   ══════════════════════════════════════════════════════════════════ */

// L1.1 — a cap without a period is meaningless; a period without a cap is a ghost
for (const r of rows) {
  const hasAmt = r.capAmount != null && r.capAmount !== 0;
  const hasPer = r.capPeriod != null && r.capPeriod !== '';
  if (hasAmt !== hasPer) {
    add('L1.1 cap/period mismatch', 'ERROR', r.cardId,
      `${r.category}/${r.rowType}: capAmount=${r.capAmount} capPeriod=${r.capPeriod}`);
  }
}

// L1.2 — an earning row must be able to produce a rupee value
for (const r of rows) {
  if (!isEarning(r)) continue;
  if (r.redeemValue == null || r.redeemValue === 0) {
    add('L1.2 unvaluable earn row', 'ERROR', r.cardId,
      `${r.category}/${r.rowType}: redeemValue=${r.redeemValue}`);
  }
  if (r.earnNum == null || r.earnPer == null || r.earnPer === 0) {
    add('L1.2 unvaluable earn row', 'ERROR', r.cardId,
      `${r.category}/${r.rowType}: earnNum=${r.earnNum} earnPer=${r.earnPer}`);
  }
}

// L1.3 — GUARANTEED-ZERO HOLE. If a category has only conditional/threshold rows
// and no base row, it resolves to a hard ₹0 floor. Sometimes correct — but it must
// never happen by accident. This is the CC07/12/13/14/18 floor-rate class.
const byCardCat = new Map<string, Map<string, EarnRow[]>>();
for (const r of rows) {
  if (!byCardCat.has(r.cardId)) byCardCat.set(r.cardId, new Map());
  const m = byCardCat.get(r.cardId)!;
  m.set(r.category, [...(m.get(r.category) ?? []), r]);
}
for (const [cardId, cats] of byCardCat) {
  for (const [cat, rs] of cats) {
    if (rs.some(r => r.excluded)) continue;              // explicit exclusion = intentional
    const types = new Set(rs.map(r => r.rowType));
    if (types.size && !types.has('base')) {
      add('L1.3 guaranteed-zero hole', 'ERROR', cardId,
        `${cat}: only [${[...types].join(',')}] — no base row, so floor = ₹0. ` +
        `Confirm against MITC that ₹0 is genuinely correct, or add the base row.`);
    }
  }
}

// L1.4 — rowType must be one of the three known values
const VALID_ROWTYPES = new Set(['base', 'channel_conditional', 'spend_threshold']);
for (const r of rows) {
  if (!VALID_ROWTYPES.has(r.rowType)) {
    add('L1.4 unknown rowType', 'ERROR', r.cardId, `${r.category}: rowType='${r.rowType}'`);
  }
}

/* ══════════════════════════════════════════════════════════════════
   LAYER 2 — CROSS-CARD CONTAMINATION
   The class of bug that actually happened (CC12 → CC13 Swiggy One).
   ══════════════════════════════════════════════════════════════════ */

// L2.1 — a sharedCapId spanning two cards is ALWAYS a paste error.
// Caps are pooled within a card, never across cards.
const capOwners = new Map<string, Set<string>>();
for (const r of rows) {
  if (!r.sharedCapId) continue;
  if (!capOwners.has(r.sharedCapId)) capOwners.set(r.sharedCapId, new Set());
  capOwners.get(r.sharedCapId)!.add(r.cardId);
}
for (const [capId, owners] of capOwners) {
  if (owners.size > 1) {
    add('L2.1 sharedCapId spans cards', 'ERROR', [...owners].join('+'),
      `sharedCapId='${capId}' appears on ${[...owners].join(', ')} — caps never pool across cards.`);
  }
}

// L2.2 — ORPHAN CAP. A sharedCapId used on exactly one row shares nothing.
// Means either (a) a sibling row is missing, or (b) the field is a leftover paste.
// Bidirectional check per standing rule: absence is as suspicious as presence.
const capCount = new Map<string, number>();
for (const r of rows) if (r.sharedCapId) capCount.set(r.sharedCapId, (capCount.get(r.sharedCapId) ?? 0) + 1);
for (const [capId, n] of capCount) {
  if (n === 1) {
    const r = rows.find(x => x.sharedCapId === capId)!;
    add('L2.2 orphan sharedCapId', 'WARN', r.cardId,
      `${r.category}: sharedCapId='${capId}' used on ONE row only. A shared cap that shares nothing ` +
      `is either a missing sibling row or a stray paste.`);
  }
}

// L2.3 — verbatim prose duplicated across cards. Same-bank duplication can be
// legitimate (shared lounge programme). Cross-bank duplication essentially never is.
const proseIndex = new Map<string, { cardId: string; field: string }[]>();
const proseStrings = (c: Card): [string, string][] => {
  const out: [string, string][] = [];
  for (const f of ['pros', 'cons', 'tips', 'loungeDetail', 'welcomeBenefit', 'milestoneBenefit']) {
    const v = (c as any)[f];
    if (typeof v === 'string' && v.trim().length > 40) out.push([f, v.trim()]);
    else if (Array.isArray(v)) for (const i of v) if (typeof i === 'string' && i.trim().length > 40) out.push([f, i.trim()]);
  }
  return out;
};
for (const c of db.cards) {
  for (const [field, s] of proseStrings(c)) {
    proseIndex.set(s, [...(proseIndex.get(s) ?? []), { cardId: c.cardId, field }]);
  }
}
for (const [s, locs] of proseIndex) {
  const ids = [...new Set(locs.map(l => l.cardId))];
  if (ids.length < 2) continue;
  const banks = [...new Set(ids.map(bankOf))];
  const sev: Severity = banks.length > 1 ? 'ERROR' : 'WARN';
  add('L2.3 duplicate prose', sev, ids.join('+'),
    `${banks.length > 1 ? 'CROSS-BANK' : 'same-bank'} verbatim duplicate across ${ids.join(', ')} ` +
    `(banks: ${banks.join(', ')}): "${s.slice(0, 80)}…"`);
}

// L2.4 — identical sourceNote across different banks (weaker signal, same failure mode)
const noteIndex = new Map<string, Set<string>>();
for (const r of rows) {
  const s = (r.sourceNote ?? '').trim();
  if (s.length < 35) continue;
  if (!noteIndex.has(s)) noteIndex.set(s, new Set());
  noteIndex.get(s)!.add(r.cardId);
}
for (const [s, ids] of noteIndex) {
  if (ids.size < 2) continue;
  const banks = [...new Set([...ids].map(bankOf))];
  if (banks.length > 1) {
    add('L2.4 cross-bank sourceNote', 'WARN', [...ids].join('+'),
      `Identical sourceNote across banks ${banks.join(', ')}: "${s.slice(0, 70)}…"`);
  }
}

/* ══════════════════════════════════════════════════════════════════
   LAYER 3 — SELF-CONSISTENCY
   The card contradicting itself. No external source needed to detect.
   ══════════════════════════════════════════════════════════════════ */

// L3.1 — sourceNote arithmetic vs stored fields.
// Notes routinely state "4 RP/₹200 = 0.7%". If NO percentage in the note matches the
// computed rate, the note and the fields disagree. Per standing rule, whenever a rate
// changes, its sourceNote must be recomputed in the SAME PR — this makes that mechanical.
//
// IMPORTANT: a note may legitimately contain several percentages
// ("10% Scapia Coins = effective 2%"). We flag only when NONE of them match.
const PCT = /(\d+\.?\d*)\s*%/g;
for (const r of rows) {
  if (!isEarning(r)) continue;
  const actual = rateOf(r);
  if (actual == null) continue;
  const note = r.sourceNote ?? '';
  const claimed = [...note.matchAll(PCT)].map(m => parseFloat(m[1])).filter(p => p > 0);
  if (!claimed.length) continue;
  const matches = claimed.some(p => Math.abs(p - actual) <= 0.15 || Math.abs(p - actual) / p <= 0.10);
  if (!matches) {
    add('L3.1 sourceNote contradicts fields', 'ERROR', r.cardId,
      `${r.category}/${r.rowType}: note claims ${claimed.join('%, ')}% but ` +
      `${r.earnNum}/${r.earnPer} × ${r.redeemValue} = ${actual.toFixed(2)}%. ` +
      `Note: "${note.slice(0, 70)}…"`);
  }
}

// L3.2 — UNIFORM-MULTIPLE DETECTOR. The high-signal one.
// If EVERY contradicting row on a card is wrong by the SAME multiple, the fault is
// almost certainly a single systematic field error (usually redeemValue), NOT stale prose.
// In that case the NOTE is more likely right than the NUMBER. Fix the field, not the note.
const contradictionsByCard = new Map<string, number[]>();
for (const r of rows) {
  if (!isEarning(r)) continue;
  const actual = rateOf(r);
  if (actual == null) continue;
  const claimed = [...(r.sourceNote ?? '').matchAll(PCT)].map(m => parseFloat(m[1])).filter(p => p > 0);
  if (!claimed.length) continue;
  if (claimed.some(p => Math.abs(p - actual) <= 0.15 || Math.abs(p - actual) / p <= 0.10)) continue;
  const ratio = actual / claimed[0];
  contradictionsByCard.set(r.cardId, [...(contradictionsByCard.get(r.cardId) ?? []), ratio]);
}
for (const [cardId, ratios] of contradictionsByCard) {
  if (ratios.length < 3) continue;
  const spread = Math.max(...ratios) - Math.min(...ratios);
  if (spread < 0.05) {
    add('L3.2 SYSTEMATIC field error', 'ERROR', cardId,
      `ALL ${ratios.length} contradicting rows are off by the same factor (×${ratios[0].toFixed(2)}). ` +
      `This is one wrong FIELD (likely redeemValue), not ${ratios.length} stale notes. ` +
      `The notes are probably RIGHT and the stored number WRONG. Verify against issuer doc before ` +
      `touching either — and fix the field, not the prose.`);
  }
}

// L3.3 — MISSING CAPS. Real issuers cap. A card with no cap anywhere is
// far more likely to have missing data than a generous bank.
const cardsWithCaps = new Set(rows.filter(r => r.capAmount != null && r.capAmount !== 0).map(r => r.cardId));
for (const c of db.cards) {
  if (!cardsWithCaps.has(c.cardId)) {
    add('L3.3 zero caps on entire card', 'WARN', c.cardId,
      `${c.bank} ${c.name}: no capAmount on ANY row. Real cards almost always cap. ` +
      `Probable missing data — verify against MITC.`);
  }
}

// L3.4 — prose asserts a category the structured data doesn't back.
// Naive keyword match is noisy (prose often says "no fuel rewards"), so this is INFO,
// and negation-adjacent phrasing is suppressed.
const CATS = ['Dining', 'Fuel', 'Grocery', 'Travel', 'Online', 'Utility', 'International'];
const NEG = /(no|not|excluded|excludes|zero|nil|doesn't|does not|no rewards on)\s+\w{0,12}\s?$/i;
for (const c of db.cards) {
  const earned = new Set(rows.filter(r => r.cardId === c.cardId && !r.excluded).map(r => r.category));
  const text = ['pros', 'tips'].map(f => JSON.stringify((c as any)[f] ?? '')).join(' ');
  for (const cat of CATS) {
    const re = new RegExp(`(.{0,25})\\b${cat}\\b`, 'i');
    const m = text.match(re);
    if (!m || earned.has(cat)) continue;
    if (NEG.test(m[1])) continue;                       // "no fuel rewards" — correct, not a bug
    add('L3.4 prose claims unbacked category', 'INFO', c.cardId,
      `prose mentions '${cat}' but no earning row exists. Context: "…${m[1].trim()} ${cat}…"`);
  }
}

/* ─── L3.6 — LADDER DRIFT ────────────────────────────────────────────
   THE HIGHEST-VALUE RULE IN THIS FILE. It is the only check that catches a wrong
   NUMBER rather than a wrong SHAPE.

   `ladder.valuePerPoint` is the SOURCE OF TRUTH for what one point is worth on a
   given redemption route. `earnRow.redeemValue` is a DENORMALIZED COPY of it.
   Nothing in the codebase enforces that they agree — and they have drifted on
   4 cards / 22 rows, including two cards previously marked CLOSED.

   Rule, no exceptions, no issuer carve-outs:
       earnRow.redeemValue  MUST EQUAL  ladder[ladderId][redemptionRoute].valuePerPoint

   Do NOT special-case by issuer. An issuer-keyed heuristic ("HDFC has multi-rung
   ladders, IDFC is flat") would have skipped CC36 — IDFC WOW Black, which has a
   two-rung ladder and was 100% overstated.
   ─────────────────────────────────────────────────────────────────── */
for (const r of rows) {
  if (!isEarning(r) || r.redeemValue == null) continue;
  const lid = r.ladderId, route = r.redemptionRoute;
  if (!lid || !route) continue;

  const rungs = ladderIndex.get(lid);
  if (!rungs) {
    add('L3.6 ladderId not found', 'ERROR', r.cardId,
      `${r.category}/${r.rowType}: ladderId='${lid}' has no rungs defined.`);
    continue;
  }
  if (!rungs.has(route)) {
    add('L3.6 route absent from ladder', 'ERROR', r.cardId,
      `${r.category}/${r.rowType}: redemptionRoute='${route}' is not a route in ladder '${lid}' ` +
      `(ladder defines: ${[...rungs.keys()].join(', ')}). The row redeems via a route its own ` +
      `card does not offer — one side is wrong.`);
    continue;
  }
  const expected = rungs.get(route);
  if (expected == null) continue;                        // handled by L3.7
  if (Math.abs(r.redeemValue - expected) > 1e-9) {
    const dir = r.redeemValue > expected ? 'OVERSTATED' : 'understated';
    const pct = expected > 0 ? ` (${(((r.redeemValue / expected) - 1) * 100).toFixed(0)}% ${dir.toLowerCase()})` : '';
    add('L3.6 LADDER DRIFT', 'ERROR', r.cardId,
      `${r.category}/${r.rowType}: route='${route}' stores redeemValue=${r.redeemValue} but the ` +
      `ladder says that route is worth ${expected}. ${dir}${pct}. ` +
      `The LADDER is authoritative — correct the row, and recompute its sourceNote in the SAME PR.`);
  }
}

// L3.7 — a ladder rung worth zero is not a redemption route, it is missing data.
for (const l of db.ladder ?? []) {
  if (l.valuePerPoint === 0 || l.valuePerPoint == null) {
    add('L3.7 zero/null ladder rung', 'ERROR', l.cardId,
      `ladder '${l.ladderId}' rung '${l.rungName}' (route=${l.route}) has ` +
      `valuePerPoint=${l.valuePerPoint}. A route worth nothing is missing data, not a real route.`);
  }
}

// L3.8 — every ladder must nominate exactly one default route (what the engine uses for base earn).
const defaultsByLadder = new Map<string, number>();
for (const l of db.ladder ?? []) {
  if (l.isCommonUseDefault) defaultsByLadder.set(l.ladderId, (defaultsByLadder.get(l.ladderId) ?? 0) + 1);
}
for (const lid of ladderIndex.keys()) {
  const n = defaultsByLadder.get(lid) ?? 0;
  if (n !== 1) {
    const owner = (db.ladder ?? []).find(l => l.ladderId === lid)?.cardId ?? '?';
    add('L3.8 ladder default route', n === 0 ? 'ERROR' : 'WARN', owner,
      `ladder '${lid}' has ${n} rungs flagged isCommonUseDefault (expected exactly 1). ` +
      `Without exactly one default, base earn has no defined redemption value.`);
  }
}

// L3.5 — redeemValue erosion register.
// NOT a bug. This is the single most commercially important fact in the database:
// where the headline rate and the real guaranteed rate diverge.
const eroded = [...new Set(rows.filter(r => isEarning(r) && r.redeemValue != null && r.redeemValue <= 0.30).map(r => r.cardId))];
if (eroded.length) {
  add('L3.5 redeemValue erosion register', 'INFO', eroded.join(','),
    `${eroded.length}/${db.cards.length} cards have rows at redeemValue ≤ 0.30 — i.e. the advertised ` +
    `headline rate is 2–4× the true guaranteed rate. This is not an error; it is the product. ` +
    `Every one of these should be spot-checked once against an official redemption chart, then surfaced ` +
    `to the user as the gap between headline and real.`);
}

/* ══════════════════════════════════════════════════════════════════
   REPORT
   ══════════════════════════════════════════════════════════════════ */

const ORDER: Severity[] = ['ERROR', 'WARN', 'INFO'];
const counts = Object.fromEntries(ORDER.map(s => [s, findings.filter(f => f.severity === s).length]));

console.log('═'.repeat(78));
console.log('  WhatIff CardDB Integrity Report');
console.log(`  ${db.cards.length} cards · ${rows.length} earn rows · source: ${path.basename(dbPath)}`);
console.log('═'.repeat(78));

for (const sev of ORDER) {
  const group = findings.filter(f => f.severity === sev);
  if (!group.length) continue;
  console.log(`\n${sev}  (${group.length})\n${'─'.repeat(78)}`);
  const byCheck = new Map<string, Finding[]>();
  for (const f of group) byCheck.set(f.check, [...(byCheck.get(f.check) ?? []), f]);
  for (const [check, fs_] of byCheck) {
    console.log(`\n  ▸ ${check}  ×${fs_.length}`);
    for (const f of fs_) console.log(`      [${f.cardId}] ${f.detail}`);
  }
}

console.log('\n' + '═'.repeat(78));
console.log(`  ERROR ${counts.ERROR}   WARN ${counts.WARN}   INFO ${counts.INFO}`);
console.log('═'.repeat(78));
console.log(
  '\n  This checker proves the DB is internally COHERENT and PASTE-FREE.\n' +
  '  It does NOT prove any number is CORRECT. Only an issuer document does that.\n'
);

if (counts.ERROR > 0) process.exit(1);
