/**
 * POST /api/clob/trigger/arm
 *
 * Arms a set-and-forget stop / take-profit. The CLIENT builds the exact
 * protective order against a durable nonce, signs it ONCE, and sends us the raw
 * signed bytes plus the trigger condition. We never sign anything and hold no
 * authority: the keeper can only relay these exact bytes, and only when the
 * price crosses. Proven model, see scripts/clob-stop-keeper-probe.ts.
 *
 * Body: { owner, market, scalarMarketId?, kind:'stop'|'takeProfit',
 *         side:'buy'|'sell', triggerPrice (0..1), size, noncePubkey, signedTx(base64) }
 * Returns: { id }
 */
import { NextRequest, NextResponse } from 'next/server';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { insertTrigger } from '../../../../../lib/clob/triggers';

export const runtime = 'nodejs';

const SYS = SystemProgram.programId.toBase58();
const ADVANCE_NONCE = 4; // SystemInstruction enum index for AdvanceNonceAccount

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const { owner, market, scalarMarketId, kind, side, triggerPrice, size, noncePubkey, signedTx } = b || {};

    if (!owner || !market || !noncePubkey || !signedTx) return bad('owner, market, noncePubkey, signedTx required');
    if (kind !== 'stop' && kind !== 'takeProfit') return bad('kind must be stop or takeProfit');
    if (side !== 'buy' && side !== 'sell') return bad('side must be buy or sell');
    const price = Number(triggerPrice), sz = Number(size);
    if (!(price > 0 && price < 1)) return bad('triggerPrice must be between 0 and 1');
    if (!(sz > 0)) return bad('size must be positive');

    // Validate the signed tx actually belongs to the owner and is a durable-nonce
    // order on the declared nonce, with a valid signature. Rejects junk early.
    let tx: Transaction;
    try { tx = Transaction.from(Buffer.from(signedTx, 'base64')); }
    catch { return bad('signedTx is not a valid transaction'); }

    if (tx.feePayer?.toBase58() !== owner) return bad('signedTx fee payer is not the owner');
    const adv = tx.instructions.find(
      (ix) => ix.programId.toBase58() === SYS && ix.data.length >= 4 && ix.data.readUInt32LE(0) === ADVANCE_NONCE,
    );
    if (!adv) return bad('signedTx is not a durable-nonce transaction');
    if (adv.keys[0]?.pubkey.toBase58() !== noncePubkey) return bad('nonce account mismatch');
    try { new PublicKey(noncePubkey); } catch { return bad('bad noncePubkey'); }
    if (!tx.verifySignatures()) return bad('signedTx signature is invalid');

    const row = await insertTrigger({
      owner, market, scalar_market_id: scalarMarketId || null,
      kind, side, trigger_price: price, size: sz,
      nonce_pubkey: noncePubkey, signed_tx: signedTx, status: 'armed',
    });
    return NextResponse.json({ id: row.id, status: row.status });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'arm failed' }, { status: 500 });
  }
}

function bad(msg: string) { return NextResponse.json({ error: msg }, { status: 400 }); }
