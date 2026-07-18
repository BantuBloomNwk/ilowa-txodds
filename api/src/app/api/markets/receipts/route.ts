/**
 * GET /api/markets/receipts — the on-chain settlement signature per resolved World Cup market.
 *
 * Every CLOB market settled via TxLINE has its resolve_market_via_txline transaction
 * signature recorded on txline_markets.resolve_sig, but nothing client-side ever
 * surfaced it, so a resolved market's own settlement proof had no in-app path to reach
 * from the feed. This exposes that public field so the Markets tab can link straight
 * to the Solana Explorer receipt for each settled market.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

function sb() {
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return { url, key, headers: { apikey: key, Authorization: `Bearer ${key}` } };
}

export async function GET() {
  const { url, key, headers } = sb();
  if (!url || !key) return NextResponse.json({ receipts: {}, warning: 'not configured' });

  try {
    const res = await fetch(
      `${url}/rest/v1/txline_markets?status=eq.resolved&scalar_market_id=not.is.null&select=scalar_market_id,resolve_sig,resolved_outcome&limit=2000`,
      { headers, cache: 'no-store' },
    );
    if (!res.ok) return NextResponse.json({ receipts: {}, warning: `supabase ${res.status}` });
    const rows = (await res.json()) as Array<{ scalar_market_id: string; resolve_sig: string | null; resolved_outcome: boolean | null }>;

    const receipts: Record<string, { sig: string; outcome: boolean | null }> = {};
    for (const r of rows) if (r.scalar_market_id && r.resolve_sig) receipts[r.scalar_market_id] = { sig: r.resolve_sig, outcome: r.resolved_outcome };

    return NextResponse.json({ receipts });
  } catch (e) {
    return NextResponse.json({ receipts: {}, warning: (e as Error).message });
  }
}
