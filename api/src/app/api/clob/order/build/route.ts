/**
 * POST /api/clob/order/build
 *
 * Server-side Manifest order builder. The SDK (with its heavy @solana/kit deps)
 * lives here, NOT in the app bundle. We build the transaction(s); the user's
 * wallet signs on the client. This is the proven wrapper flow (handles
 * ClaimSeat + market Expand correctly), verified on devnet by
 * scripts/manifest-server-order-e2e.ts.
 *
 * Body: { market, trader, isBid, price (0..1 prob), size (base tokens), orderType? }
 * Returns one of:
 *   { setupNeeded: true,  setupTx: base64 }   // partially signed by the ephemeral
 *                                             // wrapper key; client adds trader sig,
 *                                             // sends, then re-POSTs to get the order
 *   { setupNeeded: false, orderIxs: [...] }   // client assembles + signs + sends
 */
import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { ManifestClient, OrderType } from '@cks-systems/manifest-sdk';
import {
  NATIVE_MINT, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
} from '@solana/spl-token';

export const runtime = 'nodejs';

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

function serializeIx(ix: TransactionInstruction) {
  return {
    programId: ix.programId.toBase58(),
    keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
    data: Buffer.from(ix.data).toString('base64'),
  };
}

const ORDER_TYPES: Record<string, OrderType> = {
  limit: OrderType.Limit, ioc: OrderType.ImmediateOrCancel, postonly: OrderType.PostOnly,
};

export async function POST(req: NextRequest) {
  try {
    const { market, trader, isBid, price, size, orderType } = await req.json();
    if (!market || !trader || price == null || size == null) {
      return NextResponse.json({ error: 'market, trader, price, size required' }, { status: 400 });
    }
    const conn = new Connection(RPC, 'confirmed');
    const marketPk = new PublicKey(market);
    const traderPk = new PublicKey(trader);

    // One-time wrapper + seat setup (per user; adds a market info per market).
    const setup = await ManifestClient.getSetupIxs(conn, marketPk, traderPk);
    if (setup.setupNeeded) {
      const tx = new Transaction().add(...setup.instructions);
      tx.recentBlockhash = (await conn.getLatestBlockhash('finalized')).blockhash;
      tx.feePayer = traderPk;
      if (setup.wrapperKeypair) tx.partialSign(setup.wrapperKeypair); // ephemeral co-signer
      const setupTx = tx.serialize({ requireAllSignatures: false }).toString('base64');
      return NextResponse.json({ setupNeeded: true, setupTx });
    }

    const client = await ManifestClient.getClientForMarketNoPrivateKey(conn, marketPk, traderPk);
    const ixs = await client.placeOrderWithRequiredDepositIxs(traderPk, {
      numBaseTokens: Number(size),
      tokenPrice: Number(price),
      isBid: !!isBid,
      orderType: ORDER_TYPES[String(orderType || 'limit').toLowerCase()] ?? OrderType.Limit,
      clientOrderId: Date.now(),
      lastValidSlot: 0,
    });

    // WSOL bids: the SDK deposits the quote from the trader's WSOL ATA but never
    // wraps it. So when the quote is native SOL and this is a buy, prepend the
    // wrap (idempotent ATA + lamport transfer + syncNative) for exactly the
    // shortfall the SDK is about to deposit. The trader signs these too.
    const prefix: TransactionInstruction[] = [];
    if (isBid && (client as any).market.quoteMint().equals(NATIVE_MINT)) {
      const onExchange = (client as any).market.getWithdrawableBalanceTokens(traderPk, false); // quote balance
      const shortfallTokens = Number(size) * Number(price) - onExchange;
      if (shortfallTokens > 0) {
        const ata = getAssociatedTokenAddressSync(NATIVE_MINT, traderPk, true);
        const lamports = Math.ceil(shortfallTokens * 1e9);
        prefix.push(
          createAssociatedTokenAccountIdempotentInstruction(traderPk, ata, traderPk, NATIVE_MINT),
          SystemProgram.transfer({ fromPubkey: traderPk, toPubkey: ata, lamports }),
          createSyncNativeInstruction(ata),
        );
      }
    }
    return NextResponse.json({ setupNeeded: false, orderIxs: [...prefix, ...ixs].map(serializeIx) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'build failed' }, { status: 500 });
  }
}
