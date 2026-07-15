# Provable-CLV Elder

Status: spec, 2026-07-09. Answers the "it's cute until it beats closing lines" critique by making the Elder's edge measurable and un-fakeable, not asserted.

## 1. The benchmark

Closing line value (CLV) is the accepted proxy for betting skill. The closing line is the market's most efficient, highest-liquidity probability estimate, so systematically getting a better price than the close means you had genuine predictive edge at the price you took. An agent that reads and echoes the current line has zero edge by construction. The only claim worth making is:

> The Elder's probability at time t predicts the closing line and the settled outcome better than the market's price at t does.

Everything below exists to state that claim in a form a stranger can verify without trusting us.

## 2. Core mechanism: commit before close, verify after settle

The invention is provenance applied to predictions.

1. **Commit.** When the Elder forms a probability p for a market outcome, it writes a commitment on-chain BEFORE the market closes: the market id, the Elder model version, the implied probability p (and for scalar markets the forecast value plus interval), and the finalized chain time (slot, blockhash). This is a timestamped, tamper-evident record that cannot be backdated.
2. **Settle.** After the event resolves, the settled outcome and the market's own closing line are recorded (TxLINE stat via the existing validate_stat path for sports, oracle for price markets).
3. **Verify.** Anyone recomputes CLV and calibration from the committed predictions and the settled closes. The number is reproducible from public data. No dashboard to trust.

The result is a cryptographically provable CLV track record: "the Elder beat the close by X percent over N timestamped predictions." Tipster bots and sportsbooks structurally cannot show this, because their predictions are not committed before close in a way a third party can audit.

## 3. On-chain data model

A prediction-commitment record per (market, elder_version), created before close:

- `market_id`
- `elder_version` (model + feature-set hash, so a track record is attributable to a specific Elder build)
- `p_implied` (fixed-point; for scalar markets: `forecast_value`, `interval_low`, `interval_high`)
- `committed_slot`, `committed_blockhash` (finalized chain time = the anchor that proves "before close")
- `features_root` (optional: a hash of the input snapshot the Elder used, so the reasoning is later auditable without revealing the live feed in real time)

Settlement record per market:

- `close_line` (the market's own closing implied probability, de-vigged)
- `settled_value` / `settled_outcome`
- `resolve_slot`, `resolve_source` (txline | pyth | switchboard | admin)

Constraint: the commitment must land while `committed_slot < close_slot`. A commitment that arrives at or after close is ineligible for CLV scoring. This is the single rule that stops backdating.

## 4. The metric

Benchmark against OUR OWN book's close, not an external sportsbook, because the Elder's counterparties are Ilowa users on the CLOB, not a sharp book's risk desk.

- **CLV per prediction:** `clv = p_implied - close_line` (in probability), or the odds-space equivalent. Positive mean CLV over a large sample is the edge signal.
- **Calibration:** Brier score and log-loss of `p_implied` against `settled_outcome`. CLV says "we beat the price"; calibration says "our probabilities are honest." Report both. An agent can beat CLV on a biased sample yet be miscalibrated, so neither alone is sufficient.
- **Proximity (scalar markets):** reuse the shipped Gaussian proximity score (`app/src/lib/markets/proximity.ts`) between `forecast_value` and `settled_value`.
- Aggregate per `elder_version` with confidence intervals. A track record with N below a few hundred is noise; say so.

## 5. Where the edge actually comes from

Real, beatable CLV is narrow and perishable. Hunt it where it exists:

- **In-play latency.** Reacting to a red card, injury, lineup, or weather shift faster than the market re-prices. This is the largest available edge and the one that uses TxLINE's live stat feed directly. It is real ONLY if TxLINE is genuinely faster or richer than the market's own feed. If it is not, this edge does not exist and no model recovers it.
- **Soft markets.** Lower leagues, props, in-play micro-markets, and scalar/proximity markets are far less efficient than the majors. Point the Elder there.
- **Do not** try to beat efficient pre-match major lines. Do not trust "non-obvious correlations the model found"; most are spurious and the market ignored them correctly. Treat any backtest edge as a hypothesis until it survives out-of-sample.

## 6. Anti-self-deception guardrails (non-negotiable)

- De-vig the close before comparing (compare true probabilities, not the book's padded price).
- Out-of-sample and walk-forward validation only; no in-sample CLV claims.
- Fractional-Kelly staking when the Elder actually takes positions.
- Freeze `elder_version` per track record; changing the model starts a new record. No survivorship by silently swapping models.
- Publish the losing runs too. A provable record that only shows wins is not provable, it is curated.

## 7. Third-party verification flow

A skeptic runs, from public chain data alone:

1. Pull all prediction commitments for an `elder_version` where `committed_slot < close_slot`.
2. Pull the matching settlement records (close line + outcome).
3. Recompute mean CLV, Brier, log-loss, proximity, with intervals.
4. Confirm no commitment was timestamped at or after its market's close.

If the numbers reproduce, the edge is real. That is the whole point: the claim is checkable, not marketed.

## 8. Reuse map (what already exists)

- Elder forecast at authoring time (`market-author` stores `elder_forecast` + low/high + rationale).
- Calibration function (`elder-calibration`) and the proximity scoring engine.
- TxLINE settlement via the `validate_stat` CPI (sports outcomes) and Pyth/Switchboard for price markets.
- On-chain provenance and finalized-time anchoring (the same primitive PoR uses to timestamp against slot + blockhash).
- The CLOB + vault for actually taking positions.

The new build is small: the pre-close commitment record, the eligibility rule (`committed_slot < close_slot`), and the verification recompute. The rest is wiring.

## 9. Build phases

1. **MVP (measure, do not stake):** commit `p_implied` before close for the sports markets TxLINE already feeds; record close line + outcome; compute CLV + Brier off-chain; expose a read-only verifiable ledger. This alone answers the critic.
2. **On-chain commitments:** move the pre-close commitment on-chain (finalized-time anchored) so the "before close" claim is trustless, not server-attested.
3. **Act on the edge:** the Elder takes fractional-Kelly positions on the CLOB only in the market classes where phase 1 showed positive, calibrated CLV.
4. **Publish the record:** a public, reproducible CLV + calibration page per `elder_version`, wins and losses.

***REMOVED***


