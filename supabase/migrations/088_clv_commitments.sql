-- Provable-CLV Elder — prediction commitments (docs/specs/provable-clv-elder.md, phase 1).
--
-- One row per (market, elder_version): the Elder's implied probability p, committed
-- BEFORE the market closes and anchored to a finalized chain slot. After the match
-- settles we fill the closing line + outcome. Anyone can then recompute CLV +
-- calibration (Brier / log-loss) from public data. The single anti-backdating rule
-- is enforced at read time: a commitment is CLV-eligible only if committed_slot <
-- close_slot (equivalently committed_at < close_time).
--
-- Phase 1 is measure-only: no staking. The point is a track record a stranger can
-- verify, not a dashboard to trust. For an Elder that merely echoes the current
-- line, mean CLV is ~0 by construction — that is the honest, correct result, and
-- the same ledger will surface real edge if the Elder later earns it.

create table if not exists public.clv_commitments (
  id                  uuid primary key default gen_random_uuid(),
  market_pubkey       text not null,               -- on-chain Market PDA (links txline_markets)
  scalar_market_id    text,                         -- feed row for display
  fixture_id          bigint not null,
  kind                text not null,                -- home_win | away_win | over_2_5 ...
  elder_version       text not null,                -- attributes a track record to one Elder build
  -- COMMITMENT (recorded before close):
  p_implied           numeric not null,             -- 0..1 Elder implied prob of YES at commit
  committed_at        timestamptz not null default now(),
  committed_slot      bigint,                       -- finalized slot at commit (the "before close" anchor)
  committed_blockhash text,
  close_time          timestamptz not null,         -- market close (kickoff); the eligibility boundary
  -- CLOSE LINE (recorded at/near close):
  close_line          numeric,                      -- 0..1 de-vigged market implied prob at close
  close_slot          bigint,
  close_snapshot_at   timestamptz,
  -- SETTLEMENT (recorded after the match resolves):
  settled_outcome     boolean,                      -- YES/NO from the TxLINE-settled market
  settled_at          timestamptz,
  resolve_sig         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (market_pubkey, elder_version)
);

create index if not exists clv_commitments_fixture_idx on public.clv_commitments (fixture_id);
create index if not exists clv_commitments_open_idx on public.clv_commitments (close_time)
  where close_line is null;
create index if not exists clv_commitments_settle_idx on public.clv_commitments (market_pubkey)
  where settled_outcome is null;

-- Public read: the ledger is the whole point (no PII; commitment + close + outcome
-- are what a skeptic recomputes from). Writes go through the server (service role).
alter table public.clv_commitments enable row level security;
drop policy if exists clv_commitments_read on public.clv_commitments;
create policy clv_commitments_read on public.clv_commitments for select using (true);

create or replace function public.touch_clv_commitments_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists clv_commitments_touch on public.clv_commitments;
create trigger clv_commitments_touch before update on public.clv_commitments
  for each row execute function public.touch_clv_commitments_updated_at();
