/**
 * Maps a World Cup market "kind" to the exact txoracle validate_stat predicate that defines its
 * YES outcome. The predicate is computed once at bind time and stored, so the keeper can never
 * substitute a different one (this immutability is the market's provable-fairness guarantee).
 *
 * TxLINE soccer base stat keys (per participant): 1/2 = P1/P2 goals, 3/4 = yellow cards,
 * 5/6 = red cards, 7/8 = corners.
 *
 * TWO DIFFERENT "period" numberings, do not conflate them:
 *  - The `period` field here (the validate_stat predicate) uses FULL = 5 for full time. This is
 *    empirically PROVEN on devnet (fixture 17588325, Jordan 1 / Argentina 3: statKey 1/2 with
 *    period 5 returned the correct full-time result via validate_stat .view()). Keep 5. Note that
 *    the on-chain ScoreStat.period actually passed to validate_stat is taken from the TxLINE
 *    stat-validation proof (settlement.ts), so this field is our record of the period, not the
 *    raw arg.
 *  - The Stats MAP key uses a thousands-prefix (the STAT_MAP_PERIOD legend below): 0 = Total …
 *    7000 = ETTotal (e.g. 7008 = P2 corners in ETTotal). This is a different field from the
 *    validate_stat period arg. Half-specific markets (H1 etc.) would need the correct arg encoding
 *    confirmed on devnet first; we have only proven full time.
 *
 * Only stats in the numeric Stats map are settleable this way. Possession, shots, offsides and VAR
 * arrive as score *events*, not Stats keys, so they are NOT expressible as a validate_stat
 * predicate (good for Elder context/display, not for on-chain settlement).
 */
export type MarketKind =
  | 'home_win' | 'away_win'
  | 'over_1_5' | 'over_2_5' | 'over_3_5' | 'under_2_5'
  | 'corners_over_8_5' | 'corners_over_10_5'
  | 'yellows_over_3_5' | 'red_card';

export interface Predicate {
  stat_key_a: number;
  stat_key_b: number | null;
  op: 'add' | 'subtract' | null;
  comparison: 'greaterThan' | 'lessThan' | 'equalTo';
  threshold: number;
  period: number;
}

// The Stats MAP key thousands-prefix legend (reference; the raw feed uses e.g. 7008 = P2 corners in
// ETTotal). This is NOT the validate_stat predicate period arg, see the header note.
export const STAT_MAP_PERIOD = { TOTAL: 0, H1: 1000, HT: 2000, H2: 3000, ET1: 4000, ET2: 5000, PE: 6000, ET_TOTAL: 7000 } as const;

// base stat keys (per participant); combine with op:'add' for a match total
const P1_GOALS = 1, P2_GOALS = 2, P1_YEL = 3, P2_YEL = 4, P1_RED = 5, P2_RED = 6, P1_COR = 7, P2_COR = 8;
// predicate period for full time; proven on devnet (see header). Keep 5.
const FULL = 5;

export function buildPredicate(kind: MarketKind): Predicate | null {
  switch (kind) {
    case 'home_win': return { stat_key_a: P1_GOALS, stat_key_b: P2_GOALS, op: 'subtract', comparison: 'greaterThan', threshold: 0, period: FULL };
    case 'away_win': return { stat_key_a: P2_GOALS, stat_key_b: P1_GOALS, op: 'subtract', comparison: 'greaterThan', threshold: 0, period: FULL };
    case 'over_1_5': return { stat_key_a: P1_GOALS, stat_key_b: P2_GOALS, op: 'add', comparison: 'greaterThan', threshold: 1, period: FULL };
    case 'over_2_5': return { stat_key_a: P1_GOALS, stat_key_b: P2_GOALS, op: 'add', comparison: 'greaterThan', threshold: 2, period: FULL };
    case 'over_3_5': return { stat_key_a: P1_GOALS, stat_key_b: P2_GOALS, op: 'add', comparison: 'greaterThan', threshold: 3, period: FULL };
    case 'under_2_5': return { stat_key_a: P1_GOALS, stat_key_b: P2_GOALS, op: 'add', comparison: 'lessThan', threshold: 3, period: FULL };
    // precision markets on the numeric Stats map (same validate_stat proof path)
    case 'corners_over_8_5': return { stat_key_a: P1_COR, stat_key_b: P2_COR, op: 'add', comparison: 'greaterThan', threshold: 8, period: FULL };
    case 'corners_over_10_5': return { stat_key_a: P1_COR, stat_key_b: P2_COR, op: 'add', comparison: 'greaterThan', threshold: 10, period: FULL };
    case 'yellows_over_3_5': return { stat_key_a: P1_YEL, stat_key_b: P2_YEL, op: 'add', comparison: 'greaterThan', threshold: 3, period: FULL };
    case 'red_card': return { stat_key_a: P1_RED, stat_key_b: P2_RED, op: 'add', comparison: 'greaterThan', threshold: 0, period: FULL };
    default: return null;
  }
}

export function describeKind(kind: MarketKind, home: string, away: string): string {
  switch (kind) {
    case 'home_win': return `${home} to beat ${away}`;
    case 'away_win': return `${away} to beat ${home}`;
    case 'over_1_5': return 'Over 1.5 total goals';
    case 'over_2_5': return 'Over 2.5 total goals';
    case 'over_3_5': return 'Over 3.5 total goals';
    case 'under_2_5': return 'Under 2.5 total goals';
    case 'corners_over_8_5': return 'Over 8.5 total corners';
    case 'corners_over_10_5': return 'Over 10.5 total corners';
    case 'yellows_over_3_5': return 'Over 3.5 yellow cards';
    case 'red_card': return 'A red card in the match';
    default: return String(kind);
  }
}

/** Apply a stored predicate to two fetched stat values, the same logic validate_stat proves
 *  on-chain. Works for any market (goals, corners, cards). Used for the DB/display outcome; the
 *  on-chain bool remains the source of truth. */
export function evaluatePredicate(
  p: { op: string | null; comparison: string; threshold: number },
  statAValue: number, statBValue: number | null,
): boolean {
  const combined = p.op === 'add' ? statAValue + (statBValue ?? 0)
    : p.op === 'subtract' ? statAValue - (statBValue ?? 0)
    : statAValue;
  if (p.comparison === 'greaterThan') return combined > p.threshold;
  if (p.comparison === 'lessThan') return combined < p.threshold;
  return combined === p.threshold;
}

/** Expected YES/NO from final match stats, for display + a sanity check against the on-chain
 *  validate_stat result. The on-chain proof is the source of truth. */
export function evaluate(kind: MarketKind, s: { homeGoals: number; awayGoals: number; corners?: number; yellows?: number; reds?: number }): boolean {
  const total = s.homeGoals + s.awayGoals;
  switch (kind) {
    case 'home_win': return s.homeGoals > s.awayGoals;
    case 'away_win': return s.awayGoals > s.homeGoals;
    case 'over_1_5': return total > 1;
    case 'over_2_5': return total > 2;
    case 'over_3_5': return total > 3;
    case 'under_2_5': return total < 3;
    case 'corners_over_8_5': return (s.corners ?? 0) > 8;
    case 'corners_over_10_5': return (s.corners ?? 0) > 10;
    case 'yellows_over_3_5': return (s.yellows ?? 0) > 3;
    case 'red_card': return (s.reds ?? 0) > 0;
    default: return false;
  }
}
