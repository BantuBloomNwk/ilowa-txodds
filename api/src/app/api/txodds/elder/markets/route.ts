/**
 * GET /api/txodds/elder/markets[?limit=6]
 *
 * The Elder's shaped World Cup markets for upcoming fixtures: each fixture with a
 * few markets (result + goals), the live implied probability, and the Elder's read.
 * Powers the "Elder shapes the markets" surface; each shaped market can be seeded
 * on-chain + resolved by the keeper.
 */
import { NextRequest, NextResponse } from 'next/server';
import { worldCupFixtures } from '../../../../../lib/txodds/feed';
import { shapeFixture, type ShapedMarket } from '../../../../../lib/txodds/elder';
import { shapeIndependentMarkets } from '../../../../../lib/txodds/independent-model';
import { shapeForUser, type RiskProfile } from '../../../../../lib/txodds/elder-risk';
import { localizeMarkets } from '../../../../../lib/txodds/elder-localize';
import { describeKind } from '../../../../../lib/txodds/predicate';

// "in their language": route the Elder's prose through Ilowa's translation layer. Env-gated like
// the app's other AI (Aya / Lelapa); ELDER_TRANSLATE_URL is a service that maps
// { texts, targetLang } -> { translations }. Absent or failing -> English (the % still verifies).
const TRANSLATE_URL = process.env.ELDER_TRANSLATE_URL;
const translate = TRANSLATE_URL
  ? async (texts: string[], targetLang: string): Promise<string[]> => {
      const r = await fetch(TRANSLATE_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texts, targetLang }) });
      if (!r.ok) throw new Error('translate ' + r.status);
      return (await r.json()).translations as string[];
    }
  : undefined;

const RISKS: RiskProfile[] = ['careful', 'balanced', 'bold'];

export const runtime = 'nodejs';
export const maxDuration = 60;
// Reads TXODDS_API_TOKEN at runtime; force-dynamic so Next serves a fresh
// (token-bearing) read rather than the static build-time fallback.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const limit = Math.min(Number(sp.get('limit')) || 6, 12);
    // her context: risk profile + per-idea budget + language (all optional)
    const risk: RiskProfile = RISKS.includes(sp.get('risk') as RiskProfile) ? (sp.get('risk') as RiskProfile) : 'balanced';
    const stakeUsdc = Math.max(0, Math.min(Number(sp.get('stake')) || 10, 10000));
    const lang = (sp.get('lang') || 'en').toLowerCase();

    const { live, fixtures } = await worldCupFixtures();
    const now = Date.now();
    const upcoming = fixtures
      .filter((f) => f.startTime > now)
      .sort((a, b) => a.startTime - b.startTime)
      .slice(0, limit);

    const shaped = await Promise.all(upcoming.map(async (f) => {
      const echo = await shapeFixture(f.fixtureId, f.home, f.away);   // reads the market (with provenance)
      // Corners/cards aren't in TxLINE's odds feed at all, so they never come from shapeFixture.
      // Fold in the independent historical model here too, not just at seed time, so the picks
      // surface (and its "not a market echo" provenance line) actually has something to show.
      const model = await shapeIndependentMarkets(f.home, f.away).catch(() => []);
      const modelShaped: ShapedMarket[] = model
        .filter((m) => m.kind === 'corners_over_8_5' || m.kind === 'yellows_over_3_5')
        .map((m) => ({
          kind: m.kind,
          question: `${describeKind(m.kind, f.home, f.away)}?`,
          impliedYes: m.impliedYes,
          analysis: m.analysis,
          source: { book: 'elder-independent-model-v1', impliedPct: Math.round(m.impliedYes * 1000) / 10, fetchedAt: new Date().toISOString(), fixtureId: f.fixtureId },
        }));
      const base = [...echo, ...modelShaped];
      const forYou = shapeForUser(base, { risk, stakeUsdc });          // shapes to her risk profile
      return {
        fixtureId: f.fixtureId,
        home: f.home,
        away: f.away,
        startTime: f.startTime,
        markets: await localizeMarkets(base, lang, translate),         // presented in her language
        shapedForYou: await localizeMarkets(forYou, lang, translate),
      };
    }));

    return NextResponse.json(
      { live, count: shaped.length, profile: { risk, stakeUsdc, lang }, fixtures: shaped },
      { headers: { 'cache-control': 'private, max-age=60' } },
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'elder shaping failed' }, { status: 500 });
  }
}
