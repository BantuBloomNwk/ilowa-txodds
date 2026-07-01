/**
 * Conditional-token CLOB client (outcome tokens) for the Ilowa markets surface.
 *
 * Wraps the on-chain conditional-vault instructions (init/split/merge/finalize/
 * redeem) into wallet-driven actions. Uses ONLY raw instruction builders from
 * solana/market-writer (no Anchor Program — that blows the Hermes stack on the
 * native APK — and no @solana/spl-token at module scope), so every function here
 * works identically on the PWA and the native Android build.
 *
 * Flow: a market's vault mints matched YES/NO SPL tokens against collateral
 * (split). Those YES tokens are what trade on the Manifest order book (P2b); the
 * book's mid price IS the live probability. After the market resolves, finalize
 * mirrors the outcome and the winning token redeems 1:1 for collateral.
 */
import {
  Connection, PublicKey, Transaction, ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  initConditionalVaultIx, splitIx, mergeIx, finalizeConditionalVaultIx, redeemIx,
  createAtaIx, deriveVaultAccounts, findConditionalVaultPDA, findATA,
} from '../solana/market-writer';

const RPC_ENDPOINT = process.env.EXPO_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';

export interface WalletInterface {
  publicKey: PublicKey | null;
  connected: boolean;
  isDemoMode?: boolean;
  signAndSendTransaction: (tx: Transaction) => Promise<string>;
}

export interface VaultState {
  market: PublicKey;
  collateralMint: PublicKey;
  collateralVault: PublicKey;
  yesMint: PublicKey;
  noMint: PublicKey;
  authority: PublicKey;
  finalized: boolean;
  winningOutcome: boolean | null; // null until finalized
  decimals: number;
}

function conn(): Connection {
  return new Connection(RPC_ENDPOINT, 'confirmed');
}

// ── Reads ────────────────────────────────────────────────────────

/** Vault PDA + outcome mints for a market (no RPC). */
export function deriveVault(market: PublicKey, collateralMint?: PublicKey, user?: PublicKey) {
  return deriveVaultAccounts(market, collateralMint ?? PublicKey.default, user);
}

/**
 * Decode the on-chain ConditionalVault account, or null if not initialized.
 * Layout after the 8-byte anchor discriminator: 6 pubkeys, finalized(bool),
 * winning_outcome(Option<bool> — borsh variable), decimals(u8), bump(u8).
 */
export async function getVaultState(market: PublicKey): Promise<VaultState | null> {
  const [vault] = findConditionalVaultPDA(market);
  const info = await conn().getAccountInfo(vault);
  if (!info || info.data.length < 201) return null;
  const d = info.data;
  const pk = (o: number) => new PublicKey(d.subarray(o, o + 32));
  let o = 8;
  const marketK = pk(o); o += 32;
  const collateralMint = pk(o); o += 32;
  const collateralVault = pk(o); o += 32;
  const yesMint = pk(o); o += 32;
  const noMint = pk(o); o += 32;
  const authority = pk(o); o += 32;
  const finalized = d[o] === 1; o += 1;
  const tag = d[o]; o += 1;                       // Option<bool> tag
  let winningOutcome: boolean | null = null;
  if (tag === 1) { winningOutcome = d[o] === 1; o += 1; }
  const decimals = d[o];
  return { market: marketK, collateralMint, collateralVault, yesMint, noMint, authority, finalized, winningOutcome, decimals };
}

/** YES / NO token balances (decimals-adjusted whole tokens) for a holder; 0 when
 *  the ATA is absent. Uses the token account's own decimals (uiAmount) so it's
 *  correct for any collateral — the outcome mints are 9-decimal for WSOL markets. */
