/**
 * GET /api/cron/txline-seeder   (Bearer CRON_SECRET)
 *
 * Keeps the World Cup feed stocked: each pass seeds up to a couple of NEW result
 * markets for the soonest upcoming fixtures (idempotent, so no duplicates). Paired
 * with /api/cron/txline-resolver, which settles each one on-chain when its match
 * ends. Bounded per pass so the request stays fast and keeper spend stays sane.
 */
import { NextRequest, NextResponse } from 'next/server';
import { seedNextUpcoming } from '../../../../lib/txodds/seeder';
import type { MarketKind } from '../../../../lib/txodds/predicate';

export const runtime = 'nodejs';
export const maxDuration = 60;

const readEnv = (k: string) => process.env[k] || '';

// Tunable via env without a redeploy.
const LIMIT = Number(readEnv('SEEDER_FIXTURE_LIMIT')) || 5;        // look ahead this many fixtures
const MAX_PER_PASS = Number(readEnv('SEEDER_MAX_PER_PASS')) || 2;   // create at most this many new markets per pass
// Default covers goals (odds-echo) + corners/yellows (independent model, see
// independent-model.ts) + red_card (settleable, no Elder-quoted probability yet, same honest
// gap as before).
// Override via SEEDER_KINDS env without a redeploy if you want to narrow this back down.
const KINDS = (readEnv('SEEDER_KINDS') || 'home_win,away_win,over_2_5,corners_over_8_5,yellows_over_3_5,red_card').split(',').map((k) => k.trim()).filter(Boolean) as MarketKind[];

export async function GET(req: NextRequest) {
  const secret = readEnv('CRON_SECRET');
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const seeded = await seedNextUpcoming({ limit: LIMIT, kinds: KINDS, maxPerPass: MAX_PER_PASS });
    const made = seeded.filter((s) => s.bindingId).length;
    return NextResponse.json({ ok: true, made, seeded });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'seeder failed' }, { status: 500 });
  }
}
