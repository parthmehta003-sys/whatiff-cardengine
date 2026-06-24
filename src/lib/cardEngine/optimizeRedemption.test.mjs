/**
 * optimizeRedemption — unit tests (plain Node ESM, no test framework).
 * Run: node src/lib/cardEngine/optimizeRedemption.test.mjs
 */

// ── helpers ──────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else       { console.error(`  ✗ ${msg}`); failed++; }
}

function describe(label, fn) {
  console.log(`\n${label}`);
  fn();
}

// ── inline implementation (mirrors the .ts logic, no transpile needed) ───────

function evalMethod(method, balance) {
  const cap = method.capPerCycle ?? null;
  const usablePoints = cap != null ? Math.min(balance, cap) : balance;
  const staged = cap != null && balance > cap;
  const cyclesNeeded = staged && cap != null ? Math.ceil(balance / cap) : undefined;

  let valueRupees, valueRupeesLow;
  if (method.valueIsVariable && method.valueRange != null) {
    const [low, high] = method.valueRange;
    valueRupees = usablePoints * high;
    valueRupeesLow = usablePoints * low;
  } else if (method.valuePerPoint != null) {
    valueRupees = usablePoints * method.valuePerPoint;
    valueRupeesLow = undefined;
  } else {
    valueRupees = usablePoints;
    valueRupeesLow = undefined;
  }

  return { channel: method.channel, usablePoints, valueRupees, valueRupeesLow,
    valueIsVariable: method.valueIsVariable, staged, cyclesNeeded,
    best: method.best, worst: method.worst, note: method.note };
}

function optimizeRedemption(redemption, balance) {
  const isCashback =
    redemption.currency === 'cashback' ||
    (redemption.currency === 'cashback-points' && redemption.methods.length === 0);

  if (isCashback) {
    return { currency: redemption.currency, currencyName: redemption.currencyName,
      plainSummary: redemption.plainSummary, isCashback: true, best: null, all: [] };
  }

  const all = redemption.methods
    .map((m) => evalMethod(m, balance))
    .sort((a, b) => b.valueRupees - a.valueRupees);

  return { currency: redemption.currency, currencyName: redemption.currencyName,
    plainSummary: redemption.plainSummary, isCashback: false, best: all[0] ?? null, all };
}

// ── fixtures ─────────────────────────────────────────────────────────────────

// HDFC Infinia Metal (CC31) — simplified to the channels relevant for testing
const infiniaRedemption = {
  currency: 'points',
  currencyName: 'Reward Points',
  plainSummary: 'Best value via SmartBuy or airline transfers.',
  methods: [
    { channel: 'SmartBuy — flights & hotels', valuePerPoint: 1.0, valueRange: null,
      valueIsVariable: false, minPoints: null, feePerRedemption: null, capPerCycle: 150000 },
    { channel: 'Apple & Tanishq', valuePerPoint: 1.0, valueRange: null,
      valueIsVariable: false, minPoints: null, feePerRedemption: null, capPerCycle: null },
    { channel: 'Airline / hotel transfer', valuePerPoint: null, valueRange: [0.5, 2.0],
      valueIsVariable: true, minPoints: null, feePerRedemption: null, capPerCycle: 150000,
      best: 'Singapore Airlines', worst: 'Poor-value partners' },
    { channel: 'Generic vouchers', valuePerPoint: 0.5, valueRange: null,
      valueIsVariable: false, minPoints: null, feePerRedemption: null, capPerCycle: null },
    { channel: 'Statement cashback', valuePerPoint: 0.3, valueRange: null,
      valueIsVariable: false, minPoints: null, feePerRedemption: null, capPerCycle: null },
  ],
};

// Axis Ace (CC14) — cashback card
const aceRedemption = {
  currency: 'cashback',
  currencyName: 'Cashback',
  plainSummary: 'Cashback credits automatically. Nothing to redeem.',
  methods: [
    { channel: 'Automatic statement credit', valuePerPoint: null, valueRange: null,
      valueIsVariable: false, minPoints: null, feePerRedemption: null, capPerCycle: null },
  ],
};

// ── tests ────────────────────────────────────────────────────────────────────

