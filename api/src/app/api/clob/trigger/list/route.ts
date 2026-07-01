/**
 * GET /api/clob/trigger/list?owner=<wallet>[&market=<market>]
 *
 * Returns a wallet's triggers (armed / fired / failed / revoked) for the UI to
 * show "armed (fires while away)" state and a revoke control. Never returns the
 * raw signed bytes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { listByOwner } from '../../../../../lib/clob/triggers';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const owner = req.nextUrl.searchParams.get('owner');
    const market = req.nextUrl.searchParams.get('market');
    if (!owner) return NextResponse.json({ error: 'owner required' }, { status: 400 });
    let triggers = await listByOwner(owner);
    if (market) triggers = triggers.filter((t) => t.market === market);
    return NextResponse.json({ triggers });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'list failed' }, { status: 500 });
  }
}
