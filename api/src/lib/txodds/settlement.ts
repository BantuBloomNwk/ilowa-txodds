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

const FINISHED_STATUS = 5; // StatusId 5 = match finished (regulation-time signal only — see below)

export interface ProofNode { hash: number[]; isRightSibling: boolean }
export interface MatchResult {
  fixtureId: number;
  finished: boolean;
  // goals (only when the fetched keys are the goal keys 1/2; null for other stats)
  homeGoals: number | null;
  awayGoals: number | null;
  winner: 'home' | 'away' | 'draw' | null;
  // the raw values of the two fetched stat keys (generic; e.g. corners, cards). null until finished.
  statAValue: number | null;
  statBValue: number | null;
  ts?: number;
  epochDay?: number;
  seq?: number;
  // Everything the resolve CPI / validate_stat needs (null until finished). statA/statB are the
  // proofs for the requested keys, in the order they were requested.
  proof?: {
    ts: number;
    summary: any;
    statA: { statToProve: any; eventStatRoot: any; statProof: ProofNode[] };
    statB: { statToProve: any; eventStatRoot: any; statProof: ProofNode[] } | null;
    fixtureProof: ProofNode[];
    mainTreeProof: ProofNode[];
  };
}
const NOT_FINISHED = (fixtureId: number): MatchResult =>
  ({ fixtureId, finished: false, homeGoals: null, awayGoals: null, winner: null, statAValue: null, statBValue: null });

/**
 * The Seq of the record that represents the DECISIVE final result for a fixture, or null if
 * the match hasn't reached that record yet.
 *
 * TxLine's own team (2026-07-14, TG): "do not use an arbitrary 90-minute or in-play record...
 * fetch score updates/snapshot and select the record where Action = 'game_finalised'." A
 * StatusId===5 ("match finished") record can be the 90-minute result for a knockout match
 * that then goes to ET/penalties — settling home_win/away_win off that record would use the
 * WRONG result. game_finalised is the actual final record regardless of whether the match
 * was decided in regulation, ET, or penalties, so it's the only correct signal to settle on.
 *
 * StatusId===5 is kept only as a sanity fallback for feed shapes where Action might be absent
 * (and logged loudly, since silently falling back to the old buggy behavior would defeat the
 * point of this fix) — never preferred over game_finalised when both are present.
 */
async function finalSeq(fixtureId: number): Promise<number | null> {
  const r = await txGet(`/api/scores/snapshot/${fixtureId}`);
  if (!r.ok) return null;
  const events = await r.json();
  if (!Array.isArray(events)) return null;

  const finalised = events.filter((e: any) => e.Action === 'game_finalised' && typeof e.Seq === 'number');
  if (finalised.length) return Math.max(...finalised.map((e: any) => e.Seq));

  const finished = events.filter((e: any) => e.StatusId === FINISHED_STATUS && typeof e.Seq === 'number');
  if (!finished.length) return null;
  console.warn(
    `[txodds settlement] fixture ${fixtureId}: no game_finalised event found, falling back to ` +
    'StatusId===5 (regulation-time only — WRONG if this match went to ET/penalties). ' +
    'Verify this fixture\'s feed shape against TxLine docs before trusting this settlement.',
  );
  return Math.max(...finished.map((e: any) => e.Seq));
}

const nodes = (a: any[]): ProofNode[] => (a || []).map((n) => ({ hash: n.hash, isRightSibling: n.isRightSibling }));

/**
 * Full match-result proof bundle for a fixture, for TWO arbitrary stat keys (defaults to the goal
 * keys 1/2 so goals markets and the display endpoint are unchanged). Pass the bound market's
 * predicate keys (e.g. 7/8 for corners, 3/4 for yellows, 5/6 for a red card) to settle those
 * markets on the same validate_stat proof path. `finished:false` until the match completes and its
 * scores are rooted on-chain.
 */
export async function matchResult(fixtureId: number, statKeyA = 1, statKeyB: number | null = 2): Promise<MatchResult> {
  if (!hasToken()) return NOT_FINISHED(fixtureId);
  const seq = await finalSeq(fixtureId).catch(() => null);
  if (seq == null) return NOT_FINISHED(fixtureId);

  const q = `fixtureId=${fixtureId}&seq=${seq}&statKey=${statKeyA}` + (statKeyB != null ? `&statKey2=${statKeyB}` : '');
  const vr = await txGet(`/api/scores/stat-validation?${q}`);
  if (!vr.ok) return NOT_FINISHED(fixtureId);
  const v = await vr.json();
  if (!v || v.statToProve == null) return NOT_FINISHED(fixtureId);
  if (statKeyB != null && v.statToProve2 == null) return NOT_FINISHED(fixtureId);

  const statAValue = Number(v.statToProve.value);
  const statBValue = v.statToProve2 != null ? Number(v.statToProve2.value) : null;
  // goal-specific fields only when we actually fetched the goal keys
  const isGoals = statKeyA === 1 && statKeyB === 2;
  const homeGoals = isGoals ? statAValue : null;
  const awayGoals = isGoals ? statBValue : null;
  const winner = isGoals && awayGoals != null
    ? (statAValue > awayGoals ? 'home' : awayGoals > statAValue ? 'away' : 'draw') : null;

  return {
    fixtureId, finished: true, homeGoals, awayGoals, winner, statAValue, statBValue,
    ts: v.ts, epochDay: Math.floor(v.ts / 86400000), seq,
    proof: {
      ts: v.ts,
      summary: {
        fixtureId: v.summary.fixtureId,
        updateStats: v.summary.updateStats,
        eventsSubTreeRoot: v.summary.eventStatsSubTreeRoot,
      },
      statA: { statToProve: v.statToProve, eventStatRoot: v.eventStatRoot, statProof: nodes(v.statProof) },
      statB: v.statToProve2 != null ? { statToProve: v.statToProve2, eventStatRoot: v.eventStatRoot, statProof: nodes(v.statProof2) } : null,
      fixtureProof: nodes(v.subTreeProof),
      mainTreeProof: nodes(v.mainTreeProof),
    },
  };
}
