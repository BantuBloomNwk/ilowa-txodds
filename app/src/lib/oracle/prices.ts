/**
 * Oracle Price Service
 *
 * Fetches live prices from the hybrid Pyth/Switchboard oracle backend.
 * Falls back to Jupiter Price V3 if the oracle backend is unreachable.
 */

import { getVpsUrl } from '../api-client';
import { getSOLPrice } from '../wallet/jupiter';

export interface OraclePrice {
  pair: string;          // e.g. "SOL/USD"
  price: number;
  confidence: number;
  source: 'switchboard' | 'pyth' | 'jupiter';
  timestamp: number;     // unix seconds
  feedAddress?: string;
}

const SUPPORTED_PAIRS = ['SOL/USD', 'BTC/USD', 'ETH/USD'] as const;
export type OraclePair = typeof SUPPORTED_PAIRS[number];

/**
 * Fetch a single oracle price from the backend.
 */
export async function getOraclePrice(pair: OraclePair): Promise<OraclePrice> {
  const vps = getVpsUrl();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${vps}/api/oracle/price/${encodeURIComponent(pair)}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      return {
        pair,
        price: data.price ?? 0,
        confidence: data.confidence ?? 0,
        source: data.source ?? 'pyth',
        timestamp: data.timestamp ?? Math.floor(Date.now() / 1000),
        feedAddress: data.feed_address,
      };
    }
    throw new Error(`Oracle returned ${res.status}`);
  } catch (err: any) {
    console.warn(`[Oracle] ${pair} fetch failed:`, err?.message);

    // Fallback: use Jupiter for SOL/USD
    if (pair === 'SOL/USD') {
      const solPrice = await getSOLPrice();
      if (solPrice > 0) {
        return {
          pair,
          price: solPrice,
          confidence: 0,
          source: 'jupiter',
          timestamp: Math.floor(Date.now() / 1000),
        };
      }
    }

    throw err;
  }
}

/**
 * Fetch all supported oracle prices in parallel.
 */
export async function getAllOraclePrices(): Promise<OraclePrice[]> {
  const results = await Promise.allSettled(
    SUPPORTED_PAIRS.map(pair => getOraclePrice(pair)),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<OraclePrice> => r.status === 'fulfilled')
    .map(r => r.value);
}

export { SUPPORTED_PAIRS };
