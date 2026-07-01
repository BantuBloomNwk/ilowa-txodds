/**
 * GET /api/cron/clob-keeper   (Bearer CRON_SECRET)
 *
 * One keeper pass for set-and-forget stop / take-profit triggers. Reads each
 * market's mid once, and for every armed trigger whose price has crossed, relays
 * the user's pre-signed durable-nonce order. The keeper signs nothing and holds
 * no authority: it only submits the exact bytes the user already signed.
 *
 * Invoke every ~1-2 min from the scheduler. Stateless and idempotent: a row is
 * claimed atomically (armed -> firing) before submit, so overlapping passes
 * cannot double-fire.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { Market } from '@cks-systems/manifest-sdk';
import {
  listActive, recoverStale, claim, markFired, markFailed, retry,
  shouldFire, MAX_ATTEMPTS, type TriggerRow,
} from '../../../../lib/clob/triggers';

export const runtime = 'nodejs';
export const maxDuration = 60;

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const STALE_MS = 2 * 60 * 1000; // a 'firing' row older than this crashed mid-pass; reclaim it
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function midForMarket(conn: Connection, market: string): Promise<number | null> {
  const m = await Market.loadFromAddress({ connection: conn, address: new PublicKey(market) });
  const bids = m.bids().map((o: any) => o.tokenPrice as number);
  const asks = m.asks().map((o: any) => o.tokenPrice as number);
  const bestBid = bids.length ? Math.max(...bids) : null;
  const bestAsk = asks.length ? Math.min(...asks) : null;
  if (bestBid != null && bestAsk != null) return (bestBid + bestAsk) / 2;
  return bestBid ?? bestAsk;
}

async function fire(conn: Connection, t: TriggerRow): Promise<'fired' | 'failed' | 'retry' | 'pending'> {
  let sig: string;
  try {
    sig = await conn.sendRawTransaction(Buffer.from(t.signed_tx, 'base64'), { skipPreflight: true, maxRetries: 3 });
  } catch (e: any) {
    // Never reached the chain (network). Hand back for another pass unless capped.
    const msg = `send failed: ${e?.message || e}`;
    if (t.attempts + 1 >= MAX_ATTEMPTS) { await markFailed(t.id, msg); return 'failed'; }
    await retry(t.id, msg); return 'retry';
  }
  // Submitted: poll for a result. The nonce is consumed once it lands, so an
  // on-chain error is terminal (don't retry); a timeout stays 'firing' and the
  // stale-recovery on a later pass decides.
  for (let i = 0; i < 8; i++) {
    const st = await conn.getSignatureStatus(sig);
    const cs = st.value?.confirmationStatus;
    if (st.value?.err) { await markFailed(t.id, `tx error: ${JSON.stringify(st.value.err)} (${sig})`); return 'failed'; }
    if (cs === 'confirmed' || cs === 'finalized') { await markFired(t.id, sig); return 'fired'; }
    await sleep(2000);
  }
  return 'pending';
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const conn = new Connection(RPC, 'confirmed');
  const summary = { checked: 0, fired: 0, failed: 0, retried: 0, pending: 0, markets: 0 };
  try {
    await recoverStale(new Date(Date.now() - STALE_MS).toISOString());
    const active = (await listActive()).filter((t) => t.status === 'armed');
    summary.checked = active.length;
    if (!active.length) return NextResponse.json({ ok: true, ...summary });

    // Group by market so each book is read once.
    const byMarket = new Map<string, TriggerRow[]>();
    for (const t of active) (byMarket.get(t.market) || byMarket.set(t.market, []).get(t.market)!).push(t);
    summary.markets = byMarket.size;

    for (const [market, triggers] of byMarket) {
      let mid: number | null = null;
      try { mid = await midForMarket(conn, market); } catch { continue; } // RPC blip: skip, retry next pass
      if (mid == null) continue;

      for (const t of triggers) {
        if (!shouldFire(t.kind, mid, t.trigger_price)) continue;
        if (t.attempts >= MAX_ATTEMPTS) { await markFailed(t.id, 'max attempts reached'); summary.failed++; continue; }
        if (!(await claim(t.id, t.attempts))) continue; // another pass took it
        const r = await fire(conn, t);
        if (r === 'fired') summary.fired++;
        else if (r === 'failed') summary.failed++;
        else if (r === 'retry') summary.retried++;
        else summary.pending++;
      }
    }
    return NextResponse.json({ ok: true, ...summary });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'keeper failed', ...summary }, { status: 500 });
  }
}
