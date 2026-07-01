/**
 * POST /api/clob/trigger/revoke  { id, owner }
 *
 * Disarms a trigger so the keeper will never fire it. The full revocation is the
 * user closing the durable nonce client-side (that invalidates the stored bytes
 * and refunds the rent); this flip just stops the keeper immediately. We return
 * the nonce pubkey so the client can follow up with the close.
 */
import { NextRequest, NextResponse } from 'next/server';
import { revoke, listByOwner } from '../../../../../lib/clob/triggers';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { id, owner } = (await req.json()) || {};
    if (!id || !owner) return NextResponse.json({ error: 'id and owner required' }, { status: 400 });
    const ok = await revoke(id, owner);
    if (!ok) return NextResponse.json({ error: 'not found or already inactive' }, { status: 404 });
    const row = (await listByOwner(owner)).find((t) => t.id === id);
    return NextResponse.json({ revoked: true, noncePubkey: row?.nonce_pubkey || null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'revoke failed' }, { status: 500 });
  }
}
