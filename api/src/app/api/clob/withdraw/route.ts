/**
 * POST /api/clob/withdraw  { market, trader }
 *
 * Builds the wrapper withdraw instruction(s) to pull a trader's FULL seat balance
 * (filled YES + deposited collateral) back to their wallet ATAs. Wrapper-attributed
 * like cancel, so it's built SDK-side via withdrawAllIx; the client signs. Returns
 * an empty ix list when the seat is empty (nothing to withdraw).
 *
 * Returns: { ixs: [serialized TransactionInstruction] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { ManifestClient } from '@cks-systems/manifest-sdk';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

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
    const { market, trader } = await req.json();
    if (!market || !trader) return NextResponse.json({ error: 'market, trader required' }, { status: 400 });
    const conn = new Connection(RPC, 'confirmed');
    const traderPk = new PublicKey(trader);
    const client: any = await ManifestClient.getClientForMarketNoPrivateKey(conn, new PublicKey(market), traderPk);
    const wd = (await client.withdrawAllIx()) as TransactionInstruction[];
    if (!wd?.length) return NextResponse.json({ ixs: [] });
    // The wrapper withdraw credits tokens to the trader's ATAs and PANICS if an ATA
    // doesn't exist yet (a fresh wallet has no YES token account). Create both ATAs
    // idempotently first, then withdraw.
    const base = client.market.baseMint(), quote = client.market.quoteMint();
    const baseProg = client.isBase22 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const quoteProg = client.isQuote22 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const ixs: TransactionInstruction[] = [
      createAssociatedTokenAccountIdempotentInstruction(traderPk, getAssociatedTokenAddressSync(base, traderPk, true, baseProg), traderPk, base, baseProg),
      createAssociatedTokenAccountIdempotentInstruction(traderPk, getAssociatedTokenAddressSync(quote, traderPk, true, quoteProg), traderPk, quote, quoteProg),
      ...wd,
    ];
    return NextResponse.json({ ixs: ixs.map(serializeIx) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'withdraw build failed' }, { status: 500 });
  }
}
