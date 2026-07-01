/**
 * POST /api/clob/order/cancel
 *
 * Builds the wrapper cancel instruction(s) for a trader's resting order(s).
 * Cancel is wrapper-attributed (orders were placed through the wrapper), so it
 * must go through cancelOrderIx — a raw core BatchUpdate by sequenceNumber would
 * not match a wrapper-held seat. No Expand/seat choreography needed here (the
 * seat already exists), so a single tx of cancel ixs is enough; the client signs.
 *
 * Body: { market, trader, clientOrderIds: (string|number)[] }
 * Returns: { ixs: [serialized TransactionInstruction] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { ManifestClient } from '@cks-systems/manifest-sdk';

export const runtime = 'nodejs';

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

function serializeIx(ix: TransactionInstruction) {
  return {
    programId: ix.programId.toBase58(),
    keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
    data: Buffer.from(ix.data).toString('base64'),
  };
}

export async function POST(req: NextRequest) {
  try {
    const { market, trader, clientOrderIds } = await req.json();
    if (!market || !trader || !Array.isArray(clientOrderIds) || clientOrderIds.length === 0) {
      return NextResponse.json({ error: 'market, trader, clientOrderIds[] required' }, { status: 400 });
    }
    const conn = new Connection(RPC, 'confirmed');
    const marketPk = new PublicKey(market);
    const traderPk = new PublicKey(trader);

    const client = await ManifestClient.getClientForMarketNoPrivateKey(conn, marketPk, traderPk);
    const ixs = clientOrderIds.map((id) => client.cancelOrderIx({ clientOrderId: Number(id) }));
    return NextResponse.json({ ixs: ixs.map(serializeIx) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'cancel build failed' }, { status: 500 });
  }
}
