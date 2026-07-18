// Precision (scalar/proximity) markets, client. Browse markets + place a staked
// forecast: the wallet transfers the stake to the vault (the pool), then we record
// the forecast (verified server-side). See proximity.ts + the forecast edge fn.
import { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, ComputeBudgetProgram } from '@solana/web3.js';
import { getSupabase } from '../supabase/client';
import { authedFetch } from '../auth/session';
import { getVpsUrl } from '../api-client';

export const VAULT_PUBKEY = new PublicKey('258wMFhH7AxQdU7GGS6qwyttVvkw2stEBUXGqmymPyAt');
const FORECAST_URL = 'https://dwqhnsdegjsgtixdwnoq.supabase.co/functions/v1/forecast';
const AUTHOR_URL = 'https://dwqhnsdegjsgtixdwnoq.supabase.co/functions/v1/market-author';

export interface MarketDraft {
  question: string;
  type: string; // 'scalar' | 'binary' | 'categorical'
  options: string[] | null;
  unit: string | null;
  resolution_source: string;
  oracle_feed: string | null;
  band: number | null;
  band_fraction: number;
  elder_forecast: number | null;
  elder_low: number | null;
  elder_high: number | null;
  elder_rationale: string | null;
  resolve_time: string;
  close_time: string;
  region: string | null;
}

/** The Elder structures a natural-language question into a market (preview, not saved). */
export async function previewMarket(text: string, region?: string | null): Promise<{ market?: MarketDraft; error?: string }> {
  try {
    const res = await fetch(AUTHOR_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'preview', text, region }) });
    const d = (await res.json().catch(() => ({}))) as { market?: MarketDraft; error?: string };
    return { market: d.market, error: d.error };
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
}

export async function createMarket(market: MarketDraft, wallet?: string | null): Promise<{ id?: string; error?: string }> {
  try {
    // authedFetch attaches the wallet session token so the edge fn can bind
    // created_by to the verified wallet (Phase-2 SEC-2). `wallet` stays in the
    // body only as the observe-mode fallback until enforcement is flipped on.
    const res = await authedFetch(AUTHOR_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'create', market, wallet }) });
    const d = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    return { id: d.id, error: d.error };
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
}

/**
 * Guarded self-serve: turn a just-created feed market into a tradeable CLOB. The
 * server (keeper) creates the on-chain market + vault + Manifest book (WSOL
 * collateral) and links it; gated server-side by invite/allowlist. The wallet
 * token is attached by authedFetch.
 */
export async function enableClobForMarket(scalarMarketId: string, question: string, wallet?: string | null): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await authedFetch(`${getVpsUrl()}/api/clob/market/self-enable`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scalarMarketId, question, wallet }),
    });
    const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return { ok: !!d.ok, error: d.error };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

export interface ScalarMarket {
  id: string;
  question: string;
  type: string; // 'scalar' | 'binary' | 'categorical'
  options: string[] | null;
  unit: string | null;
  resolution_source: string;
  band: number | null;
  band_fraction: number;
  elder_forecast: number | null;
  elder_low: number | null;
  elder_high: number | null;
  elder_rationale: string | null;
  close_time: string;
  resolve_time: string;
  status: string;
  total_staked: number;
  forecast_count: number;
  consensus: number | null;
  category: string | null;
  actual_value: number | null;
  created_at: string;
  escalated?: boolean;
  dispute_until?: string | null;
  dispute_reason?: string | null;
  disputed_by?: string | null;
}

export async function fetchScalarMarkets(): Promise<ScalarMarket[]> {
  const supa = getSupabase();
  if (!supa) return [];
  const { data } = await supa
    .from('scalar_markets')
    .select('*')
    .eq('status', 'open')
    .order('resolve_time', { ascending: true });
  return (data as ScalarMarket[]) ?? [];
}

/** Proximity score if the market resolved at `assumedActual`, drives the live hint. */
export function estimateScore(value: number, assumedActual: number, m: ScalarMarket): number {
  const band = m.band ?? Math.max(Math.abs(assumedActual) * (m.band_fraction || 0.02), 1e-6);
  if (band <= 0) return value === assumedActual ? 1 : 0;
  return Math.exp(-Math.pow((value - assumedActual) / band, 2));
}

/** The +/- tolerance where you still earn meaningfully (one band), for display. */
export function toleranceFor(m: ScalarMarket, reference: number): number {
  return m.band ?? Math.abs(reference) * (m.band_fraction || 0.02);
}

export type ForecastStage = 'signing' | 'recording';

