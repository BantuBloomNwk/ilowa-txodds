/**
 * POST /api/txodds/market/bind
 *
 * Binds an on-chain market to a World Cup fixture + a fixed predicate. The keeper
 * later reads this to fetch the proof and resolve resolve_market_via_txline. The
 * predicate is derived from `kind` and stored, so it can't be changed at resolve.
 *
 * Body: { marketPubkey, scalarMarketId?, fixtureId, kind }
 *   kind: home_win | away_win | over_1_5 | over_2_5 | over_3_5 | under_2_5
 */
import { NextRequest, NextResponse } from 'next/server';
import { worldCupFixtures } from '../../../../../lib/txodds/feed';
import { buildPredicate, describeKind, type MarketKind } from '../../../../../lib/txodds/predicate';
import { insertBinding } from '../../../../../lib/txodds/txMarkets';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { marketPubkey, scalarMarketId, fixtureId, kind } = (await req.json()) || {};
    if (!marketPubkey || fixtureId == null || !kind) {
      return NextResponse.json({ error: 'marketPubkey, fixtureId, kind required' }, { status: 400 });
    }
    const pred = buildPredicate(kind as MarketKind);
    if (!pred) return NextResponse.json({ error: `unknown kind: ${kind}` }, { status: 400 });

    const fid = Number(fixtureId);
    const { fixtures } = await worldCupFixtures();
    const fx = fixtures.find((f) => f.fixtureId === fid);
    const home = fx?.home ?? null, away = fx?.away ?? null;

    const binding = await insertBinding({
      market_pubkey: String(marketPubkey),
      scalar_market_id: scalarMarketId || null,
      fixture_id: fid,
      competition_id: fx?.competitionId ?? null,
      home, away,
      kind,
      description: home && away ? describeKind(kind as MarketKind, home, away) : describeKind(kind as MarketKind, 'Home', 'Away'),
      stat_key_a: pred.stat_key_a, stat_key_b: pred.stat_key_b, op: pred.op,
      comparison: pred.comparison, threshold: pred.threshold, period: pred.period,
      status: 'armed',
    });
    return NextResponse.json({ ok: true, binding });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'bind failed' }, { status: 500 });
  }
}
