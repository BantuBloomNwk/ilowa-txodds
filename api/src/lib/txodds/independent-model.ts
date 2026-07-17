/**
 * Independent corners/cards probability model.
 *
 * elder.ts's shapeFixture() reads TxLINE's own ODDS feed (/api/odds/snapshot). That's an
 * echo, not a prediction (see clv.ts ELDER_VERSION comment, docs/specs/provable-clv-elder.md).
 * This module computes a genuinely separate number: each team's historical corners/yellow-card
 * rate across already-FINISHED fixtures, read from TxLINE's STATS feed
 * (/api/scores/stat-validation via settlement.ts's matchResult), a different endpoint that
 * describes what already happened rather than what the odds market currently prices.
 *
 * Historical fixture IDs come from OUR OWN txline_markets table (every fixture we've ever
 * seeded a market for), not TxLINE's worldCupFixtures() snapshot. Empirically confirmed that
 * endpoint only returns the CURRENTLY active/upcoming fixtures for the competition (2 rows,
 * the next two semis), not the tournament's full schedule, so it has no history to filter for.
 * The per-fixture stat endpoints (matchResult) still resolve fine for fixtures that have since
 * dropped out of that live snapshot, confirmed against fixture 18241006 (an already-finished
 * quarterfinal still in our bindings table but no longer in worldCupFixtures()).
 *
 * Used only to seed the Elder's OWN commit for corners/cards markets (seeder.ts). Deliberately
 * NOT read by clv.snapshotCloseLines. TxLINE doesn't quote a corners/cards odds market (only
 * 1X2 and O/U goals, confirmed in elder.ts's parseOdds), so there is no independent market price
 * to benchmark a "close" against for these kinds. Their close_line stays null forever, which the
 * ledger UI already renders honestly (settled outcome shown, no fabricated CLV points chip).
 * See docs/specs/provable-clv-elder.md and ClvTrackRecord.tsx's status logic.
 */
import { listBindings } from './txMarkets';
import { matchResult } from './settlement';
import type { MarketKind } from './predicate';

interface PastFixture { fixtureId: number; home: string; away: string }

interface TeamRate { corFor: number; corAgainst: number; yelFor: number; n: number }

let cache: { at: number; rates: Map<string, TeamRate> } | null = null;
const CACHE_MS = 30 * 60_000; // history changes slowly; refit at most every 30 min
const CONCURRENCY = 8;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

interface FixtureStats { fixture: PastFixture; homeCor: number; awayCor: number; homeYel: number; awayYel: number }

/** Every fixture we've ever seeded a market for, our own record, not TxLINE's live snapshot. */
async function candidateFixtures(): Promise<PastFixture[]> {
  const rows = await listBindings().catch(() => []);
  const byId = new Map<number, PastFixture>();
  for (const r of rows) {
    if (!byId.has(r.fixture_id) && r.home && r.away) {
      byId.set(r.fixture_id, { fixtureId: r.fixture_id, home: r.home, away: r.away });
    }
  }
  return [...byId.values()];
}

async function fetchFixtureStats(f: PastFixture): Promise<FixtureStats | null> {
  const [cor, yel] = await Promise.all([
    matchResult(f.fixtureId, 7, 8).catch(() => null),  // P1/P2 corners
    matchResult(f.fixtureId, 3, 4).catch(() => null),  // P1/P2 yellow cards
  ]);
  // statA/statB are TxLINE's Participant1/Participant2 values. Our bindings table only stores
  // home/away team names, not the per-fixture homeIsP1 flag (feed.ts), and worldCupFixtures()
  // can't backfill it for fixtures that have already aged out of the live snapshot (see module
  // header). Assumes statA=home and statB=away. Every fixture we could directly check (the 2
  // currently live in worldCupFixtures()) has homeIsP1=true, consistent with this feed always
  // listing the home side as Participant1. If that ever isn't true for some historical fixture,
  // that one match's corners get attributed to the wrong side, which adds noise to the rate but
  // doesn't break the model. Worth re-verifying if TxLINE's convention is ever documented.
  if (!cor?.finished || cor.statAValue == null || cor.statBValue == null) return null;
  const homeCor = cor.statAValue, awayCor = cor.statBValue;
  const yelFinished = yel?.finished && yel.statAValue != null && yel.statBValue != null;
  const homeYel = yelFinished ? yel!.statAValue! : 0;
  const awayYel = yelFinished ? yel!.statBValue! : 0;
  return { fixture: f, homeCor, awayCor, homeYel, awayYel };
}

