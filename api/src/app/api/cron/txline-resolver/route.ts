/**
 * GET /api/cron/txline-resolver   (Bearer CRON_SECRET)
 *
 * One pass of the World Cup settlement keeper. For each armed market↔fixture
 * binding whose match has finished, fetch the TxLINE proof and resolve the market
 * on-chain via resolve_market_via_txline. Permissionless: the proof decides the
 * outcome, the keeper only pays. Atomic claim (armed -> resolving) prevents
 * double-resolve; bounded retries; stale-claim recovery.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Connection } from '@solana/web3.js';
import { matchResult } from '../../../../lib/txodds/settlement';
import { resolveOnChain, finalizeVault, keeperLoaded } from '../../../../lib/txodds/resolver';
import { evaluate, type MarketKind } from '../../../../lib/txodds/predicate';
import {
  listBindings, claimBinding, markResolved, markBindingFailed, retryBinding,
  recoverStaleBindings, MAX_RESOLVE_ATTEMPTS,
} from '../../../../lib/txodds/txMarkets';

export const runtime = 'nodejs';
export const maxDuration = 60;

const readEnv = (k: string) => process.env[k] || '';
const STALE_MS = 2 * 60 * 1000;

export async function GET(req: NextRequest) {
  const secret = readEnv('CRON_SECRET');
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!keeperLoaded()) return NextResponse.json({ ok: false, error: 'keeper key not configured' }, { status: 500 });

  const conn = new Connection(readEnv('SOLANA_RPC_URL') || 'https://api.devnet.solana.com', 'confirmed');
  const summary = { checked: 0, resolved: 0, finalized: 0, pendingMatch: 0, failed: 0, retried: 0 };
  try {
    await recoverStaleBindings(new Date(Date.now() - STALE_MS).toISOString());
    const armed = await listBindings({ status: 'armed' });
    summary.checked = armed.length;

    for (const b of armed) {
      let result;
      try { result = await matchResult(b.fixture_id); } catch { continue; }
      if (!result.finished || !result.proof) { summary.pendingMatch++; continue; }
      if (b.attempts >= MAX_RESOLVE_ATTEMPTS) { await markBindingFailed(b.id, 'max attempts'); summary.failed++; continue; }
      if (!(await claimBinding(b.id, b.attempts))) continue; // another pass took it

      try {
        const sig = await resolveOnChain(conn, b, result);
        const outcome = evaluate(b.kind as MarketKind, result.homeGoals ?? 0, result.awayGoals ?? 0);
        await markResolved(b.id, outcome, sig);
        summary.resolved++;
        // Complete settlement: finalize the vault so winnings are redeemable (best-effort).
        try { if (await finalizeVault(conn, b.market_pubkey)) summary.finalized++; } catch { /* keeper can finalize on a later pass */ }
      } catch (e: any) {
        const msg = e?.message || String(e);
        // MarketNotActive (already resolved / not resolvable) is terminal.
        if (/MarketNotActive|already|0x1771|custom program error/.test(msg) || b.attempts + 1 >= MAX_RESOLVE_ATTEMPTS) {
          await markBindingFailed(b.id, msg); summary.failed++;
        } else {
          await retryBinding(b.id, msg); summary.retried++;
        }
      }
    }
    return NextResponse.json({ ok: true, ...summary });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'resolver failed', ...summary }, { status: 500 });
  }
}
