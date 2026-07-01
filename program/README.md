# On-chain settlement (excerpt)

These are the market and settlement instructions from the `ilowa` Anchor program,
deployed on Solana devnet at `HYDwFwax9U6svCRYWD7Fqq3TXxSSQCQ6CwKrb3ZTkD3z`. They are
pulled out of the full program so the settlement logic can be read on its own; this
folder is a reading copy, not a standalone crate.

- `instructions/create_market.rs` — open a market.
- `instructions/conditional_vault.rs` — init the vault, split/merge collateral into
  matched YES/NO outcome tokens, finalize to the resolved outcome, and redeem the
  winning token 1:1 for collateral.
- `instructions/resolve_market.rs` — the direct resolution path.
- `instructions/resolve_market_via_txline.rs` — the trustless path: CPI into TxLINE's
  `validate_stat` with the three-stage Merkle proof; the returned boolean sets the
  market outcome. No admin key decides the result.
- `instructions/claim_winnings.rs` — pay out the winning side.
- `state/market.rs`, `state/conditional_vault.rs` — the account layouts.
