/**
 * Discover CLOB-enabled markets. Reads the public clob_markets table directly via
 * the app's anon Supabase client (RLS = public read) — the same pattern as
 * scalar_markets, no api round-trip.
 *
 * Keyed by the FEED id (scalar_markets.id), because the Predict feed rows carry a
 * UUID `id` and no on-chain pubkey. clob_markets stores that id in
 * `scalar_market_id` (migration 083); the Markets surface matches clobMarkets[m.id].
 * Rows without a linked feed id are skipped (they can't be shown until linked).
 */
import { getSupabase } from '../supabase/client';

export interface ClobMarket {
  market_pubkey: string;
  vault: string;
  yes_mint: string;
  no_mint: string;
  collateral_vault: string;
  collateral_mint: string;
  manifest_market: string;
  scalar_market_id?: string | null;
}

let _cache: Record<string, ClobMarket> | null = null;

/** Map of feed market id (scalar_markets.id) -> CLOB mapping. Cached; pass force to refresh. */
export async function fetchClobMarkets(force = false): Promise<Record<string, ClobMarket>> {
  if (_cache && !force) return _cache;
  const sb = getSupabase();
  if (!sb) return {};
  try {
    const { data, error } = await sb.from('clob_markets').select('*');
    if (error || !data) return _cache ?? {};
    const map: Record<string, ClobMarket> = {};
    for (const r of data as ClobMarket[]) if (r.scalar_market_id) map[r.scalar_market_id] = r;
    _cache = map;
    return map;
  } catch {
    return _cache ?? {};
  }
}
