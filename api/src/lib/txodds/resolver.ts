/**
 * On-chain resolver: calls the deployed ilowa resolve_market_via_txline with a
 * TxLINE proof, signed by the server keeper key. Permissionless instruction, so
 * the keeper only pays the fee; the proof decides the outcome.
 *
 * Self-contained IDL (just the resolve instruction + txoracle types) so we don't
 * ship the whole program IDL. Keeper key read from env (dynamic, runtime).
 */
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import type { MatchResult } from './settlement';
import type { TxlineMarket } from './txMarkets';

const ILOWA_PROGRAM = 'HYDwFwax9U6svCRYWD7Fqq3TXxSSQCQ6CwKrb3ZTkD3z';
const TXORACLE = new PublicKey('6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J');
const readEnv = (k: string) => process.env[k] || '';

const T = (name: string) => ({ defined: { name } });
const VEC = (t: any) => ({ vec: t });
const IDL: any = {
  address: ILOWA_PROGRAM,
  metadata: { name: 'ilowa', version: '0.1.0', spec: '0.1.0' },
  instructions: [{
    name: 'resolve_market_via_txline',
    discriminator: [231, 115, 210, 246, 170, 6, 48, 37],
    accounts: [
      { name: 'keeper', writable: true, signer: true },
      { name: 'market', writable: true },
      { name: 'daily_scores_merkle_roots' },
      { name: 'txoracle_program' },
    ],
    args: [{ name: 'proof', type: T('TxlineProof') }],
  }, {
    name: 'finalize_conditional_vault',
    discriminator: [161, 163, 225, 17, 16, 139, 174, 4],
    accounts: [
      { name: 'cranker', writable: true, signer: true },
      { name: 'vault', writable: true },
      { name: 'market' },
    ],
    args: [],
  }],
  accounts: [],
  errors: [],
  types: [
    { name: 'ProofNode', type: { kind: 'struct', fields: [{ name: 'hash', type: { array: ['u8', 32] } }, { name: 'is_right_sibling', type: 'bool' }] } },
    { name: 'ScoreStat', type: { kind: 'struct', fields: [{ name: 'key', type: 'u32' }, { name: 'value', type: 'i32' }, { name: 'period', type: 'i32' }] } },
    { name: 'ScoresUpdateStats', type: { kind: 'struct', fields: [{ name: 'update_count', type: 'i32' }, { name: 'min_timestamp', type: 'i64' }, { name: 'max_timestamp', type: 'i64' }] } },
    { name: 'ScoresBatchSummary', type: { kind: 'struct', fields: [{ name: 'fixture_id', type: 'i64' }, { name: 'update_stats', type: T('ScoresUpdateStats') }, { name: 'events_sub_tree_root', type: { array: ['u8', 32] } }] } },
    { name: 'StatTerm', type: { kind: 'struct', fields: [{ name: 'stat_to_prove', type: T('ScoreStat') }, { name: 'event_stat_root', type: { array: ['u8', 32] } }, { name: 'stat_proof', type: VEC(T('ProofNode')) }] } },
    { name: 'Comparison', type: { kind: 'enum', variants: [{ name: 'GreaterThan' }, { name: 'LessThan' }, { name: 'EqualTo' }] } },
    { name: 'BinaryExpression', type: { kind: 'enum', variants: [{ name: 'Add' }, { name: 'Subtract' }] } },
    { name: 'TraderPredicate', type: { kind: 'struct', fields: [{ name: 'threshold', type: 'i32' }, { name: 'comparison', type: T('Comparison') }] } },
    { name: 'TxlineProof', type: { kind: 'struct', fields: [
      { name: 'ts', type: 'i64' }, { name: 'fixture_summary', type: T('ScoresBatchSummary') },
      { name: 'fixture_proof', type: VEC(T('ProofNode')) }, { name: 'main_tree_proof', type: VEC(T('ProofNode')) },
      { name: 'predicate', type: T('TraderPredicate') }, { name: 'stat_a', type: T('StatTerm') },
      { name: 'stat_b', type: { option: T('StatTerm') } }, { name: 'op', type: { option: T('BinaryExpression') } },
    ] } },
  ],
};