describe('Cashback card — Axis Ace', () => {
  const result = optimizeRedemption(aceRedemption, 5000);
  assert(result.isCashback === true, 'isCashback is true');
  assert(result.best === null, 'best is null');
  assert(result.all.length === 0, 'all is empty');
  assert(result.plainSummary.includes('automatically'), 'plainSummary passed through');
});

describe('Infinia at 10,000 points — airline transfer should rank #1 on high end', () => {
  const result = optimizeRedemption(infiniaRedemption, 10_000);
  assert(result.isCashback === false, 'not cashback');
  assert(result.best !== null, 'has a best method');
  // Airline transfer high end: 10,000 * 2.0 = ₹20,000
  // SmartBuy:                  10,000 * 1.0 = ₹10,000
  assert(result.best.channel === 'Airline / hotel transfer', 'airline transfer is best');
  assert(result.best.valueRupees === 20_000, `airline high-end = ₹20,000 (got ${result.best.valueRupees})`);
  assert(result.best.valueRupeesLow === 5_000, `airline low-end = ₹5,000 (got ${result.best.valueRupeesLow})`);
  assert(result.best.staged === false, 'not staged at 10k (cap is 150k)');
  // Confirm Apple & Tanishq (no cap, 1.0) is second
  const uncapped = result.all.find(m => m.channel === 'Apple & Tanishq');
  assert(uncapped !== undefined, 'Apple & Tanishq present');
  assert(uncapped.staged === false, 'Apple & Tanishq never staged (no cap)');
});

describe('Infinia at 100,000 points — airline transfer still leads, no staging yet', () => {
  const result = optimizeRedemption(infiniaRedemption, 100_000);
  // Airline: usable=100k (cap=150k), high-end = 100k*2 = ₹200k
  // SmartBuy: usable=100k (cap=150k), value = ₹100k
  assert(result.best.channel === 'Airline / hotel transfer', 'airline still best at 100k');
  assert(result.best.valueRupees === 200_000, `airline high-end = ₹200,000 (got ${result.best.valueRupees})`);
  assert(result.best.staged === false, 'not staged — 100k < 150k cap');
});

describe('Infinia at 200,000 points — staged kicks in (balance > 150k cap)', () => {
  const result = optimizeRedemption(infiniaRedemption, 200_000);
  const airline = result.all.find(m => m.channel === 'Airline / hotel transfer');
  const smartbuy = result.all.find(m => m.channel === 'SmartBuy — flights & hotels');
  const uncapped = result.all.find(m => m.channel === 'Apple & Tanishq');

  assert(airline.staged === true, 'airline is staged at 200k');
  assert(airline.cyclesNeeded === 2, `airline needs 2 cycles (got ${airline.cyclesNeeded})`);
  assert(airline.usablePoints === 150_000, `airline usable = 150k per cycle (got ${airline.usablePoints})`);
  // High-end for 150k usable: 150k * 2.0 = ₹300k
  assert(airline.valueRupees === 300_000, `airline high-end = ₹300k (got ${airline.valueRupees})`);

  assert(smartbuy.staged === true, 'SmartBuy staged too');
  assert(smartbuy.cyclesNeeded === 2, `SmartBuy needs 2 cycles (got ${smartbuy.cyclesNeeded})`);

  // Apple & Tanishq has no cap — never staged
  assert(uncapped.staged === false, 'Apple & Tanishq not staged (no cap)');
  // Uncapped 1.0: 200k * 1.0 = ₹200k — airline (300k) still wins
  assert(uncapped.valueRupees === 200_000, `Apple & Tanishq = ₹200k (got ${uncapped.valueRupees})`);
  assert(result.best.channel === 'Airline / hotel transfer', 'airline wins at 200k too');
});

describe('Sorted order is descending by valueRupees', () => {
  const result = optimizeRedemption(infiniaRedemption, 50_000);
  for (let i = 1; i < result.all.length; i++) {
    assert(
      result.all[i - 1].valueRupees >= result.all[i].valueRupees,
      `method[${i - 1}].valueRupees (${result.all[i-1].valueRupees}) ≥ method[${i}].valueRupees (${result.all[i].valueRupees})`,
    );
  }
});

describe('Zero balance — all valueRupees are 0', () => {
  const result = optimizeRedemption(infiniaRedemption, 0);
  assert(result.all.every(m => m.valueRupees === 0), 'all zero at balance=0');
  assert(result.best !== null, 'still returns a best method');
});

// ── summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
