/**
 * Provable-CLV Elder — data layer (docs/specs/provable-clv-elder.md, phase 1).
 *
 * Three moments in a commitment's life:
 *  1. commit  — before close, record the Elder's implied prob p + a finalized slot
 *               anchor (commitForecast). Called at seed time.
 *  2. close   — at/near kickoff, snapshot the market's de-vigged closing line
 *               (snapshotCloseLines). Called by the clv-close cron.
 *  3. settle  — after the match resolves, record the realized outcome
 *               (recordSettlement). Called by the resolver after it settles a market.
 *
 * The committed line and the closing line both come from the SAME shaper
 * (elder.shapeFixture → demargined implied %), so CLV compares like with like.
 * All writes are best-effort and never block the trading/settlement path.
 */
import { Connection } from '@solana/web3.js';
import { shapeFixture } from './elder';
import type { MarketKind } from './predicate';

// Bump when the Elder's shaping changes: a track record is attributable to ONE
// build (§6, "freeze elder_version per record"). v1 = the odds-echo shaper that
// quotes the demargined line; its CLV is ~0 by construction until the Elder earns
// real signal, and the ledger will show exactly that, honestly.
export const ELDER_VERSION = 'elder-odds-v1';

// Kinds that get a pre-close commitment. home_win/away_win/over_2_5 use the odds-echo shaper
// (elder.ts) and also get a close-line snapshot below, since TxLINE quotes those markets.
// That's a genuine two-sided comparison once the shaper's signal improves beyond v1's echo.
// corners_over_8_5/yellows_over_3_5 use the INDEPENDENT historical-frequency model
// (independent-model.ts) instead. TxLINE doesn't quote a corners/cards odds market, so
// snapshotCloseLines (which only reads elder.shapeFixture) will never find a close price for
// these kinds, so close_line stays null forever, by design. That's honest, not broken: the
// ledger UI already renders a settled outcome with no CLV points chip when close_line is null
// (see ClvTrackRecord.tsx's status logic), rather than fabricating a close line that doesn't
// exist. corners_over_10_5 is seeded (see seeder.ts MODEL_KINDS) but left out of CLV tracking
// to keep the tracked set to one corners threshold.
export const CLV_KINDS: MarketKind[] = ['home_win', 'away_win', 'over_2_5', 'corners_over_8_5', 'yellows_over_3_5'];

const readEnv = (k: string) => process.env[k] || '';
function sb() {
  const url = readEnv('SUPABASE_URL'), key = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Supabase service env not configured');
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
}

export interface Commitment {
  id: string;
  market_pubkey: string;
  scalar_market_id: string | null;
  fixture_id: number;
  kind: string;
  elder_version: string;
  p_implied: number;
  committed_at: string;
  committed_slot: number | null;
  committed_blockhash: string | null;
  close_time: string;
  close_line: number | null;
  close_slot: number | null;
  close_snapshot_at: string | null;
  settled_outcome: boolean | null;
  settled_at: string | null;
  resolve_sig: string | null;
}

function conn(): Connection {
  return new Connection(readEnv('SOLANA_RPC_URL') || 'https://api.devnet.solana.com', 'confirmed');
}

/** Finalized slot + blockhash = the trustless "before close" anchor. Best-effort. */
async function chainAnchor(): Promise<{ slot: number | null; blockhash: string | null }> {
  try {
    const c = conn();
    const [slot, bh] = await Promise.all([c.getSlot('finalized'), c.getLatestBlockhash('finalized')]);
    return { slot, blockhash: bh.blockhash };
  } catch { return { slot: null, blockhash: null }; }
}

/**
 * Record the Elder's pre-close commitment for a market. p_implied is the shaper's
 * implied prob at commit; skips when there's no priced line (nothing to commit) or
 * the commitment would land at/after close (fails the before-close rule up front).
 * Idempotent per (market_pubkey, elder_version).
 */
