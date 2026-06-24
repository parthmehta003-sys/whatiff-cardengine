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

  let valueRupees, valueRupeesLow, valueRupeesFloor;

  if (method.valueIsVariable && method.valueRange != null) {
    const [low, high] = method.valueRange;
    valueRupeesFloor = usablePoints * low;
    valueRupees = usablePoints * high;
    valueRupeesLow = valueRupeesFloor;
  } else if (method.valuePerPoint != null) {
    valueRupeesFloor = usablePoints * method.valuePerPoint;
    valueRupees = valueRupeesFloor;
    valueRupeesLow = undefined;
  } else {
    valueRupeesFloor = usablePoints;
    valueRupees = usablePoints;
    valueRupeesLow = undefined;
  }

  return {
    channel: method.channel, usablePoints,
    valueRupeesFloor, valueRupees, valueRupeesLow,
    valueIsVariable: method.valueIsVariable, staged, cyclesNeeded,
    best: method.best, worst: method.worst, note: method.note,
  };
}

function optimizeRedemption(redemption, balance) {
  const isCashback =
    redemption.currency === 'cashback' ||
    (redemption.currency === 'cashback-points' && redemption.methods.length === 0);

  if (isCashback) {
    return {
      currency: redemption.currency, currencyName: redemption.currencyName,
      plainSummary: redemption.plainSummary, isCashback: true, best: null, all: [],
    };
  }

  const all = redemption.methods
    .map((m) => evalMethod(m, balance))
    .sort((a, b) => b.valueRupeesFloor - a.valueRupeesFloor);

  return {
    currency: redemption.currency, currencyName: redemption.currencyName,
    plainSummary: redemption.plainSummary, isCashback: false, best: all[0] ?? null, all,
  };
}

// ── fixtures ─────────────────────────────────────────────────────────────────

// HDFC Infinia Metal (CC31) — 5 channels, one variable (airline transfer)
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

describe('Infinia at 10,000 points — SmartBuy is best (floor 10k > transfer floor 5k)', () => {
  const result = optimizeRedemption(infiniaRedemption, 10_000);
  assert(result.isCashback === false, 'not cashback');
  assert(result.best !== null, 'has a best method');
  // SmartBuy floor: 10,000 × 1.0 = ₹10,000
  // Airline floor:  10,000 × 0.5 = ₹5,000  ← lower, sorts behind SmartBuy
  assert(result.best.channel === 'SmartBuy — flights & hotels', 'SmartBuy is best at 10k');
  assert(result.best.valueRupeesFloor === 10_000, `SmartBuy floor = ₹10,000 (got ${result.best.valueRupeesFloor})`);
  assert(result.best.valueRupees === 10_000, `SmartBuy ceiling = ₹10,000 (fixed, got ${result.best.valueRupees})`);

  // Airline transfer is still present and carries its full range as upside
  const airline = result.all.find(m => m.channel === 'Airline / hotel transfer');
  assert(airline !== undefined, 'airline transfer still in list');
  assert(airline.valueRupeesFloor === 5_000,  `airline floor = ₹5,000 (got ${airline.valueRupeesFloor})`);
  assert(airline.valueRupees === 20_000,       `airline upside = ₹20,000 (got ${airline.valueRupees})`);
  assert(airline.valueRupeesLow === 5_000,     `airline valueRupeesLow = ₹5,000 (got ${airline.valueRupeesLow})`);
  assert(airline.staged === false, 'airline not staged at 10k (cap 150k)');
});

describe('Infinia at 100,000 points — SmartBuy still best (floor 100k > transfer floor 50k)', () => {
  const result = optimizeRedemption(infiniaRedemption, 100_000);
  // SmartBuy floor: 100,000 × 1.0 = ₹100,000 (cap 150k, usable = 100k)
  // Airline floor:  100,000 × 0.5 = ₹50,000  (cap 150k, usable = 100k)
  assert(result.best.channel === 'SmartBuy — flights & hotels', 'SmartBuy best at 100k');
  assert(result.best.valueRupeesFloor === 100_000, `SmartBuy floor = ₹100,000 (got ${result.best.valueRupeesFloor})`);
  assert(result.best.staged === false, 'SmartBuy not staged — 100k < 150k cap');

  const airline = result.all.find(m => m.channel === 'Airline / hotel transfer');
  assert(airline.valueRupeesFloor === 50_000,  `airline floor = ₹50,000 (got ${airline.valueRupeesFloor})`);
  assert(airline.valueRupees === 200_000,       `airline upside = ₹200,000 (got ${airline.valueRupees})`);
  assert(airline.staged === false, 'airline not staged at 100k');
});

