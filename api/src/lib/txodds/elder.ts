/**
 * Elder market shaping: turn the live TxLINE demargined odds into ready-to-trade
 * World Cup markets, each with the Elder's implied probability and a short, human
 * read. The demargined feed (Bookmaker "TXLineStablePriceDemargined") already
 * gives true implied % in the `Pct` field, so the Elder's number is honest.
 *
 * Maps 1:1 to our predicate kinds (predicate.ts) so a shaped market can be seeded
 * on-chain and resolved by the keeper.
 */
import { txGet } from './feed';
import type { MarketKind } from './predicate';

export interface ShapedMarket {
  kind: MarketKind;
  question: string;
  impliedYes: number | null; // 0..1 implied probability of YES, from live odds
  analysis: string;          // the Elder's one-line read
}

interface Probs { home?: number; draw?: number; away?: number; over15?: number; over25?: number; over35?: number; }

const pct = (v: any): number | null => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n / 100 : null;
};

/** Pull full-time implied probabilities from an odds snapshot. */
function parseOdds(odds: any[]): Probs {
  const p: Probs = {};
  for (const e of odds || []) {
    if (e.MarketPeriod) continue; // full game only (period null)
    const names: string[] = e.PriceNames || [], pcts: any[] = e.Pct || [];
    const at = (name: string) => { const i = names.indexOf(name); return i >= 0 ? pct(pcts[i]) ?? undefined : undefined; };
    if (e.SuperOddsType === '1X2_PARTICIPANT_RESULT') {
      p.home = at('part1'); p.draw = at('draw'); p.away = at('part2');
    } else if (e.SuperOddsType === 'OVERUNDER_PARTICIPANT_GOALS') {
      const line = String(e.MarketParameters || '').replace('line=', '');
      if (line === '1.5') p.over15 = at('over');
      else if (line === '2.5') p.over25 = at('over');
      else if (line === '3.5') p.over35 = at('over');
    }
  }
  return p;
}

const band = (prob: number | null) =>
  prob == null ? 'unknown' : prob >= 0.6 ? 'strong' : prob >= 0.45 ? 'slight' : prob >= 0.3 ? 'against' : 'longshot';

function analysis(kind: MarketKind, home: string, away: string, prob: number | null): string {
  const p = prob == null ? null : Math.round(prob * 100);
  const b = band(prob);
  if (kind === 'home_win') return p == null ? `${home} at home, but the market is quiet.`
    : b === 'strong' ? `The market makes ${home} clear favourites at ${p}%. ${away} need something special.`
    : b === 'slight' ? `${home} are edged ahead at ${p}%, but ${away} are live.`
    : `${home} are up against it here, priced at just ${p}%.`;
  if (kind === 'away_win') return p == null ? `${away} on the road; little priced in yet.`
    : b === 'strong' ? `${away} are favoured even away from home at ${p}%.`
    : b === 'slight' ? `${away} carry a real chance on the road at ${p}%.`
    : `${away} are big underdogs at ${p}%. A win here is one for the books.`;
  if (kind === 'over_2_5') return p == null ? `Goals line unsettled.`
    : prob! >= 0.55 ? `The Elder reads goals: over 2.5 is favoured at ${p}%.`
    : prob! <= 0.45 ? `Looks tight at the back: over 2.5 only ${p}%.`
    : `A near coin-flip on goals: over 2.5 at ${p}%.`;
  if (kind === 'over_1_5') return p == null ? `` : `At least two goals looks likely, over 1.5 at ${p}%.`;
  if (kind === 'over_3_5') return p == null ? `` : `A goal glut is the outside bet: over 3.5 at ${p}%.`;
  return '';
}

/** Shape the headline markets for one fixture from its live odds. */
export async function shapeFixture(fixtureId: number, home: string, away: string): Promise<ShapedMarket[]> {
  let probs: Probs = {};
  try { const r = await txGet(`/api/odds/snapshot/${fixtureId}`); if (r.ok) probs = parseOdds(await r.json()); } catch { /* odds may be absent pre-match */ }
  const mk = (kind: MarketKind, question: string, prob: number | null): ShapedMarket => ({ kind, question, impliedYes: prob ?? null, analysis: analysis(kind, home, away, prob ?? null) });
  return [
    mk('home_win', `Will ${home} beat ${away}?`, probs.home ?? null),
    mk('away_win', `Will ${away} beat ${home}?`, probs.away ?? null),
    mk('over_2_5', `Over 2.5 goals in ${home} vs ${away}?`, probs.over25 ?? null),
  ];
}
