/**
 * Data layer for txline_markets (market ↔ fixture + predicate bindings).
 * PostgREST + service role, same pattern as the other server data modules.
 */
const readEnv = (k: string) => process.env[k] || '';
function sb() {
  const url = readEnv('SUPABASE_URL'), key = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Supabase service env not configured');
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
}

export interface TxlineMarket {
  id: string;
  market_pubkey: string;
  scalar_market_id: string | null;
  fixture_id: number;
  competition_id: number | null;
  home: string | null;
  away: string | null;
  kind: string;
  description: string | null;
  stat_key_a: number;
  stat_key_b: number | null;
  op: string | null;
  comparison: string;
  threshold: number;
  period: number;
  status: 'armed' | 'resolving' | 'resolved' | 'failed' | 'expired';
  attempts: number;
  resolved_outcome: boolean | null;
  resolve_sig: string | null;
  last_error: string | null;
}

export async function insertBinding(row: Partial<TxlineMarket>): Promise<TxlineMarket> {
  const s = sb();
  const res = await fetch(`${s.url}/rest/v1/txline_markets?on_conflict=market_pubkey`, {
    method: 'POST', headers: { ...s.headers, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row), cache: 'no-store',
  });
  if (!res.ok) throw new Error(`bind insert failed: ${res.status} ${await res.text()}`);
  return (await res.json())[0];
}

export const MAX_RESOLVE_ATTEMPTS = 5;

/** Atomic claim: armed -> resolving (one caller wins). */
export async function claimBinding(id: string, attempts: number): Promise<boolean> {
  const s = sb();
  const res = await fetch(`${s.url}/rest/v1/txline_markets?id=eq.${id}&status=eq.armed`, {
    method: 'PATCH', headers: { ...s.headers, Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'resolving', attempts: attempts + 1 }), cache: 'no-store',
  });
  if (!res.ok) return false;
  return ((await res.json()) as any[]).length > 0;
}

async function patch(id: string, body: Record<string, unknown>) {
  const s = sb();
  await fetch(`${s.url}/rest/v1/txline_markets?id=eq.${id}`, {
    method: 'PATCH', headers: { ...s.headers, Prefer: 'return=minimal' }, body: JSON.stringify(body), cache: 'no-store',
  });
}
export const markResolved = (id: string, outcome: boolean, sig: string) =>
  patch(id, { status: 'resolved', resolved_outcome: outcome, resolve_sig: sig, resolved_at: new Date().toISOString(), last_error: null });
export const markBindingFailed = (id: string, err: string) => patch(id, { status: 'failed', last_error: err.slice(0, 500) });
export const retryBinding = (id: string, err: string) => patch(id, { status: 'armed', last_error: err.slice(0, 500) });
// Reset a 'resolving' row left by a crashed pass.
export async function recoverStaleBindings(cutoffIso: string) {
  const s = sb();
  await fetch(`${s.url}/rest/v1/txline_markets?status=eq.resolving&updated_at=lt.${cutoffIso}`, {
    method: 'PATCH', headers: { ...s.headers, Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'armed' }), cache: 'no-store',
  });
}

// Give up-for-now 'failed' bindings a fresh attempts budget after a cooldown. Confirmed
// empirically (fixture 18241006, 2026-07) that a TimestampMismatch failure, which reads like
// TxLINE's own snapshot/Merkle-root generation lagging slightly behind game_finalised, clears
// on its own given enough elapsed time. A manual retry days later succeeded on its first
// attempt. Without this, exhausting MAX_RESOLVE_ATTEMPTS during that lag window (plausible
// right after a match ends, when the resolver races TxLINE's own backend) permanently strands
// the binding, since nothing else in this file ever revisits 'failed' rows. Terminal errors
// (MarketNotActive/already-resolved) never reach 'failed' via this path since resolveOnChain
// won't re-run against an already-settled market without erroring the same way again, so a
// cooldown retry costs at most a wasted keeper-fee attempt, not a wrong settlement.
export async function recoverFailedBindings(cutoffIso: string) {
  const s = sb();
  await fetch(`${s.url}/rest/v1/txline_markets?status=eq.failed&updated_at=lt.${cutoffIso}`, {
    method: 'PATCH', headers: { ...s.headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'armed', attempts: 0, last_error: null }), cache: 'no-store',
  });
}

export async function listBindings(filter: { scalarMarketId?: string; status?: string; fixtureId?: number; marketPubkey?: string } = {}): Promise<TxlineMarket[]> {
  const s = sb();
  const q: string[] = [];
  if (filter.scalarMarketId) q.push(`scalar_market_id=eq.${filter.scalarMarketId}`);
  if (filter.status) q.push(`status=eq.${filter.status}`);
  if (filter.fixtureId) q.push(`fixture_id=eq.${filter.fixtureId}`);
  if (filter.marketPubkey) q.push(`market_pubkey=eq.${filter.marketPubkey}`);
  const qs = q.length ? `&${q.join('&')}` : '';
  const res = await fetch(`${s.url}/rest/v1/txline_markets?select=*${qs}&order=created_at.desc`, { headers: s.headers, cache: 'no-store' });
  return res.ok ? await res.json() : [];
}