export async function placeForecast(opts: {
  wallet: { publicKey: PublicKey | null; signAndSendTransaction: (b: (s: PublicKey) => Promise<Transaction>) => Promise<string> };
  market: ScalarMarket;
  value: number;
  stakeSol: number;
  region?: string | null;
  onStage?: (s: ForecastStage) => void;
}): Promise<{ ok: boolean; error?: string }> {
  const pk = opts.wallet?.publicKey ?? null;
  if (!pk) return { ok: false, error: 'Connect your wallet first' };
  const lamports = Math.floor(opts.stakeSol * LAMPORTS_PER_SOL);
  if (lamports <= 0) return { ok: false, error: 'Enter a stake amount' };
  if (!isFinite(opts.value)) return { ok: false, error: 'Enter your forecast' };
  try {
    opts.onStage?.('signing');
    const sig = await opts.wallet.signAndSendTransaction(async (signer: PublicKey) =>
      new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 }))
        .add(SystemProgram.transfer({ fromPubkey: signer, toPubkey: VAULT_PUBKEY, lamports })),
    );
    opts.onStage?.('recording');
    const res = await fetch(FORECAST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        market_id: opts.market.id, value: opts.value, stake: lamports,
        wallet: pk.toBase58(), stakeTxSig: sig, region: opts.region ?? null,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return { ok: !!data.ok, error: data.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Calibration leaderboard ───────────────────────────────────────────────────
// Forecasters ranked by average proximity score over SETTLED markets — the skill
// reputation. Reads the Fly api (forecasts is service-role only). Empty until
// markets resolve (the settlement cron populates scores).
export interface CalibrationLeader {
  rank: number;
  wallet: string;
  settled: number; // settled forecasts counted
  calibration: number; // avg proximity, 0..100
  winRate: number; // % of settled forecasts that paid out
  winnings: number; // lamports won
}

export async function fetchCalibrationLeaderboard(
  opts: { days?: number; limit?: number; wallet?: string } = {},
): Promise<{ leaders: CalibrationLeader[]; me: CalibrationLeader | null; total: number }> {
  const p = new URLSearchParams();
  if (opts.days) p.set('days', String(opts.days));
  if (opts.limit) p.set('limit', String(opts.limit));
  if (opts.wallet) p.set('wallet', opts.wallet);
  try {
    const res = await fetch(`${getVpsUrl()}/api/markets/calibration?${p.toString()}`);
    const d = await res.json().catch(() => ({}));
    return { leaders: (d.leaders as CalibrationLeader[]) || [], me: (d.me as CalibrationLeader) || null, total: d.total || 0 };
  } catch {
    return { leaders: [], me: null, total: 0 };
  }
}

/** Live stake-weighted crowd consensus per open market (market_id → value).
 *  Computed server-side from the service-role forecasts table. */
export async function fetchConsensus(): Promise<Record<string, number>> {
  try {
    const res = await fetch(`${getVpsUrl()}/api/markets/consensus`);
    const d = await res.json().catch(() => ({}));
    return (d.consensus as Record<string, number>) || {};
  } catch {
    return {};
  }
}

export interface MarketReceipt { sig: string; outcome: boolean | null }

/** On-chain settlement signature per resolved World Cup market (market_id → receipt). */
export async function fetchReceipts(): Promise<Record<string, MarketReceipt>> {
  try {
    const res = await fetch(`${getVpsUrl()}/api/markets/receipts`);
    const d = await res.json().catch(() => ({}));
    return (d.receipts as Record<string, MarketReceipt>) || {};
  } catch {
    return {};
  }
}

// ── Manual settlement (owner) ─────────────────────────────────────────────────
const ADMIN_RESOLVE_URL = 'https://dwqhnsdegjsgtixdwnoq.supabase.co/functions/v1/admin-resolve';

/** Markets past resolve_time that need a human outcome (not Pyth, no value yet). */
export async function fetchMarketsAwaitingResolution(): Promise<ScalarMarket[]> {
  const supa = getSupabase();
  if (!supa) return [];
  const { data } = await supa
    .from('scalar_markets')
    .select('*')
    .neq('status', 'settled')
    .is('actual_value', null)
    .in('resolution_source', ['elder', 'manual', 'switchboard'])
    .lte('resolve_time', new Date().toISOString())
    .order('resolve_time', { ascending: true });
  return (data as ScalarMarket[]) ?? [];
}

/** Owner-only: set a market's actual value → settles + auto-pays via resolve-market.
 *  The owner wallet session token is verified server-side (admin-resolve). */
export async function adminResolve(marketId: string, actualValue: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await authedFetch(ADMIN_RESOLVE_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market_id: marketId, actual_value: actualValue }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Owner only.' };
    return { ok: !!d.ok, error: d.ok ? undefined : (d.result?.error || d.error || 'failed') };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** Owner-only: uphold a market's EXISTING resolution → finalize + pay (uphold a
 *  dispute, or finalize early before the window passes). */
export async function adminUphold(marketId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await authedFetch(ADMIN_RESOLVE_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market_id: marketId, action: 'uphold' }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Owner only.' };
    return { ok: !!d.ok, error: d.ok ? undefined : (d.result?.error || d.error || 'failed') };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** The admin dispute/escalation queue: markets escalated (need a value), under
 *  dispute (need review), or optimistically resolved (in their dispute window). */
export async function fetchDisputeQueue(): Promise<ScalarMarket[]> {
  const supa = getSupabase();
  if (!supa) return [];
  const { data } = await supa
    .from('scalar_markets')
    .select('*')
    .or('escalated.eq.true,status.in.(resolved,disputed)')
    .neq('status', 'settled')
    .order('resolve_time', { ascending: true });
  return (data as ScalarMarket[]) ?? [];
}

/** Markets in their dispute window (optimistically resolved, not yet final) —
 *  shown to participants so they can contest the outcome before payout. */
export async function fetchResolvingMarkets(): Promise<ScalarMarket[]> {
  const supa = getSupabase();
  if (!supa) return [];
  const { data } = await supa
    .from('scalar_markets')
    .select('*')
    .eq('status', 'resolved')
    .gt('dispute_until', new Date().toISOString())
    .order('dispute_until', { ascending: true });
  return (data as ScalarMarket[]) ?? [];
}

const DISPUTE_URL = 'https://dwqhnsdegjsgtixdwnoq.supabase.co/functions/v1/dispute-market';

/** A participant contests an optimistically-resolved market during its window. */
export async function raiseDispute(marketId: string, reason: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const res = await authedFetch(DISPUTE_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market_id: marketId, reason }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.status === 401) return { ok: false, error: 'Connect your wallet to dispute.' };
    if (res.status === 403) return { ok: false, error: d.error || 'Only a participant can dispute.' };
    return { ok: !!d.ok, message: d.message, error: d.ok ? undefined : (d.error || 'failed') };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
