/**
 * POST /api/txodds/elder/seed   (Bearer CRON_SECRET)
 *
 * Manual Elder seed. Body: { fixtureId, kind }  OR  { auto: true, limit?, kinds? }.
 * The scheduled version is /api/cron/txline-seeder. Shared logic in lib/txodds/seeder.
 */
import { NextRequest, NextResponse } from 'next/server';
import { seedOne, seedNextUpcoming, upcomingFixtures } from '../../../../../lib/txodds/seeder';
import type { MarketKind } from '../../../../../lib/txodds/predicate';

export const runtime = 'nodejs';
export const maxDuration = 60;

const readEnv = (k: string) => process.env[k] || '';

export async function POST(req: NextRequest) {
  const secret = readEnv('CRON_SECRET');
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: any; try { body = await req.json(); } catch { body = {}; }
  try {
    if (body?.auto) {
      const seeded = await seedNextUpcoming({
        limit: Math.min(Number(body.limit) || 2, 6),
        kinds: (Array.isArray(body.kinds) ? body.kinds : ['home_win']) as MarketKind[],
        maxPerPass: Math.min(Number(body.maxPerPass) || 6, 12),
      });
      return NextResponse.json({ ok: true, seeded });
    }
    let fx: any = (await upcomingFixtures(40)).find((f) => f.fixtureId === Number(body?.fixtureId));
    // Allow a finished fixture (not in the upcoming list) when home/away are given —
    // for a ready-to-resolve demo market. arm:false seeds it tradeable but unbound.
    if (!fx && body?.home && body?.away) {
      fx = { fixtureId: Number(body.fixtureId), competitionId: Number(body.competitionId) || 72, home: String(body.home), away: String(body.away), startTime: Number(body.startTime) || Date.now() + 3600_000, homeIsP1: true };
    }
    if (!fx) return NextResponse.json({ error: 'fixtureId not found; pass home+away for a finished fixture' }, { status: 400 });
    const result = await seedOne(fx, String(body?.kind) as MarketKind, body?.arm !== false);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'seed failed' }, { status: 500 });
  }
}
