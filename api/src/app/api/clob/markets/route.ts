/**
 * GET /api/clob/markets  -> [{ market_pubkey, vault, yes_mint, no_mint,
 *   collateral_vault, collateral_mint, manifest_market }, ...]
 *
 * Public list of CLOB-enabled markets so the app can tell which prediction
 * markets have an order book (and look up the YES mint / Manifest market /
 * collateral to place orders + read the book).
 */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json([], { headers: { 'cache-control': 'no-store' } });
  try {
    const res = await fetch(`${url}/rest/v1/clob_markets?select=*`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return NextResponse.json([]);
    return NextResponse.json(await res.json(), { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json([]);
  }
}
