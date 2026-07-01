/**
 * POST /api/clob/trigger/build
 *
 * Builds the UNSIGNED protective order for a set-and-forget stop / take-profit,
 * bound to the user's durable nonce. The client created the nonce account, asks
 * us to assemble the exact order (an IOC sell of YES at a floor price), signs it
 * once, and stores it via /arm. We never sign it.
 *
 * Body: { market, owner, price (0..1 floor), size, noncePubkey }
 * Returns: { unsignedTx: base64 }  or  { setupNeeded: true } if the user has no
 * seat yet (they must place a normal order first to open one).
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  Connection, PublicKey, Transaction, SystemProgram, ComputeBudgetProgram, NonceAccount,
} from '@solana/web3.js';
import { ManifestClient, OrderType } from '@cks-systems/manifest-sdk';

export const runtime = 'nodejs';

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

export async function POST(req: NextRequest) {
  try {
    const { market, owner, price, size, noncePubkey } = await req.json();
    if (!market || !owner || price == null || size == null || !noncePubkey) {
      return NextResponse.json({ error: 'market, owner, price, size, noncePubkey required' }, { status: 400 });
    }
    const conn = new Connection(RPC, 'confirmed');
    const marketPk = new PublicKey(market);
    const ownerPk = new PublicKey(owner);
    const noncePk = new PublicKey(noncePubkey);

    // The seat must already exist: a durable-nonce tx can't also run the one-time
    // wrapper/seat setup (that has to land immediately). Tell the client to trade
    // once first.
    const setup = await ManifestClient.getSetupIxs(conn, marketPk, ownerPk);
    if (setup.setupNeeded) return NextResponse.json({ setupNeeded: true });

    const client = await ManifestClient.getClientForMarketNoPrivateKey(conn, marketPk, ownerPk);
    const placeIxs = await client.placeOrderWithRequiredDepositIxs(ownerPk, {
      numBaseTokens: Number(size),
      tokenPrice: Number(price),
      isBid: false, // a protective stop / take-profit sells the YES you hold
      orderType: OrderType.ImmediateOrCancel,
      clientOrderId: Date.now(),
      lastValidSlot: 0,
    });

    // Read the nonce value to use as the tx's recentBlockhash.
    const info = await conn.getAccountInfo(noncePk, 'confirmed');
    if (!info) return NextResponse.json({ error: 'nonce account not found yet' }, { status: 400 });
    const nonceValue = NonceAccount.fromAccountData(info.data).nonce;

    const tx = new Transaction().add(
      SystemProgram.nonceAdvance({ noncePubkey: noncePk, authorizedPubkey: ownerPk }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ...placeIxs,
    );
    tx.recentBlockhash = nonceValue;
    tx.feePayer = ownerPk;

    const unsignedTx = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
    return NextResponse.json({ unsignedTx });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'trigger build failed' }, { status: 500 });
  }
}
