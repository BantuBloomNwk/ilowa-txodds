/**
 * GET /api/txodds/clv/ledger?elderVersion=&fixtureId=
 *
 * The verifiable CLV track record (docs/specs/provable-clv-elder.md §7). Public,
 * read-only: returns every prediction commitment (the Elder's pre-close implied
 * prob + finalized-slot anchor), the market's closing line, and the settled
 * outcome, PLUS the aggregate CLV + calibration (Brier / log-loss) per
 * elder_version. A skeptic can recompute every number from the `rows` alone — the
 * aggregate is a convenience, not something to trust. Losers are included; a
 * curated record is not a provable one.
 */
import { NextRequest, NextResponse } from 'next/server';
import { listCommitments } from '../../../../../lib/txodds/clv';
import { aggregate, isEligible, clv, type ScoredRow } from '../../../../../lib/txodds/clv-metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const elderVersion = url.searchParams.get('elderVersion') || undefined;
  const fixtureId = url.searchParams.get('fixtureId');
  try {
    const commitments = await listCommitments({ elderVersion, fixtureId: fixtureId ? Number(fixtureId) : undefined });

    // Group by elder_version so each build gets its own frozen track record.
    const byVersion = new Map<string, ScoredRow[]>();
    for (const c of commitments) {
      const row: ScoredRow = {
        p_implied: Number(c.p_implied),
        close_line: c.close_line == null ? null : Number(c.close_line),
        settled_outcome: c.settled_outcome,
        committed_slot: c.committed_slot, close_slot: c.close_slot,
        committed_at: c.committed_at, close_time: c.close_time,
      };
      if (!byVersion.has(c.elder_version)) byVersion.set(c.elder_version, []);
      byVersion.get(c.elder_version)!.push(row);
    }
    const records = [...byVersion.entries()].map(([elder_version, rows]) => ({ elder_version, ...aggregate(rows) }));

    // Per-row detail the verifier reproduces the aggregate from.
    const rows = commitments.map((c) => {
      const r: ScoredRow = {
        p_implied: Number(c.p_implied), close_line: c.close_line == null ? null : Number(c.close_line),
        settled_outcome: c.settled_outcome, committed_slot: c.committed_slot, close_slot: c.close_slot,
        committed_at: c.committed_at, close_time: c.close_time,
      };
      return {
        market_pubkey: c.market_pubkey, fixture_id: c.fixture_id, kind: c.kind, elder_version: c.elder_version,
        p_implied: Number(c.p_implied), committed_at: c.committed_at, committed_slot: c.committed_slot,
        close_time: c.close_time, close_line: c.close_line == null ? null : Number(c.close_line), close_slot: c.close_slot,
        settled_outcome: c.settled_outcome, resolve_sig: c.resolve_sig,
        eligible: isEligible(r),
        clv: r.close_line != null ? clv(Number(c.p_implied), r.close_line) : null,
      };
    });

    return NextResponse.json({
      benchmark: "Elder's committed implied probability vs its own market's de-vigged closing line",
      note: 'Measure-only (phase 1). Positive mean CLV with N in the hundreds is edge; small N is noise.',
      records, count: rows.length, rows,
    }, { headers: { 'cache-control': 'public, max-age=30' } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'clv ledger failed' }, { status: 500 });
  }
}
