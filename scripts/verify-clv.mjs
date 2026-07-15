// Third-party CLV verification (docs/specs/provable-clv-elder.md §7). Pulls the PUBLIC
// ledger and recomputes mean CLV + Brier + log-loss from the raw rows using math
// reimplemented HERE (not the server's module), then checks it matches what the
// endpoint reported. This is the whole claim: the edge is checkable, not marketed.
//
//   node scripts/verify-clv.mjs [--base https://ilowa-api.fly.dev] [--elder elder-odds-v1]
const args = process.argv.slice(2);
const arg = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const BASE = arg('--base', process.env.CLV_BASE || 'https://ilowa-api.fly.dev');
const ELDER = arg('--elder', '');

// --- metric math, reimplemented independently of the server ---------------------
const clamp01 = (x) => Math.min(1 - 1e-9, Math.max(1e-9, x));
const eligible = (r) => {
  if (r.committed_slot != null && r.close_slot != null) return r.committed_slot < r.close_slot;
  if (r.committed_at && r.close_time) return new Date(r.committed_at) < new Date(r.close_time);
  return false;
};
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

function recompute(rows) {
  const clvs = [], briers = [], lls = [];
  let ineligible = 0, pendingClose = 0, pendingSettle = 0;
  for (const r of rows) {
    if (!eligible(r)) { ineligible++; continue; }
    if (r.close_line == null) { pendingClose++; continue; }
    if (r.settled_outcome == null) { pendingSettle++; continue; }
    const y = r.settled_outcome ? 1 : 0;
    clvs.push(r.p_implied - r.close_line);
    briers.push((r.p_implied - y) ** 2);
    lls.push(y ? -Math.log(clamp01(r.p_implied)) : -Math.log(1 - clamp01(r.p_implied)));
  }
  return { n: clvs.length, meanClv: mean(clvs), brier: mean(briers), logLoss: mean(lls), ineligible, pendingClose, pendingSettle };
}

const near = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 1e-6);
const f = (x) => (x == null ? 'n/a' : x.toFixed(4));

const url = `${BASE}/api/txodds/clv/ledger${ELDER ? `?elderVersion=${ELDER}` : ''}`;
console.log(`\nProvable-CLV verification\n  ledger: ${url}\n`);

const res = await fetch(url);
if (!res.ok) { console.error(`ledger HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); process.exit(2); }
const data = await res.json();
const rows = data.rows || [];
console.log(`  ${data.count ?? rows.length} commitment(s), ${(data.records || []).length} elder_version(s)\n`);

if (!rows.length) {
  console.log('  No commitments yet. The ledger is live; it populates as the Elder seeds markets before');
  console.log('  kickoff, the close cron snapshots the closing line, and the keeper settles each match.');
  console.log('\n  Recompute pipeline verified against 0 rows (nothing to reconcile).');
  process.exit(0);
}

let fail = 0;
// group rows by elder_version and reconcile with the server's per-version records
const byV = new Map();
for (const r of rows) { if (!byV.has(r.elder_version)) byV.set(r.elder_version, []); byV.get(r.elder_version).push(r); }

for (const [ev, vrows] of byV) {
  const mine = recompute(vrows);
  const theirs = (data.records || []).find((x) => x.elder_version === ev) || {};
  console.log(`  [${ev}]  n=${mine.n}  meanCLV=${f(mine.meanClv)}  Brier=${f(mine.brier)}  logLoss=${f(mine.logLoss)}`);
  console.log(`         pending: close=${mine.pendingClose} settle=${mine.pendingSettle}  ineligible(backdated)=${mine.ineligible}`);
  const checks = [
    ['n', mine.n === theirs.n],
    ['meanCLV', near(mine.meanClv, theirs.meanClv)],
    ['Brier', near(mine.brier, theirs.brier)],
    ['logLoss', near(mine.logLoss, theirs.logLoss)],
    ['ineligible', mine.ineligible === theirs.ineligible],
  ];
  for (const [name, okc] of checks) { if (!okc) { fail++; console.log(`         \x1b[31mMISMATCH ${name}\x1b[0m (server=${JSON.stringify(theirs[name === 'meanCLV' ? 'meanClv' : name])})`); } }
  if (checks.every((c) => c[1])) console.log('         \x1b[32m✓ reproduces the server aggregate from raw rows\x1b[0m');

  // spot-check the anti-backdating invariant the server also claims to enforce
  const badElig = vrows.filter((r) => r.eligible && !eligible(r));
  if (badElig.length) { fail++; console.log(`         \x1b[31m${badElig.length} row(s) marked eligible that fail before-close\x1b[0m`); }
  console.log('');
}

console.log(fail ? `\x1b[31m${fail} check(s) failed\x1b[0m` : '\x1b[32mAll aggregates reproduce from public data.\x1b[0m');
process.exit(fail ? 1 : 0);
