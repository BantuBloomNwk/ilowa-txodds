/**
 * Provable-CLV Elder — the metric math (docs/specs/provable-clv-elder.md §4).
 *
 * Pure functions, no I/O, so a third party can reproduce every number from the
 * public commitment rows alone. This is the whole claim: the edge is checkable,
 * not marketed.
 *
 * CLV says "we beat the price"; calibration (Brier / log-loss) says "our
 * probabilities are honest." Report both — an agent can beat CLV on a biased
 * sample yet be miscalibrated, so neither alone is sufficient.
 */

/** A commitment reduced to the numbers the metrics need. */
export interface ScoredRow {
  p_implied: number;              // Elder implied prob of YES at commit (0..1)
  close_line: number | null;      // de-vigged market implied prob at close (0..1)
  settled_outcome: boolean | null;// realized YES/NO
  committed_slot: number | null;
  close_slot: number | null;
  committed_at?: string | null;
  close_time?: string | null;
}

/**
 * The anti-backdating rule (§3): a commitment counts only if it landed strictly
 * before the market closed. Prefer finalized slots (trustless); fall back to
 * timestamps when slots are absent (server-attested, phase-1 acceptable).
 */
export function isEligible(r: ScoredRow): boolean {
  if (r.committed_slot != null && r.close_slot != null) return r.committed_slot < r.close_slot;
  if (r.committed_at && r.close_time) return new Date(r.committed_at) < new Date(r.close_time);
  return false;
}

const clamp01 = (x: number) => Math.min(1 - 1e-9, Math.max(1e-9, x));

/** CLV in probability space: how much the Elder's price beat the close. */
export const clv = (p_implied: number, close_line: number): number => p_implied - close_line;

/** Brier score for one prediction (lower is better; 0 = perfect, 0.25 = a coin flip). */
export const brier = (p: number, outcome: boolean): number => (p - (outcome ? 1 : 0)) ** 2;

/** Log loss for one prediction (lower is better; punishes confident wrong calls). */
export const logLoss = (p: number, outcome: boolean): number => {
  const q = clamp01(p);
  return outcome ? -Math.log(q) : -Math.log(1 - q);
};

export interface Aggregate {
  n: number;                 // scored, eligible, settled predictions
  meanClv: number | null;    // mean (p_implied - close_line); positive = edge signal
  clvStdErr: number | null;  // std error of the CLV mean (for a rough CI)
  clvCi95: [number, number] | null; // meanClv ± 1.96·stderr
  brier: number | null;      // mean Brier vs outcome
  logLoss: number | null;    // mean log loss vs outcome
  baseRate: number | null;   // realized YES rate (sanity: calibration reference)
  ineligible: number;        // commitments dropped by the before-close rule
  pendingClose: number;      // committed but no close line yet
  pendingSettle: number;     // has close line, not yet settled
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

/**
 * Aggregate a set of commitments into the reportable metrics. Only rows that are
 * eligible (before-close), have a close line, AND have settled contribute to CLV /
 * calibration; the rest are counted separately so the ledger is honest about N.
 */
export function aggregate(rows: ScoredRow[]): Aggregate {
  let ineligible = 0, pendingClose = 0, pendingSettle = 0;
  const clvs: number[] = [], briers: number[] = [], lls: number[] = [];
  const outcomes: number[] = [];

  for (const r of rows) {
    if (!isEligible(r)) { ineligible++; continue; }
    if (r.close_line == null) { pendingClose++; continue; }
    if (r.settled_outcome == null) { pendingSettle++; continue; }
    clvs.push(clv(r.p_implied, r.close_line));
    briers.push(brier(r.p_implied, r.settled_outcome));
    lls.push(logLoss(r.p_implied, r.settled_outcome));
    outcomes.push(r.settled_outcome ? 1 : 0);
  }

  const n = clvs.length;
  const meanClv = mean(clvs);
  let clvStdErr: number | null = null, clvCi95: [number, number] | null = null;
  if (n >= 2 && meanClv != null) {
    const variance = clvs.reduce((s, x) => s + (x - meanClv) ** 2, 0) / (n - 1);
    clvStdErr = Math.sqrt(variance / n);
    clvCi95 = [meanClv - 1.96 * clvStdErr, meanClv + 1.96 * clvStdErr];
  }

  return {
    n, meanClv, clvStdErr, clvCi95,
    brier: mean(briers), logLoss: mean(lls), baseRate: mean(outcomes),
    ineligible, pendingClose, pendingSettle,
  };
}
