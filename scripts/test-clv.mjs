// Unit-tests the Provable-CLV metric math (docs/specs/provable-clv-elder.md) with no
// live services: compiles the pure module with the repo's tsc, then asserts. Proves the
// numbers are reproducible from commitment rows alone.  Run:  node scripts/test-clv.mjs
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = join(ROOT, 'api');
const OUT = '/tmp/clv-test';
const TSC = join(API, 'node_modules/.bin/tsc');
execSync(`${TSC} --skipLibCheck --module es2020 --target es2020 --outDir ${OUT} src/lib/txodds/clv-metrics.ts`,
  { cwd: API, stdio: 'inherit' });

const { isEligible, clv, brier, logLoss, aggregate } = await import(`${OUT}/clv-metrics.js`);

let pass = 0, fail = 0;
const ok = (n, c) => { c ? (pass++, console.log('  \x1b[32mPASS\x1b[0m', n)) : (fail++, console.log('  \x1b[31mFAIL\x1b[0m', n)); };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;

// --- eligibility: the single anti-backdating rule -------------------------------
ok('eligible when committed_slot < close_slot', isEligible({ p_implied: 0.5, close_line: 0.5, settled_outcome: true, committed_slot: 100, close_slot: 200 }));
ok('INELIGIBLE when committed_slot == close_slot', !isEligible({ p_implied: 0.5, close_line: 0.5, settled_outcome: true, committed_slot: 200, close_slot: 200 }));
ok('INELIGIBLE when committed_slot > close_slot (backdated)', !isEligible({ p_implied: 0.5, close_line: 0.5, settled_outcome: true, committed_slot: 300, close_slot: 200 }));
ok('falls back to timestamps when slots absent', isEligible({ p_implied: 0.5, close_line: 0.5, settled_outcome: true, committed_slot: null, close_slot: null, committed_at: '2026-07-01T00:00:00Z', close_time: '2026-07-01T12:00:00Z' }));
ok('INELIGIBLE by timestamp when committed at/after close', !isEligible({ p_implied: 0.5, close_line: 0.5, settled_outcome: true, committed_slot: null, close_slot: null, committed_at: '2026-07-01T12:00:00Z', close_time: '2026-07-01T00:00:00Z' }));

// --- per-prediction metrics -----------------------------------------------------
ok('clv = p - close (beat the line by +0.05)', near(clv(0.60, 0.55), 0.05));
ok('brier perfect call = 0', near(brier(1, true), 0));
ok('brier coin-flip = 0.25', near(brier(0.5, true), 0.25));
ok('logLoss confident-correct < confident-wrong', logLoss(0.9, true) < logLoss(0.1, true));

// --- aggregate: an Elder that ECHOES the line has ~0 CLV by construction ---------
const anchor = { committed_slot: 1, close_slot: 2 };
const echo = [
  { ...anchor, p_implied: 0.60, close_line: 0.60, settled_outcome: true },
  { ...anchor, p_implied: 0.40, close_line: 0.40, settled_outcome: false },
  { ...anchor, p_implied: 0.55, close_line: 0.55, settled_outcome: true },
];
const a1 = aggregate(echo);
ok('echo Elder: n = 3 scored', a1.n === 3);
ok('echo Elder: mean CLV == 0 (the honest zero-edge result)', near(a1.meanClv, 0));
ok('echo Elder: base rate = 2/3', near(a1.baseRate, 2 / 3));

// --- aggregate: an Elder with genuine edge (beat the close, called it right) -----
const edge = [
  { ...anchor, p_implied: 0.65, close_line: 0.58, settled_outcome: true },
  { ...anchor, p_implied: 0.30, close_line: 0.38, settled_outcome: false },
  { ...anchor, p_implied: 0.70, close_line: 0.60, settled_outcome: true },
  { ...anchor, p_implied: 0.45, close_line: 0.50, settled_outcome: false },
];
const a2 = aggregate(edge);
const expectedMeanClv = ((0.65 - 0.58) + (0.30 - 0.38) + (0.70 - 0.60) + (0.45 - 0.50)) / 4;
ok('edge Elder: mean CLV reproduces by hand', near(a2.meanClv, expectedMeanClv));
ok('edge Elder: mean CLV > 0', a2.meanClv > 0);
ok('edge Elder: has a 95% CI (n>=2)', Array.isArray(a2.clvCi95) && a2.clvCi95.length === 2);
ok('edge Elder: better Brier than a coin flip', a2.brier < 0.25);

// --- aggregate honesty: pending + ineligible are counted, not scored ------------
const mixed = [
  { ...anchor, p_implied: 0.6, close_line: 0.55, settled_outcome: true },   // scored
  { ...anchor, p_implied: 0.6, close_line: 0.55, settled_outcome: null },   // pending settle
  { ...anchor, p_implied: 0.6, close_line: null, settled_outcome: null },   // pending close
  { committed_slot: 5, close_slot: 5, p_implied: 0.6, close_line: 0.5, settled_outcome: true }, // ineligible
];
const a3 = aggregate(mixed);
ok('mixed: only the fully-resolved eligible row is scored (n=1)', a3.n === 1);
ok('mixed: pendingSettle counted', a3.pendingSettle === 1);
ok('mixed: pendingClose counted', a3.pendingClose === 1);
ok('mixed: ineligible (committed==close) dropped + counted', a3.ineligible === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
