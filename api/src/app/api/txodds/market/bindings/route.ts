/**
 * GET /api/txodds/market/bindings?scalarMarketId=&status=&fixtureId=
 *
 * Lists market ↔ fixture bindings (for the keeper and for the "settles via TxLINE"
 * UI). No secrets returned.
 */
import { NextRequest, NextResponse } from 'next/server';
import { listBindings } from '../../../../../lib/txodds/txMarkets';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const bindings = await listBindings({
      scalarMarketId: sp.get('scalarMarketId') || undefined,
      status: sp.get('status') || undefined,
      fixtureId: sp.get('fixtureId') ? Number(sp.get('fixtureId')) : undefined,
      marketPubkey: sp.get('marketPubkey') || undefined,
    });
    return NextResponse.json({ count: bindings.length, bindings }, { headers: { 'cache-control': 'no-store' } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'list failed' }, { status: 500 });
  }
}
