/**
 * The Elder shapes each market to the user's own context and risk profile. This is deliberately
 * DETERMINISTIC: the same inputs always give the same ranking, stake, and reason. That is what
 * makes "shapes the position to your risk profile" both true and provable, the user (or a judge)
 * can see exactly why a market was surfaced and how the stake was chosen. There is no black box.
 *
 * It never fabricates a probability: it only re-weights and sizes the honest implied % the Elder
 * already read from the demargined market (see elder.ts).
 */
import type { ShapedMarket } from './elder';

export type RiskProfile = 'careful' | 'balanced' | 'bold';

export interface UserContext {
  risk: RiskProfile;
  stakeUsdc: number;   // her per-idea budget; suggested stakes are a fraction of this
}

export interface UserShapedMarket extends ShapedMarket {
  fit: string;                 // plain-language reason this matches her profile (auditable)
  fitScore: number;            // 0..1 rank score for her profile (deterministic)
  suggestedStakeUsdc: number;  // her position, sized to profile + confidence
  potentialProfitUsdc: number; // fair net profit if YES lands, at the implied price
}

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Rank score in [0,1] for how well a market fits the profile (higher = better fit). */
function scoreFor(risk: RiskProfile, p: number): number {
  switch (risk) {
    case 'careful': return clamp(p);                    // reward high probability
    case 'bold': return clamp(1 - p);                   // reward upside (longshots)
    case 'balanced': return clamp(1 - Math.abs(p - 0.5) / 0.5); // reward value near a coin-flip
  }
}

/** Suggested position as a fraction of her per-idea budget (deterministic, bounded 0.2..0.75). */
function stakeFractionFor(risk: RiskProfile, p: number): number {
  switch (risk) {
    case 'careful': return clamp(0.25 + 0.35 * clamp((p - 0.5) / 0.5), 0.2, 0.6);  // stake more on safer bets
    case 'bold': return clamp(0.35 + 0.4 * clamp((0.5 - p) / 0.5), 0.2, 0.75);     // stake more on bigger upside
    case 'balanced': return clamp(0.3 + 0.2 * (1 - Math.abs(p - 0.5) / 0.5), 0.2, 0.5);
  }
}

function fitReason(risk: RiskProfile, p: number): string {
  const pct = Math.round(p * 100);
  if (risk === 'careful') return p >= 0.6
    ? `A careful pick: ${pct}% likely, low drama.`
    : `A touch loose for a banker at ${pct}%. Keep the stake small if at all.`;
  if (risk === 'bold') return p <= 0.4
    ? `A bold value shot: only ${pct}% is priced in, so the upside is large if it lands.`
    : `Solid but tame for your profile at ${pct}%. Fine as an anchor.`;
  return `A balanced spot at ${pct}%: real chance, real reward.`;
}

/**
 * Shape the Elder's markets to one user. Only markets with a live price are shaped (no price ->
 * nothing to size). Sorted best-fit first for her profile.
 */
export function shapeForUser(markets: ShapedMarket[], ctx: UserContext): UserShapedMarket[] {
  const budget = Math.max(0, Number(ctx.stakeUsdc) || 0);
  const out: UserShapedMarket[] = [];
  for (const m of markets) {
    const p = m.impliedYes;
    if (p == null || p <= 0 || p >= 1) continue;               // unpriced -> cannot shape honestly
    const stake = round2(budget * stakeFractionFor(ctx.risk, p));
    out.push({
      ...m,
      fitScore: round2(scoreFor(ctx.risk, p)),
      suggestedStakeUsdc: stake,
      potentialProfitUsdc: round2(stake * (1 - p) / p),         // fair net profit if YES hits
      fit: fitReason(ctx.risk, p),
    });
  }
  return out.sort((a, b) => b.fitScore - a.fitScore);
}

/** The single market the Elder would lead with for her, or null if nothing is priced. */
export function topPickForUser(markets: ShapedMarket[], ctx: UserContext): UserShapedMarket | null {
  return shapeForUser(markets, ctx)[0] ?? null;
}
