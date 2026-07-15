/**
 * Elder market seeding: turn an upcoming World Cup fixture + kind into a live
 * market (feed row with the Elder's odds-shaped forecast → on-chain CLOB book →
 * fixture+predicate binding) so the keeper auto-resolves it later. Shared by the
 * manual /elder/seed endpoint and the scheduled /cron/txline-seeder.
 */
import { worldCupFixtures, type Fixture } from './feed';
import { shapeFixture } from './elder';
import { buildPredicate, describeKind, type MarketKind } from './predicate';
import { enableClobForFeed } from '../clob/enable';
import { insertBinding, listBindings } from './txMarkets';
import { commitForecast, CLV_KINDS } from './clv';

const readEnv = (k: string) => process.env[k] || '';
function sb() {
  return { url: readEnv('SUPABASE_URL'), headers: { apikey: readEnv('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${readEnv('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' } };
}

export async function alreadySeeded(fixtureId: number, kind: string): Promise<boolean> {
  const rows = await listBindings({ fixtureId }).catch(() => []);
  return rows.some((r) => r.kind === kind && r.status !== 'failed');
}

export async function seedOne(fx: Fixture, kind: MarketKind, arm = true) {
  const pred = buildPredicate(kind);
  if (!pred) throw new Error(`unknown kind ${kind}`);
  if (arm && await alreadySeeded(fx.fixtureId, kind)) return { skipped: true, reason: 'already seeded' };

  const shaped = (await shapeFixture(fx.fixtureId, fx.home, fx.away)).find((m) => m.kind === kind);
  const question = shaped?.question || `${describeKind(kind, fx.home, fx.away)}?`;

  // 1) feed row (binary, TxLINE-settled) with the Elder's odds-shaped forecast
  const s = sb();
  const row = {
    question, type: 'binary', status: 'open', category: 'sports', region: 'global',
    resolution_source: 'txline', created_by: 'elder',
    close_time: new Date(fx.startTime).toISOString(),
    resolve_time: new Date(fx.startTime + 3 * 3600_000).toISOString(),
    elder_forecast: shaped?.impliedYes ?? null,
    elder_rationale: shaped?.analysis ?? null,
  };
  const ins = await fetch(`${s.url}/rest/v1/scalar_markets`, { method: 'POST', headers: { ...s.headers, Prefer: 'return=representation' }, body: JSON.stringify(row) });
  if (!ins.ok) throw new Error(`feed insert failed: ${ins.status} ${(await ins.text()).slice(0, 160)}`);
  const scalarMarketId = (await ins.json())[0].id as string;

  // 2) enable the order book on-chain (auto-seeds a small 2-sided book centered on the Elder's fair price)
  const mapping = await enableClobForFeed(scalarMarketId, question, undefined, shaped?.impliedYes ?? undefined);

  // 2b) Provable-CLV: commit the Elder's implied prob BEFORE close, anchored to a
  // finalized slot. Best-effort — a failed commit must never break seeding.
  if (CLV_KINDS.includes(kind)) {
    commitForecast({
      market_pubkey: mapping.market_pubkey, scalar_market_id: scalarMarketId,
      fixture_id: fx.fixtureId, kind, p_implied: shaped?.impliedYes, close_time: fx.startTime,
    }).catch(() => { /* commitment is measure-only; never blocks the trade path */ });
  }

  // 3) bind to the fixture + predicate so the keeper resolves it.
  // arm=false leaves it tradeable but NOT resolving yet (bind later on cue).
  if (!arm) return { scalarMarketId, market_pubkey: mapping.market_pubkey, bindingId: null, question, armed: false };
  const binding = await insertBinding({
    market_pubkey: mapping.market_pubkey, scalar_market_id: scalarMarketId,
    fixture_id: fx.fixtureId, competition_id: fx.competitionId, home: fx.home, away: fx.away,
    kind, description: describeKind(kind, fx.home, fx.away),
    stat_key_a: pred.stat_key_a, stat_key_b: pred.stat_key_b, op: pred.op,
    comparison: pred.comparison, threshold: pred.threshold, period: pred.period, status: 'armed',
  });
  return { scalarMarketId, market_pubkey: mapping.market_pubkey, bindingId: binding.id, question };
}

/** Seed up to `maxPerPass` NEW markets across the next `limit` upcoming fixtures. */
export async function seedNextUpcoming(opts: { limit: number; kinds: MarketKind[]; maxPerPass: number }) {
  const { fixtures } = await worldCupFixtures();
  const upcoming = fixtures.filter((f) => f.startTime > Date.now()).sort((a, b) => a.startTime - b.startTime).slice(0, opts.limit);
  const out: any[] = [];
  let made = 0;
  for (const fx of upcoming) {
    for (const kind of opts.kinds) {
      if (made >= opts.maxPerPass) return out;
      if (await alreadySeeded(fx.fixtureId, kind)) continue;
      try { out.push({ fixtureId: fx.fixtureId, kind, ...(await seedOne(fx, kind)) }); made++; }
      catch (e: any) { out.push({ fixtureId: fx.fixtureId, kind, error: e?.message || String(e) }); made++; }
    }
  }
  return out;
}

export async function upcomingFixtures(limit: number): Promise<Fixture[]> {
  const { fixtures } = await worldCupFixtures();
  return fixtures.filter((f) => f.startTime > Date.now()).sort((a, b) => a.startTime - b.startTime).slice(0, limit);
}