async function fitRates(): Promise<Map<string, TeamRate>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rates;
  const past = await candidateFixtures();
  const results = await mapLimit(past, CONCURRENCY, fetchFixtureStats);

  const rates = new Map<string, TeamRate>();
  const bump = (team: string, corFor: number, corAgainst: number, yelFor: number) => {
    const r = rates.get(team) ?? { corFor: 0, corAgainst: 0, yelFor: 0, n: 0 };
    r.corFor += corFor; r.corAgainst += corAgainst; r.yelFor += yelFor; r.n += 1;
    rates.set(team, r);
  };
  for (const r of results) {
    if (!r) continue;
    bump(r.fixture.home, r.homeCor, r.awayCor, r.homeYel);
    bump(r.fixture.away, r.awayCor, r.homeCor, r.awayYel);
  }
  cache = { at: Date.now(), rates };
  return rates;
}

// Competition-average fallback for a team with no finished-match history yet (e.g. its
// first game), avoids a wild guess off zero samples. Rough soccer norms.
const LEAGUE_AVG_CORNERS = 5.0;
const LEAGUE_AVG_YELLOWS = 2.0;

function rate(rates: Map<string, TeamRate>, team: string, key: 'corFor' | 'corAgainst' | 'yelFor', fallback: number): number {
  const r = rates.get(team);
  return r && r.n > 0 ? r[key] / r.n : fallback;
}

// P(Poisson(lambda) > thresholdExclusive), by direct term-by-term summation of the CDF up to
// and including thresholdExclusive. Thresholds here are small integers (8, 10, 3), so this is
// exact and fast, no need for a regularized-gamma approximation.
function poissonSf(lambda: number, thresholdExclusive: number): number {
  let cdf = 0, term = Math.exp(-lambda);
  for (let k = 0; k <= thresholdExclusive; k++) {
    cdf += term;
    term *= lambda / (k + 1);
  }
  return Math.max(0, Math.min(1, 1 - cdf));
}

export interface ModelMarket { kind: MarketKind; impliedYes: number; sampleSize: number; analysis: string }

/** The Elder's OWN corners/cards probabilities for a fixture, from finished-match history,
 *  independent of TxLINE's own odds feed (elder.ts's shapeFixture reads that separately). */
export async function shapeIndependentMarkets(home: string, away: string): Promise<ModelMarket[]> {
  const rates = await fitRates();
  const n = Math.min(rates.get(home)?.n ?? 0, rates.get(away)?.n ?? 0);

  const homeCorFor = rate(rates, home, 'corFor', LEAGUE_AVG_CORNERS);
  const homeCorAgainst = rate(rates, home, 'corAgainst', LEAGUE_AVG_CORNERS);
  const awayCorFor = rate(rates, away, 'corFor', LEAGUE_AVG_CORNERS);
  const awayCorAgainst = rate(rates, away, 'corAgainst', LEAGUE_AVG_CORNERS);
  // Expected total corners blends each side's own attacking rate with the opponent's rate of
  // conceding corners, the same attack/defense strength idea used for goals models.
  const totalCorLambda = (homeCorFor + awayCorAgainst) / 2 + (awayCorFor + homeCorAgainst) / 2;

  const totalYelLambda = rate(rates, home, 'yelFor', LEAGUE_AVG_YELLOWS) + rate(rates, away, 'yelFor', LEAGUE_AVG_YELLOWS);

  const corProb85 = poissonSf(totalCorLambda, 8);
  const corProb105 = poissonSf(totalCorLambda, 10);
  const yelProb35 = poissonSf(totalYelLambda, 3);

  const src = n > 0 ? `history over ${n} finished match${n === 1 ? '' : 'es'}` : 'competition averages (no finished matches yet for one side)';
  return [
    { kind: 'corners_over_8_5', impliedYes: corProb85, sampleSize: n,
      analysis: `Elder's own model (${src}): ${home} and ${away} project ${totalCorLambda.toFixed(1)} combined corners, over 8.5 at ${Math.round(corProb85 * 100)}%.` },
    { kind: 'corners_over_10_5', impliedYes: corProb105, sampleSize: n,
      analysis: `Elder's own model (${src}): over 10.5 corners at ${Math.round(corProb105 * 100)}%.` },
    { kind: 'yellows_over_3_5', impliedYes: yelProb35, sampleSize: n,
      analysis: `Elder's own model (${src}): ${home} and ${away} project ${totalYelLambda.toFixed(1)} combined yellows, over 3.5 at ${Math.round(yelProb35 * 100)}%.` },
  ];
}
