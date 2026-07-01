/**
 * Maps a World Cup market "kind" to the exact txoracle validate_stat predicate
 * that defines its YES outcome. Soccer stat keys (full time, period 5):
 * 1 = home (Participant1) goals, 2 = away goals. The predicate is computed once
 * at bind time and stored, so the keeper can never substitute a different one.
 */
export type MarketKind = 'home_win' | 'away_win' | 'over_1_5' | 'over_2_5' | 'over_3_5' | 'under_2_5';

export interface Predicate {
  stat_key_a: number;
  stat_key_b: number | null;
  op: 'add' | 'subtract' | null;
  comparison: 'greaterThan' | 'lessThan' | 'equalTo';
  threshold: number;
  period: number;
}

const FT = 5, HOME = 1, AWAY = 2;

export function buildPredicate(kind: MarketKind): Predicate | null {
  switch (kind) {
    case 'home_win': return { stat_key_a: HOME, stat_key_b: AWAY, op: 'subtract', comparison: 'greaterThan', threshold: 0, period: FT };
    case 'away_win': return { stat_key_a: AWAY, stat_key_b: HOME, op: 'subtract', comparison: 'greaterThan', threshold: 0, period: FT };
    case 'over_1_5': return { stat_key_a: HOME, stat_key_b: AWAY, op: 'add', comparison: 'greaterThan', threshold: 1, period: FT };
    case 'over_2_5': return { stat_key_a: HOME, stat_key_b: AWAY, op: 'add', comparison: 'greaterThan', threshold: 2, period: FT };
    case 'over_3_5': return { stat_key_a: HOME, stat_key_b: AWAY, op: 'add', comparison: 'greaterThan', threshold: 3, period: FT };
    case 'under_2_5': return { stat_key_a: HOME, stat_key_b: AWAY, op: 'add', comparison: 'lessThan', threshold: 3, period: FT };
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
    default: return String(kind);
  }
}

/** Expected YES/NO from final goals — for display + a sanity check against the
 *  on-chain validate_stat result. The on-chain proof is the source of truth. */
export function evaluate(kind: MarketKind, homeGoals: number, awayGoals: number): boolean {
  const total = homeGoals + awayGoals;
  switch (kind) {
    case 'home_win': return homeGoals > awayGoals;
    case 'away_win': return awayGoals > homeGoals;
    case 'over_1_5': return total > 1;
    case 'over_2_5': return total > 2;
    case 'over_3_5': return total > 3;
    case 'under_2_5': return total < 3;
    default: return false;
  }
}
