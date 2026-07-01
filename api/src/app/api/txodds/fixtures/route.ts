/**
 * GET /api/txodds/fixtures
 *
 * Live World Cup fixtures from the TxLINE devnet feed (competitionId 72), or the
 * simulated set when the feed is unavailable. `live:true` means the numbers came
 * from the real TxODDS API. CORS is added globally by middleware.
 */
import { NextResponse } from 'next/server';
import { worldCupFixtures } from '../../../../lib/txodds/feed';

export const runtime = 'nodejs';
// Read the TxLINE token (TXODDS_API_TOKEN) from the runtime env on every request.
// Without this, Next statically renders the handler at build time, where the secret
// isn't present, and the feed permanently falls back to sim.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { live, fixtures, reason } = await worldCupFixtures();
    return NextResponse.json({ live, count: fixtures.length, reason, fixtures }, { headers: { 'cache-control': 'public, max-age=60' } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'fixtures failed' }, { status: 500 });
  }
}