export async function commitForecast(input: {
  market_pubkey: string;
  scalar_market_id?: string | null;
  fixture_id: number;
  kind: MarketKind;
  p_implied: number | null | undefined;
  close_time: number; // ms epoch (kickoff)
}): Promise<Commitment | null> {
  if (input.p_implied == null || !Number.isFinite(input.p_implied)) return null;
  if (Date.now() >= input.close_time) return null; // already at/after close: ineligible, don't record
  const anchor = await chainAnchor();
  const s = sb();
  const row = {
    market_pubkey: input.market_pubkey,
    scalar_market_id: input.scalar_market_id ?? null,
    fixture_id: input.fixture_id,
    kind: input.kind,
    elder_version: ELDER_VERSION,
    p_implied: input.p_implied,
    committed_slot: anchor.slot,
    committed_blockhash: anchor.blockhash,
    close_time: new Date(input.close_time).toISOString(),
  };
  const res = await fetch(`${s.url}/rest/v1/clv_commitments?on_conflict=market_pubkey,elder_version`, {
    method: 'POST',
    headers: { ...s.headers, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row), cache: 'no-store',
  });
  if (!res.ok) throw new Error(`clv commit failed: ${res.status} ${(await res.text()).slice(0, 160)}`);
  return (await res.json())[0];
}

/** Commitments still needing a close line (close_time passed, close_line null). */
async function commitmentsAwaitingClose(): Promise<Commitment[]> {
  const s = sb();
  const nowIso = new Date().toISOString();
  const res = await fetch(
    `${s.url}/rest/v1/clv_commitments?select=*&close_line=is.null&close_time=lte.${nowIso}&order=close_time.asc`,
    { headers: s.headers, cache: 'no-store' });
  return res.ok ? await res.json() : [];
}

async function patch(id: string, body: Record<string, unknown>) {
  const s = sb();
  await fetch(`${s.url}/rest/v1/clv_commitments?id=eq.${id}`, {
    method: 'PATCH', headers: { ...s.headers, Prefer: 'return=minimal' }, body: JSON.stringify(body), cache: 'no-store',
  });
}

/**
 * For every commitment whose market has closed but has no close line yet, snapshot
 * the market's own de-vigged implied prob (the closing line) from the SAME shaper
 * the commitment used. This is the benchmark CLV is measured against (§4: our own
 * book's close, not an external sportsbook). One shaper call per fixture.
 */
export async function snapshotCloseLines(): Promise<{ scanned: number; captured: number }> {
  const rows = await commitmentsAwaitingClose();
  const anchor = await chainAnchor();
  const byFixture = new Map<number, Record<string, number | null>>();
  let captured = 0;

  for (const r of rows) {
    if (!byFixture.has(r.fixture_id)) {
      // home/away only feed the prose; impliedYes comes from the odds parse.
      const shaped = await shapeFixture(r.fixture_id, '', '').catch(() => []);
      const map: Record<string, number | null> = {};
      for (const m of shaped) map[m.kind] = m.impliedYes;
      byFixture.set(r.fixture_id, map);
    }
    const close = byFixture.get(r.fixture_id)?.[r.kind];
    if (close == null || !Number.isFinite(close)) continue; // odds quiet at close: leave pending, honest
    await patch(r.id, { close_line: close, close_slot: anchor.slot, close_snapshot_at: new Date().toISOString() });
    captured++;
  }
  return { scanned: rows.length, captured };
}

/** Fill the realized outcome once the market has settled on-chain (best-effort). */
export async function recordSettlement(market_pubkey: string, outcome: boolean, resolve_sig: string): Promise<void> {
  const s = sb();
  await fetch(`${s.url}/rest/v1/clv_commitments?market_pubkey=eq.${market_pubkey}&settled_outcome=is.null`, {
    method: 'PATCH', headers: { ...s.headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ settled_outcome: outcome, resolve_sig, settled_at: new Date().toISOString() }),
    cache: 'no-store',
  });
}

export async function listCommitments(filter: { elderVersion?: string; fixtureId?: number } = {}): Promise<Commitment[]> {
  const s = sb();
  const q: string[] = [];
  if (filter.elderVersion) q.push(`elder_version=eq.${filter.elderVersion}`);
  if (filter.fixtureId) q.push(`fixture_id=eq.${filter.fixtureId}`);
  const qs = q.length ? `&${q.join('&')}` : '';
  const res = await fetch(`${s.url}/rest/v1/clv_commitments?select=*${qs}&order=committed_at.desc`, { headers: s.headers, cache: 'no-store' });
  return res.ok ? await res.json() : [];
}
