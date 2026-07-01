/**
 * TxLINE settlement layer: turn a finished World Cup fixture into the exact
 * Merkle-proof bundle our on-chain resolve_market_via_txline CPI feeds to the
 * txoracle `validate_stat` instruction.
 *
 * PROVEN 2026-06-28 (scripts/.../validate-stat-probe.ts): validate_stat accepts a
 * real devnet proof and returns the correct bool (false predicate returns false,
 * no revert). Goal stat keys: 1 = home (Participant1) goals, 2 = away. period 5 =
 * full time. The proof's daily_scores_roots PDA = ["daily_scores_roots", epochDay u16 LE].
 */
import { txGet, hasToken } from './feed';

const FINISHED_STATUS = 5; // StatusId 5 = match finished

export interface ProofNode { hash: number[]; isRightSibling: boolean }
export interface MatchResult {
  fixtureId: number;
  finished: boolean;
  homeGoals: number | null;
  awayGoals: number | null;
  winner: 'home' | 'away' | 'draw' | null;
  ts?: number;
  epochDay?: number;
  seq?: number;
  // Everything the resolve CPI / validate_stat needs (null until finished):
  proof?: {
    ts: number;
    summary: any;
    statHome: { statToProve: any; eventStatRoot: any; statProof: ProofNode[] };
    statAway: { statToProve: any; eventStatRoot: any; statProof: ProofNode[] };
    fixtureProof: ProofNode[];
    mainTreeProof: ProofNode[];
  };
}

/** The highest-Seq finished event for a fixture, or null if it hasn't finished. */
async function finalSeq(fixtureId: number): Promise<number | null> {
  const r = await txGet(`/api/scores/snapshot/${fixtureId}`);
  if (!r.ok) return null;
  const events = await r.json();
  if (!Array.isArray(events)) return null;
  const finished = events.filter((e: any) => e.StatusId === FINISHED_STATUS && typeof e.Seq === 'number');
  if (!finished.length) return null;
  return Math.max(...finished.map((e: any) => e.Seq));
}

const nodes = (a: any[]): ProofNode[] => (a || []).map((n) => ({ hash: n.hash, isRightSibling: n.isRightSibling }));

/**
 * Full match-result proof bundle for a fixture. `finished:false` (with the rest
 * null) until the match completes and its scores are rooted on-chain.
 */
export async function matchResult(fixtureId: number): Promise<MatchResult> {
  if (!hasToken()) return { fixtureId, finished: false, homeGoals: null, awayGoals: null, winner: null };
  const seq = await finalSeq(fixtureId).catch(() => null);
  if (seq == null) return { fixtureId, finished: false, homeGoals: null, awayGoals: null, winner: null };

  // statKey 1 = home goals, 2 = away goals (full time)
  const vr = await txGet(`/api/scores/stat-validation?fixtureId=${fixtureId}&seq=${seq}&statKey=1&statKey2=2`);
  if (!vr.ok) return { fixtureId, finished: false, homeGoals: null, awayGoals: null, winner: null };
  const v = await vr.json();
  if (!v || v.statToProve == null) return { fixtureId, finished: false, homeGoals: null, awayGoals: null, winner: null };

  const homeGoals = Number(v.statToProve.value);
  const awayGoals = Number(v.statToProve2.value);
  const winner = homeGoals > awayGoals ? 'home' : awayGoals > homeGoals ? 'away' : 'draw';

  return {
    fixtureId, finished: true, homeGoals, awayGoals, winner,
    ts: v.ts, epochDay: Math.floor(v.ts / 86400000), seq,
    proof: {
      ts: v.ts,
      summary: {
        fixtureId: v.summary.fixtureId,
        updateStats: v.summary.updateStats,
        eventsSubTreeRoot: v.summary.eventStatsSubTreeRoot,
      },
      statHome: { statToProve: v.statToProve, eventStatRoot: v.eventStatRoot, statProof: nodes(v.statProof) },
      statAway: { statToProve: v.statToProve2, eventStatRoot: v.eventStatRoot, statProof: nodes(v.statProof2) },
      fixtureProof: nodes(v.subTreeProof),
      mainTreeProof: nodes(v.mainTreeProof),
    },
  };
}
