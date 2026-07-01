/**
 * Data layer for set-and-forget CLOB stop / take-profit triggers.
 *
 * Talks to Supabase via PostgREST with the service-role key (same pattern as the
 * metrics route), so the table stays server-only. The keeper claims a row
 * atomically by flipping status armed -> firing with a status=eq.armed filter:
 * only one pass can win that PATCH, so overlapping passes never double-submit.
 */
const URL = process.env.SUPABASE_URL || '';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export type TriggerKind = 'stop' | 'takeProfit';
export interface TriggerRow {
  id: string;
  owner: string;
  market: string;
  scalar_market_id: string | null;
  kind: TriggerKind;
  side: 'buy' | 'sell';
  trigger_price: number;
  size: number;
  nonce_pubkey: string;
  signed_tx: string;
  status: 'armed' | 'firing' | 'fired' | 'revoked' | 'expired' | 'failed';
  attempts: number;
  fired_sig: string | null;
  last_error: string | null;
  created_at: string;
  fired_at: string | null;
}

export const MAX_ATTEMPTS = 5;

function headers(extra: Record<string, string> = {}) {
  return { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...extra };
}
function base() {
  if (!URL || !KEY) throw new Error('Supabase service env not configured');
  return `${URL}/rest/v1/clob_triggers`;
}

export async function insertTrigger(row: Partial<TriggerRow>): Promise<TriggerRow> {
  const res = await fetch(base(), {
    method: 'POST', headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(row), cache: 'no-store',
  });
  if (!res.ok) throw new Error(`insert failed: ${res.status} ${await res.text()}`);
  return (await res.json())[0];
}

// Owner-facing list: never leak the raw signed bytes.
export async function listByOwner(owner: string): Promise<Omit<TriggerRow, 'signed_tx'>[]> {
  const cols = 'id,owner,market,scalar_market_id,kind,side,trigger_price,size,nonce_pubkey,status,attempts,fired_sig,last_error,created_at,fired_at';
  const res = await fetch(`${base()}?owner=eq.${owner}&select=${cols}&order=created_at.desc`, {
    headers: headers(), cache: 'no-store',
  });
  return res.ok ? await res.json() : [];
}

// Keeper: every still-active trigger (armed + any in-flight firing), with bytes.
export async function listActive(): Promise<TriggerRow[]> {
  const res = await fetch(`${base()}?status=in.(armed,firing)&select=*`, { headers: headers(), cache: 'no-store' });
  return res.ok ? await res.json() : [];
}

// Reset rows stuck in 'firing' (a pass that crashed mid-fire) back to armed.
export async function recoverStale(cutoffIso: string): Promise<void> {
  await fetch(`${base()}?status=eq.firing&updated_at=lt.${cutoffIso}`, {
    method: 'PATCH', headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ status: 'armed' }), cache: 'no-store',
  });
}

// Atomic claim: succeeds for exactly one caller (status=eq.armed filter).
export async function claim(id: string, attempts: number): Promise<boolean> {
  const res = await fetch(`${base()}?id=eq.${id}&status=eq.armed`, {
    method: 'PATCH', headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify({ status: 'firing', attempts: attempts + 1 }), cache: 'no-store',
  });
  if (!res.ok) return false;
  return ((await res.json()) as any[]).length > 0;
}

export async function markFired(id: string, sig: string): Promise<void> {
  await fetch(`${base()}?id=eq.${id}`, {
    method: 'PATCH', headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ status: 'fired', fired_sig: sig, fired_at: new Date().toISOString(), last_error: null }),
    cache: 'no-store',
  });
}

export async function markFailed(id: string, err: string): Promise<void> {
  await fetch(`${base()}?id=eq.${id}`, {
    method: 'PATCH', headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ status: 'failed', last_error: err.slice(0, 500) }), cache: 'no-store',
  });
}

// Transient failure before the tx hit the chain: hand it back for another pass.
export async function retry(id: string, err: string): Promise<void> {
  await fetch(`${base()}?id=eq.${id}`, {
    method: 'PATCH', headers: headers({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ status: 'armed', last_error: err.slice(0, 500) }), cache: 'no-store',
  });
}

export async function revoke(id: string, owner: string): Promise<boolean> {
  const res = await fetch(`${base()}?id=eq.${id}&owner=eq.${owner}&status=in.(armed,firing)`, {
    method: 'PATCH', headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify({ status: 'revoked' }), cache: 'no-store',
  });
  if (!res.ok) return false;
  return ((await res.json()) as any[]).length > 0;
}

// Server-side mirror of the app's evalTrigger (manifest-writer.ts): a stop fires
// when price falls to/through the level, a take-profit when it rises to/through it.
export function shouldFire(kind: TriggerKind, mid: number, triggerPrice: number): boolean {
  return kind === 'stop' ? mid <= triggerPrice : mid >= triggerPrice;
}
