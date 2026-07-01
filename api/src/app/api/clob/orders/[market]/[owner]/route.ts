/**
 * GET /api/clob/orders/:market/:owner
 *
 * Returns the trader's OWN resting orders on a Manifest market, read through
 * their wrapper (orders placed via /api/clob/order/build are wrapper-attributed,
 * so a plain market.bids()/asks() filter by wallet would miss them). Each order
 * carries the clientOrderId needed to cancel it (see /api/clob/order/cancel).
 *
 * Returns: { orders: [{ clientOrderId, sequenceNumber, isBid, price, size, orderType }] }
 * Empty list when the trader has no wrapper / no resting orders.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { ManifestClient } from '@cks-systems/manifest-sdk';

export const runtime = 'nodejs';

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

// beet bignum is number | BN; normalise to a base-10 string either way.
const bn = (v: any): string => (v == null ? '0' : typeof v === 'object' && typeof v.toString === 'function' ? v.toString() : String(v));

export async function GET(_req: NextRequest, { params }: { params: { market: string; owner: string } }) {
  try {
    const conn = new Connection(RPC, 'confirmed');
    const marketPk = new PublicKey(params.market);
    const ownerPk = new PublicKey(params.owner);

    // Read-only client = the owner's wrapper + the market, no signing.
    const client = await ManifestClient.getClientReadOnly(conn, marketPk, ownerPk).catch(() => null);
    const open = client?.wrapper?.openOrdersForMarket(marketPk);
    if (!client || !open || open.length === 0) return NextResponse.json({ orders: [] });

    const baseDec = client.market.baseDecimals();
    const orders = open.map((o: any) => ({
      clientOrderId: bn(o.clientOrderId),
      sequenceNumber: bn(o.orderSequenceNumber),
      isBid: !!o.isBid,
      price: o.price,                                                 // collateral per YES (= probability 0..1)
      size: Number(bn(o.numBaseAtoms)) / 10 ** baseDec,              // YES tokens
      orderType: typeof o.orderType === 'number' ? o.orderType : Number(o.orderType),
    }));
    return NextResponse.json({ orders });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'open-orders read failed' }, { status: 500 });
  }
}
