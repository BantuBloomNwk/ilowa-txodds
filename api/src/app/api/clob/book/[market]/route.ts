/**
 * GET /api/clob/book/:market
 *
 * Decodes a Manifest market's order book server-side (the SDK handles the
 * red-black tree) and returns { bids, asks, mid }. The mid price is the live
 * implied probability of the event. Kept server-side so the app bundle stays
 * web3-only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { Market } from '@cks-systems/manifest-sdk';

export const runtime = 'nodejs';

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

export async function GET(_req: NextRequest, { params }: { params: { market: string } }) {
  try {
    const conn = new Connection(RPC, 'confirmed');
    const m = await Market.loadFromAddress({ connection: conn, address: new PublicKey(params.market) });
    const bids = m.bids().map((o: any) => ({ price: o.tokenPrice, size: o.numBaseTokens }));
    const asks = m.asks().map((o: any) => ({ price: o.tokenPrice, size: o.numBaseTokens }));
    const bestBid = bids.length ? Math.max(...bids.map((b) => b.price)) : null;
    const bestAsk = asks.length ? Math.min(...asks.map((a) => a.price)) : null;
    const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : (bestBid ?? bestAsk);
    return NextResponse.json({ bids, asks, mid });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'book read failed' }, { status: 500 });
  }
}
