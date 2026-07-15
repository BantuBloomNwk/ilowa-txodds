/**
 * POST /api/txodds/market/resolve   { marketPubkey }
 *
 * On-demand settlement of ONE World Cup market from its TxLINE proof. Same path as
 * the cron keeper (fetch proof -> resolve_market_via_txline on-chain -> finalize
 * vault), just scoped to a single bound market. Permissionless and safe to expose:
 * the Merkle proof decides the outcome, not the caller. Powers the in-app "Settle
 * from TxLINE proof" control used for the live demo.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Connection } from '@solana/web3.js';
import { matchResult } from '../../../../../lib/txodds/settlement';
import { resolveOnChain, finalizeVault, keeperLoaded } from '../../../../../lib/txodds/resolver';
import { evaluatePredicate } from '../../../../../lib/txodds/predicate';
import { listBindings, claimBinding, markResolved } from '../../../../../lib/txodds/txMarkets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const readEnv = (k: string) => process.env[k] || '';

export async function POST(req: NextRequest) {
  try {
    const { marketPubkey } = await req.json();
    if (!marketPubkey) return NextResponse.json({ error: 'marketPubkey required' }, { status: 400 });
    if (!keeperLoaded()) return NextResponse.json({ error: 'keeper key not configured' }, { status: 500 });

    const all = await listBindings({ marketPubkey });
    if (!all.length) return NextResponse.json({ error: 'no TxLINE binding for this market' }, { status: 404 });
    // Prefer an already-resolved record (idempotent), else the armed one.
    const resolved = all.find((b) => b.status === 'resolved');
    if (resolved) return NextResponse.json({ ok: true, alreadyResolved: true, outcome: resolved.resolved_outcome, sig: resolved.resolve_sig });
    const b = all.find((x) => x.status === 'armed') || all[0];
    if (b.status !== 'armed') return NextResponse.json({ ok: false, status: b.status, error: `binding is ${b.status}` }, { status: 409 });

    const result = await matchResult(b.fixture_id, b.stat_key_a, b.stat_key_b);
    if (!result.finished || !result.proof) return NextResponse.json({ ok: false, pending: true, error: 'match not finished / not rooted yet' });

    if (!(await claimBinding(b.id, b.attempts))) return NextResponse.json({ ok: false, error: 'another settlement pass is in flight' }, { status: 409 });

    const conn = new Connection(readEnv('SOLANA_RPC_URL') || 'https://api.devnet.solana.com', 'confirmed');
    const sig = await resolveOnChain(conn, b, result);
    const outcome = evaluatePredicate(b, result.statAValue ?? 0, result.statBValue);
    await markResolved(b.id, outcome, sig);
    let finalized = false;
    try { finalized = !!(await finalizeVault(conn, b.market_pubkey)); } catch { /* a later pass can finalize */ }

    return NextResponse.json({ ok: true, outcome, sig, finalized });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'resolve failed' }, { status: 500 });
  }
}