describe('Infinia at 200,000 points — Apple & Tanishq best (no cap, floor 200k > SmartBuy 150k)', () => {
  const result = optimizeRedemption(infiniaRedemption, 200_000);
  // Apple & Tanishq: no cap, floor = 200k × 1.0 = ₹200,000
  // SmartBuy: cap 150k, usable = 150k, floor = ₹150,000, staged = true
  // Airline: cap 150k, usable = 150k, floor = 150k × 0.5 = ₹75,000, staged = true
  assert(result.best.channel === 'Apple & Tanishq', 'Apple & Tanishq best at 200k (uncapped 1.0)');
  assert(result.best.valueRupeesFloor === 200_000, `Apple floor = ₹200,000 (got ${result.best.valueRupeesFloor})`);
  assert(result.best.staged === false, 'Apple & Tanishq never staged (no cap)');

  const smartbuy = result.all.find(m => m.channel === 'SmartBuy — flights & hotels');
  assert(smartbuy.staged === true, 'SmartBuy staged at 200k');
  assert(smartbuy.cyclesNeeded === 2, `SmartBuy needs 2 cycles (got ${smartbuy.cyclesNeeded})`);
  assert(smartbuy.usablePoints === 150_000, `SmartBuy usable = 150k per cycle (got ${smartbuy.usablePoints})`);
  assert(smartbuy.valueRupeesFloor === 150_000, `SmartBuy floor = ₹150,000 (got ${smartbuy.valueRupeesFloor})`);

  const airline = result.all.find(m => m.channel === 'Airline / hotel transfer');
  assert(airline.staged === true, 'airline staged at 200k');
  assert(airline.cyclesNeeded === 2, `airline needs 2 cycles (got ${airline.cyclesNeeded})`);
  assert(airline.valueRupeesFloor === 75_000,  `airline floor = ₹75,000 (got ${airline.valueRupeesFloor})`);
  assert(airline.valueRupees === 300_000,       `airline upside = ₹300,000 (got ${airline.valueRupees})`);
});

describe('Floor-ranked sort order at 50,000 points', () => {
  const result = optimizeRedemption(infiniaRedemption, 50_000);
  // Expected floor order:
  // SmartBuy:      50k × 1.0 = ₹50,000
  // Apple & Tanishq: 50k × 1.0 = ₹50,000  (tie — order between tied is irrelevant)
  // Airline:       50k × 0.5 = ₹25,000
  // Generic vouchers: 50k × 0.5 = ₹25,000 (tie)
  // Statement cashback: 50k × 0.3 = ₹15,000
  for (let i = 1; i < result.all.length; i++) {
    assert(
      result.all[i - 1].valueRupeesFloor >= result.all[i].valueRupeesFloor,
      `method[${i-1}] floor (${result.all[i-1].valueRupeesFloor}) ≥ method[${i}] floor (${result.all[i].valueRupeesFloor})`,
    );
  }
  // Airline should NOT be best despite high upside (₹100k ceiling vs ₹50k floor)
  assert(result.best.channel !== 'Airline / hotel transfer', 'airline is NOT best at 50k');
  const airline = result.all.find(m => m.channel === 'Airline / hotel transfer');
  assert(airline.valueRupees === 100_000, `airline upside ceiling = ₹100,000 (got ${airline.valueRupees})`);
});

describe('Zero balance — all floors and ceilings are 0', () => {
  const result = optimizeRedemption(infiniaRedemption, 0);
  assert(result.all.every(m => m.valueRupeesFloor === 0), 'all floors zero at balance=0');
  assert(result.all.every(m => m.valueRupees === 0), 'all ceilings zero at balance=0');
  assert(result.best !== null, 'still returns a best method object');
});

// ── summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
