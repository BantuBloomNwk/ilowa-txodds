/**
 * GET /api/clob/balance/:market/:owner
 *
 * The trader's WITHDRAWABLE balance held on the Manifest exchange (the "seat"),
 * not their wallet token accounts. A filled buy credits YES to the seat, not the
 * wallet ATA — so the app must count the seat when showing a position or deciding
 * whether a sell/trigger has YES to sell.
 *
 * Returns: { yes, quote }  (whole tokens; 0 when no seat).
 */
import { NextRequest, NextResponse } from 'next/server';
import { Connection, PublicKey } from '@solana/web3.js';
import { ManifestClient } from '@cks-systems/manifest-sdk';

export const runtime = 'nodejs';

const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

export async function GET(_req: NextRequest, { params }: { params: { market: string; owner: string } }) {
  try {
    const conn = new Connection(RPC, 'confirmed');
    const marketPk = new PublicKey(params.market);
    const ownerPk = new PublicKey(params.owner);
    const client = await ManifestClient.getClientReadOnly(conn, marketPk, ownerPk).catch(() => null);
    if (!client) return NextResponse.json({ yes: 0, quote: 0 });
    const yes = client.market.getWithdrawableBalanceTokens(ownerPk, true);    // base = YES
    const quote = client.market.getWithdrawableBalanceTokens(ownerPk, false); // quote = collateral
    return NextResponse.json({ yes: Number(yes) || 0, quote: Number(quote) || 0 });
  } catch (e: any) {
    return NextResponse.json({ yes: 0, quote: 0, error: e?.message });
  }
}