export async function getOutcomeBalances(owner: PublicKey, yesMint: PublicKey, noMint: PublicKey): Promise<{ yes: number; no: number }> {
  const c = conn();
  const read = async (mint: PublicKey) => {
    try {
      const bal = await c.getTokenAccountBalance(findATA(owner, mint));
      return bal.value.uiAmount ?? 0;
    } catch { return 0; }
  };
  const [yes, no] = await Promise.all([read(yesMint), read(noMint)]);
  return { yes, no };
}

// ── Writes ───────────────────────────────────────────────────────

const COMPUTE = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
const PRIORITY = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });

/** Assemble compute budget + ixs, set blockhash/feePayer, sign+send+confirm. */
export async function sendIxs(wallet: WalletInterface, ixs: Transaction['instructions']): Promise<string> {
  if (!wallet.publicKey || !wallet.connected) throw new Error('Wallet not connected');
  const c = conn();
  const tx = new Transaction().add(COMPUTE).add(PRIORITY);
  for (const ix of ixs) tx.add(ix);
  const { blockhash } = await c.getLatestBlockhash('finalized');
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;
  // wallet.signAndSendTransaction confirms via HTTP polling and throws on on-chain
  // failure. The app RPC is an HTTP-only proxy (no WebSocket), so c.confirmTransaction
  // would hang 30s on a failed wss subscription — don't call it.
  return wallet.signAndSendTransaction(tx);
}

/** Add create-ATA ixs for any of the given mints whose owner ATA does not exist. */
async function ensureAtas(payer: PublicKey, owner: PublicKey, mints: PublicKey[]): Promise<Transaction['instructions']> {
  const c = conn();
  const ixs: Transaction['instructions'] = [];
  await Promise.all(mints.map(async (mint) => {
    const ata = findATA(owner, mint);
    const info = await c.getAccountInfo(ata);
    if (!info) ixs.push(createAtaIx(payer, owner, mint));
  }));
  return ixs;
}

/** One-time: create the vault + YES/NO mints for a market. */
export async function initConditionalVault(wallet: WalletInterface, market: PublicKey, collateralMint: PublicKey): Promise<string> {
  const payer = wallet.publicKey!;
  return sendIxs(wallet, [initConditionalVaultIx(payer, market, collateralMint)]);
}

/** Lock `amount` collateral (base units), receive `amount` YES + `amount` NO. */
export async function splitOutcome(wallet: WalletInterface, market: PublicKey, collateralMint: PublicKey, amount: number | bigint): Promise<string> {
  const user = wallet.publicKey!;
  const { yesMint, noMint } = deriveVaultAccounts(market, collateralMint);
  const ataIxs = await ensureAtas(user, user, [collateralMint, yesMint, noMint]);
  return sendIxs(wallet, [...ataIxs, splitIx(user, market, collateralMint, amount)]);
}

/** Burn `amount` YES + `amount` NO, get `amount` collateral back. */
export async function mergeOutcome(wallet: WalletInterface, market: PublicKey, collateralMint: PublicKey, amount: number | bigint): Promise<string> {
  const user = wallet.publicKey!;
  return sendIxs(wallet, [mergeIx(user, market, collateralMint, amount)]);
}

/** Permissionless: mirror the resolved market outcome into the vault. */
export async function finalizeVault(wallet: WalletInterface, market: PublicKey): Promise<string> {
  return sendIxs(wallet, [finalizeConditionalVaultIx(wallet.publicKey!, market)]);
}

/** After finalize: burn `amount` of the winning outcome token for collateral. */
export async function redeemOutcome(wallet: WalletInterface, market: PublicKey, collateralMint: PublicKey, winningMint: PublicKey, amount: number | bigint): Promise<string> {
  const user = wallet.publicKey!;
  // Ensure BOTH the collateral ATA and the winning-token ATA exist. redeemIx reads
  // the user's winning-token account, and a fresh holder may not have one yet.
  const ataIxs = await ensureAtas(user, user, [collateralMint, winningMint]);
  return sendIxs(wallet, [...ataIxs, redeemIx(user, market, collateralMint, winningMint, amount)]);
}