export function keeperLoaded(): boolean {
  try { return !!loadKeeper(); } catch { return false; }
}
function loadKeeper(): Keypair {
  const raw = readEnv('KEEPER_SECRET_KEY');
  if (!raw) throw new Error('KEEPER_SECRET_KEY not set');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

const cmp = (c: string) => ({ [c]: {} });

// @coral-xyz/anchor's Wallet export isn't a usable constructor in this build, so
// build the provider with a minimal adapter that signs with the keeper keypair.
function programFor(conn: Connection, keeper: Keypair): Program {
  const wallet: any = {
    publicKey: keeper.publicKey,
    payer: keeper,
    signTransaction: async (tx: any) => { tx.partialSign(keeper); return tx; },
    signAllTransactions: async (txs: any[]) => { txs.forEach((t) => t.partialSign(keeper)); return txs; },
  };
  return new Program(IDL, new AnchorProvider(conn, wallet, { commitment: 'confirmed' }));
}

/**
 * After resolving, finalize the conditional vault so winnings become redeemable.
 * Permissionless; pulls the outcome from the now-Resolved market. Returns the sig,
 * or null if the market has no vault (pari-mutuel) or it's already finalized.
 */
export async function finalizeVault(conn: Connection, marketPubkey: string): Promise<string | null> {
  const market = new PublicKey(marketPubkey);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('cvault'), market.toBuffer()], new PublicKey(ILOWA_PROGRAM));
  const info = await conn.getAccountInfo(vault);
  if (!info) return null; // not a CLOB market — nothing to finalize
  const keeper = loadKeeper();
  const program = programFor(conn, keeper);
  try {
    return await program.methods.finalizeConditionalVault().accounts({ cranker: keeper.publicKey, vault, market }).rpc();
  } catch (e: any) {
    if (/already|finalized|MarketAlreadyResolved/.test(e?.message || '')) return null; // already done
    throw e;
  }
}

/** Resolve one bound market on-chain from its settlement proof. Returns the tx sig. */
export async function resolveOnChain(conn: Connection, binding: TxlineMarket, result: MatchResult): Promise<string> {
  if (!result.proof) throw new Error('match not finished / no proof');
  const keeper = loadKeeper();
  const program = programFor(conn, keeper);

  // statA/statB are the proofs for the binding's keys, fetched in that order by matchResult
  // (statA = stat_key_a, statB = stat_key_b). Works for any keys: goals, corners, cards.
  const statA = result.proof.statA;
  const statB = binding.stat_key_b != null ? result.proof.statB : null;

  const proof = {
    ts: new BN(result.proof.ts),
    fixtureSummary: {
      fixtureId: new BN(result.proof.summary.fixtureId),
      updateStats: {
        updateCount: result.proof.summary.updateStats.updateCount,
        minTimestamp: new BN(result.proof.summary.updateStats.minTimestamp),
        maxTimestamp: new BN(result.proof.summary.updateStats.maxTimestamp),
      },
      eventsSubTreeRoot: result.proof.summary.eventsSubTreeRoot,
    },
    fixtureProof: result.proof.fixtureProof,
    mainTreeProof: result.proof.mainTreeProof,
    predicate: { threshold: binding.threshold, comparison: cmp(binding.comparison) },
    statA,
    statB,
    op: binding.op ? { [binding.op]: {} } : null,
  };

  const [roots] = PublicKey.findProgramAddressSync(
    [Buffer.from('daily_scores_roots'), new BN(result.epochDay!).toArrayLike(Buffer, 'le', 2)], TXORACLE);

  return program.methods.resolveMarketViaTxline(proof as any)
    .accounts({
      keeper: keeper.publicKey,
      market: new PublicKey(binding.market_pubkey),
      dailyScoresMerkleRoots: roots,
      txoracleProgram: TXORACLE,
    })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .rpc();
}
