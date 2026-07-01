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
import { shapeFixture } from '../../../../../lib/txodds/elder';

export const runtime = 'nodejs';
export const maxDuration = 60;
// Reads TXODDS_API_TOKEN at runtime; force-dynamic so Next serves a fresh
// (token-bearing) read rather than the static build-time fallback.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 6, 12);
    const { live, fixtures } = await worldCupFixtures();
    const now = Date.now();
    const upcoming = fixtures
      .filter((f) => f.startTime > now)
      .sort((a, b) => a.startTime - b.startTime)
      .slice(0, limit);

    const shaped = await Promise.all(upcoming.map(async (f) => ({
      fixtureId: f.fixtureId,
      home: f.home,
      away: f.away,
      startTime: f.startTime,
      markets: await shapeFixture(f.fixtureId, f.home, f.away),
    })));

    return NextResponse.json({ live, count: shaped.length, fixtures: shaped }, { headers: { 'cache-control': 'public, max-age=120' } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'elder shaping failed' }, { status: 500 });
  }
}
