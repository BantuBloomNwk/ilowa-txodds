/**
 * GET /api/cron/clv-close   (Bearer CRON_SECRET)
 *
 * Provable-CLV Elder, close step. For every pre-close commitment whose market has
 * now closed but has no closing line yet, snapshot the market's own de-vigged
 * implied prob (the benchmark CLV is measured against) from the same shaper the
 * commitment used. Measure-only; never touches funds. Run near kickoff on a
 * schedule (e.g. alongside the seeder/resolver).
 */
import { NextRequest, NextResponse } from 'next/server';
import { snapshotCloseLines } from '../../../../lib/txodds/clv';

export const runtime = 'nodejs';
export const maxDuration = 60;

const readEnv = (k: string) => process.env[k] || '';

export async function GET(req: NextRequest) {
  const secret = readEnv('CRON_SECRET');
  // Fail closed: an unset secret must NOT open the endpoint to the public internet.
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const r = await snapshotCloseLines();
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'clv-close failed' }, { status: 500 });
  }
}
