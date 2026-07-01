/**
 * GET /api/txodds/settlement/:fixtureId
 *
 * The settlement bundle for a World Cup fixture: who won, the goal counts, and the
 * full Merkle-proof payload our resolve_market_via_txline CPI feeds to txoracle's
 * validate_stat. `finished:false` until the match completes and is rooted.
 */
import { NextRequest, NextResponse } from 'next/server';
import { matchResult } from '../../../../../lib/txodds/settlement';

export const runtime = 'nodejs';
// Reads TXODDS_API_TOKEN at runtime; force-dynamic so Next doesn't bake the
// build-time (token-less) result into a static response.
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { fixtureId: string } }) {
  try {
    const fixtureId = Number(params.fixtureId);
    if (!Number.isFinite(fixtureId)) return NextResponse.json({ error: 'bad fixtureId' }, { status: 400 });
    const result = await matchResult(fixtureId);
    return NextResponse.json(result, { headers: { 'cache-control': 'public, max-age=30' } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'settlement failed' }, { status: 500 });
  }
}
