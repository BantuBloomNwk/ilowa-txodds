# Ilowa — Prediction Markets & Settlement (TxODDS World Cup)

Prediction markets that settle themselves on Solana from TxLINE match data, with no
admin and no oracle to trust. When a match ends, a keeper pulls the TxLINE Merkle
proof and our on-chain program calls `validate_stat`. The proof decides the outcome
and the market pays out, so no one can fake a result.

This is our entry for the TxODDS World Cup hackathon, **Prediction Markets &
Settlement** track.

## Try it live

- **App:** https://app.ilowa.app — open Markets, pick a World Cup market. You'll see
  the Elder's read on the odds, a live two-sided order book (back Yes or No), and a
  "Settled by TxLINE proof" receipt that links to the real resolve transaction.
- **API (devnet):** https://ilowa-api.fly.dev
- **Program (devnet):** `HYDwFwax9U6svCRYWD7Fqq3TXxSSQCQ6CwKrb3ZTkD3z`
- **Demo video:** _add link_

## How settlement works

1. The Elder shapes a market for an upcoming fixture (result, or total goals) and
   opens a Manifest order book against a conditional vault. The book's mid price is
   the live implied probability.
2. People trade the outcome tokens. Backing **Yes** buys the YES token; backing
   **No** splits collateral into YES + NO and sells the YES, so you hold NO.
3. When the match is finished and rooted upstream, a keeper (or anyone) calls the
   settlement path. It fetches the TxLINE proof for that fixture and our program
   runs `resolve_market_via_txline`, which CPIs into TxLINE's `validate_stat` with
   the three-stage Merkle proof. The returned boolean sets `market.outcome`.
4. The conditional vault finalizes to mirror that outcome, and the winning token
   redeems 1:1 for collateral.

The point of the track is settlement, and the whole loop rests on TxLINE being the
source of truth. Because the proof is verified on-chain, a result cannot be faked,
and settlement is permissionless: the caller pays the fee, the proof decides the
outcome. See **[docs/TXLINE-SUBMISSION.md](docs/TXLINE-SUBMISSION.md)** for the exact
endpoints we used, the demargined-odds handling, the proof format, and our honest
feedback on the API.

## Verified on-chain

A real on-demand settlement from this build (devnet):

- `resolve_market_via_txline` →
  [`457JEEKZfyPc4o7PLHTVWbij23R1Xpbm27gnsh45YqKsHy3kEait2N36WMWeaHUgKbwk4Rbq88EXHKdQvTMiJTjd`](https://explorer.solana.com/tx/457JEEKZfyPc4o7PLHTVWbij23R1Xpbm27gnsh45YqKsHy3kEait2N36WMWeaHUgKbwk4Rbq88EXHKdQvTMiJTjd?cluster=devnet)

Every resolved market in the app links its own resolve transaction from the receipt.

## What's in this repo

This is a focused extract of the settlement system from our larger product. The
running product is the live app above; here we've pulled together the code that
implements the markets and the TxLINE settlement so it can be read end to end.

```
program/        the on-chain settlement instructions (excerpt, Anchor / Rust)
  instructions/ create_market, conditional_vault, resolve_market,
                resolve_market_via_txline, claim_winnings
  state/        market + conditional-vault account layouts
api/            the settlement backend (Next.js route handlers + libs)
  src/lib/txodds/   feed, settlement proofs, resolver, predicate builder, Elder odds
  src/lib/clob/     conditional-vault + Manifest book wiring, server-side triggers
  src/app/api/      HTTP endpoints: fixtures, seed, settle, order/book/withdraw, cron
app/            the markets client (excerpt, React Native / Expo)
  components/markets/  the order panel (Yes / No / settle) and the TxLINE receipt
  lib/markets/         order + book orchestration, conditional-token client
  lib/solana/          raw instruction builders (no SDK in the app bundle)
scripts/        book-seeding helpers used to stand up demo liquidity
```

The Rust in `program/` is excerpted from the full `ilowa` program deployed at the ID
above; these are the market and settlement instructions, without the rest of the
program's surface.

## Running the backend

The API is a set of Next.js route handlers. It needs, at minimum:

- `SOLANA_RPC_URL` — a devnet RPC
- `TXODDS_API_TOKEN` — a TxLINE devnet data token (falls back to a small simulated
  fixture set when absent, so it runs with no secret)
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — market and binding storage
- `KEEPER_SECRET_KEY` — the wallet that pays for resolve transactions

The settlement keeper is one pass per call: `GET /api/cron/txline-resolver` finds
armed market-to-fixture bindings whose match has finished, fetches the proof, and
resolves them on-chain. A single market can be settled on demand with
`POST /api/txodds/market/resolve { marketPubkey }`.

## Notes

We run on Solana devnet. Where the live feed doesn't yet have a finished, rooted
result for a fixture, the app falls back to simulated data for the walkthrough, which
the contest allows. The settlement path itself is real and on-chain, as the
transaction above shows.

## License

MIT. See [LICENSE](LICENSE).
