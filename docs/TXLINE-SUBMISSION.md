# Ilowa: TxODDS World Cup Hackathon (Prediction Markets & Settlement)

Ilowa is a voice native SocialFi app for the Global South. For this track we built
one thing and built it properly: prediction markets that settle themselves on
Solana, straight from TxLINE's match data, with no admin and no oracle anyone has
to trust. The proof decides the result.

- Live app: https://app.ilowa.app  (open Markets, then a World Cup market)
- API: https://ilowa-api.fly.dev  (devnet)
- Program (devnet): `HYDwFwax9U6svCRYWD7Fqq3TXxSSQCQ6CwKrb3ZTkD3z`

## The idea

A prediction market is only as honest as the way it settles. Most of them lean on
an admin pressing a button or a price oracle, and football results have no honest
source on chain at all. TxLINE fixes exactly that part. The match data is rooted on
Solana, and anyone can prove a single stat with a Merkle proof. So we made our
market resolution a direct call into TxLINE's `validate_stat`. The proof decides
whether the answer is yes or no, not our server. A keeper can't lie about a result,
because a false claim simply won't verify.

## How it works, end to end (all live on devnet)

1. The Elder, our in app guide, reads TxLINE's demargined odds and turns each
   upcoming fixture into a market with a plain spoken take, like "Brazil are edged
   ahead at 57%, but Japan are live." The odds feed already gives the true implied
   probability, so the number is honest.
2. Markets stock themselves before kickoff. A scheduled job creates the market,
   opens an order book on chain, and ties it to the fixture and the exact stat
   predicate that settles it. That predicate is fixed when the market is made, so
   nobody can swap it later.
3. People trade yes or no with devnet SOL on a real order book.
4. When the match ends, a keeper pulls the TxLINE proof and calls
   `resolve_market_via_txline`. That instruction calls `validate_stat`, reads the
   boolean it returns, sets the outcome, and finalizes the vault so winners can
   cash out. Nobody decides the result by hand.
5. Every market shows a receipt: "Settled by TxLINE proof," with a link to the real
   resolve transaction you can open in a block explorer.

## What we are proud of

- The settlement is genuinely trustless. The instruction builds the `validate_stat`
  call, invokes the txoracle program, and trusts only the boolean it gets back. We
  proved the whole path on devnet against a finished World Cup match.
- Each market carries its own fixture and predicate, so the settlement is bound to
  the question, never chosen by whoever happens to resolve it.
- The outcome tokens live in a conditional vault on a Manifest order book, and the
  same market the proof resolves is the one the vault pays out from, so there is no
  gap between "settled" and "redeemable."
- Three small keepers keep it all moving on their own: one stocks markets, one
  settles finished ones, and one fires set and forget stop or take profit orders.
- The Elder's read is built on the demargined odds, so it is honest probability,
  not a guess.

## The Elder's edge, made checkable

There is a fair criticism of any prediction agent: it is cute until it beats the
closing line. So we made that checkable instead of asserting it. Before a market
closes, the Elder commits its implied probability on chain, anchored to a finalized
slot so it cannot be backdated. After the match settles by TxLINE proof, we record
the market's own closing line and the outcome. Anyone can then recompute the closing
line value and the calibration, Brier and log loss, from public data. Running
`scripts/verify-clv.mjs` reproduces the same numbers a stranger would, from the
ledger alone, not from a dashboard we ask you to trust.

An honest note, because a provable record that only shows wins is not provable.
Today the Elder quotes the demargined line, so its edge is near zero by construction,
and that is the correct result to show. The point of this phase is the verifiable
record, not a fabricated edge. The same ledger surfaces real edge only if the Elder
earns it, from in play latency on the TxLINE feed or from softer markets, and it will
show the losses too. Public ledger: `GET /api/txodds/clv/ledger`. Design:
`docs/specs/provable-clv-elder.md`.

## TxLINE endpoints we used

Auth and subscription (devnet, free World Cup tier, no TxL needed):
- `subscribe(service_level_id = 1, weeks)` on the txoracle program, on chain
- `POST /auth/guest/start` for a guest JWT
- `POST /api/token/activate` to trade the subscribe transaction for an API token

Data (both headers required: `Authorization: Bearer <jwt>` and `X-Api-Token: <token>`):
- `GET /api/fixtures/snapshot?competitionId=72` for World Cup fixtures
- `GET /api/odds/snapshot/{fixtureId}` for the demargined odds the Elder shapes from
- `GET /api/scores/snapshot/{fixtureId}` for the match event and score stream
- `GET /api/scores/stat-validation?fixtureId&seq&statKey&statKey2` for the Merkle
  proof bundle (timestamp, fixture summary, the stat proofs, and the sub tree and
  main tree proofs)

Settlement, on chain:
- `validate_stat` on the txoracle program, called from our program against the
  `daily_scores_roots` account

Devnet host: `https://txline-dev.txodds.com`

## Our experience with the TxLINE API

What we liked most. The free World Cup tier made it genuinely easy to get going:
subscribe on chain, activate, build. The demargined odds were a real gift, the
implied probability sits right there in the response, so we didn't have to strip a
bookmaker margin to show an honest number. And `validate_stat` is the right
primitive. Returning a boolean from a verified proof let us make settlement a single
clean call, and we love that the proof is the source of truth rather than some
privileged caller. That is the whole reason we entered this track.

Where we hit friction.
- `oracle-dev.txodds.com` is dead, its DNS no longer resolves, but the docs and the
  example scripts still point at it. We only found the working devnet host,
  `txline-dev.txodds.com`, by probing. That one is worth fixing first.
- The IDL shipped in the repo is the mainnet one (v1.4.7) while devnet runs v1.5.2,
  and the devnet TxL mint is different from what a few docs list. Using the mainnet
  IDL against devnet gives discriminator and account mismatches. The devnet IDL is
  only embedded in a docs page, not shipped as a file.
- The `examples/subscription` scripts the README mentions actually live under a
  `backup` folder, which took us a while to find.
- The data calls need both the JWT and the API token headers together. The
  quickstart made it look like either one alone might work.
- We couldn't find the `validate_stat` return behaviour written down anywhere (does
  a false predicate revert, or come back false?). We confirmed by testing that it
  returns a boolean and a false claim does not revert, which is exactly what we
  wanted, but it would save the next team an hour to say so.

None of these stopped us, the core is solid. A devnet quickstart that matches the
live hosts, the right IDL, and the right mints would get the next team to "settled
on chain" in an afternoon.
