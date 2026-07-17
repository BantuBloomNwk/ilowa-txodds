import { getVpsUrl } from '../api-client';

// The Elder's measurable forecasting track record (accuracy over settled markets).
const URL = 'https://dwqhnsdegjsgtixdwnoq.supabase.co/functions/v1/elder-calibration';

// Personalized, provenance-backed market picks: the Elder reads the live demargined market, shapes
// each position to the user's risk profile + budget, and (server-side) presents it in their language.
export type RiskProfile = 'careful' | 'balanced' | 'bold';
export interface ElderSource { book: string; impliedPct: number | null; fetchedAt: string; fixtureId: number }
export interface ElderPick {
  kind: string; question: string; impliedYes: number | null; analysis: string;
  fit: string; fitScore: number; suggestedStakeUsdc: number; potentialProfitUsdc: number;
  source: ElderSource | null;
}
export interface ElderPickFixture { fixtureId: number; home: string; away: string; startTime: number; shapedForYou: ElderPick[] }
export interface ElderPicksResponse { profile: { risk: RiskProfile; stakeUsdc: number; lang: string }; fixtures: ElderPickFixture[] }

export async function fetchElderPicks(opts: { risk: RiskProfile; stake: number; lang?: string; limit?: number }): Promise<ElderPicksResponse | null> {
  try {
    const p = new URLSearchParams({ risk: opts.risk, stake: String(opts.stake), lang: opts.lang || 'en', limit: String(opts.limit ?? 4) });
    const r = await fetch(`${getVpsUrl()}/api/txodds/elder/markets?${p.toString()}`);
    if (!r.ok) return null;
    return (await r.json()) as ElderPicksResponse;
  } catch {
    return null;
  }
}

// ---- Provable-CLV Elder: the verifiable track record (docs/specs/provable-clv-elder.md) ----
// The Elder commits its implied probability on-chain BEFORE a market closes; after settlement anyone
// recomputes closing-line value + calibration from public data. This reads that public ledger.
export interface ClvRecord {
  elder_version: string; n: number;
  meanClv: number | null; clvStdErr: number | null; clvCi95: [number, number] | null;
  brier: number | null; logLoss: number | null; baseRate: number | null;
  ineligible: number; pendingClose: number; pendingSettle: number;
}
export interface ClvRow {
  market_pubkey: string; fixture_id: number; kind: string; elder_version: string;
  p_implied: number; committed_at: string; committed_slot: number | null;
  close_time: string; close_line: number | null; close_slot: number | null;
  settled_outcome: boolean | null; resolve_sig: string | null;
  eligible: boolean; clv: number | null;
}
export interface ClvLedger { benchmark?: string; note?: string; records: ClvRecord[]; count: number; rows: ClvRow[] }

export async function fetchClvLedger(elderVersion?: string): Promise<ClvLedger | null> {
  try {
    const q = elderVersion ? `?elderVersion=${encodeURIComponent(elderVersion)}` : '';
    const r = await fetch(`${getVpsUrl()}/api/txodds/clv/ledger${q}`);
    if (!r.ok) return null;
    return (await r.json()) as ClvLedger;
  } catch {
    return null;
  }
}

export interface ElderCalibration {
  resolved: number;
  accuracy: number | null;
  hitRate: number | null;
}

export async function fetchElderCalibration(): Promise<ElderCalibration | null> {
  try {
    const r = await fetch(URL);
    const d = (await r.json()) as ElderCalibration & { ok?: boolean };
    return d.ok ? d : null;
  } catch {
    return null;
  }
}
