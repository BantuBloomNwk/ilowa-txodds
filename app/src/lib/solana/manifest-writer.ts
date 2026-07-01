/**
 * Raw instruction builders for the Manifest spot CLOB (core program), so the app
 * can place/cancel orders on a market's YES-outcome-token book WITHOUT pulling the
 * heavy @cks-systems/manifest-sdk (+ @solana/kit) into the RN bundle. Built with
 * ONLY @solana/web3.js + hand-rolled beet/borsh encoding, mirroring
 * solana/market-writer.ts, so it runs identically on the PWA and the native APK.
 *
 * Targets the CORE program directly (no wrapper): ClaimSeat -> Deposit ->
 * BatchUpdate(place/cancel) -> Withdraw. Byte layouts are verified against the
 * SDK in scripts/manifest-rawix-verify.mjs.
 *
 * Collateral/quote is mint-agnostic: USDC (its SPL mint) or SOL via wrapped SOL
 * (WSOL_MINT) using the wrap/unwrap helpers below — covers the hybrid SOL & USDC
 * requirement.
 *
 * Order types: Manifest core natively supports Limit / ImmediateOrCancel /
 * PostOnly (+ Global/Reverse). STOP and TAKE-PROFIT are NOT native CLOB order
 * types anywhere — they are trigger orders: the client (or a keeper) watches the
 * book price and fires an IOC/limit BatchUpdate when the trigger is crossed. See
 * evalTrigger() + the TriggerOrder type at the bottom.
 */
import { PublicKey, SystemProgram, TransactionInstruction, AccountMeta } from '@solana/web3.js';

export const MANIFEST_PROGRAM_ID = new PublicKey('MNFSTqtC93rEfYHB6hF82sKdZpUDFWkViLByLd1k1Ms');
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// ── encoders (Uint8Array, no Buffer at module scope) ─────────────
function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0; for (const p of parts) n += p.length;
  const out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const u8 = (v: number) => new Uint8Array([v & 0xff]);
const i8 = (v: number) => new Uint8Array([v & 0xff]);
const boolB = (v: boolean) => new Uint8Array([v ? 1 : 0]);
function u32(v: number): Uint8Array { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b; }
function u64(v: number | bigint): Uint8Array { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); return b; }
/** beet coption: 1-byte tag (0 None / 1 Some) + value bytes when Some. */
const coption = (valueBytes: Uint8Array | null) => valueBytes == null ? new Uint8Array([0]) : concat(new Uint8Array([1]), valueBytes);
/** beet array: u32-LE length prefix + concatenated items. */
const array = (items: Uint8Array[]) => concat(u32(items.length), ...items);

function buildIx(programId: PublicKey, keys: AccountMeta[], data: Uint8Array): TransactionInstruction {
  return new TransactionInstruction({ programId, keys, data: Buffer.from(data.buffer, data.byteOffset, data.byteLength) });
}
const ws = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: true, isWritable: true });
const w = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
const r = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });

// ── addresses ────────────────────────────────────────────────────
/** Manifest market vault for a mint: PDA(["vault", market, mint]). */
export function getVaultAddress(market: PublicKey, mint: PublicKey): PublicKey {
  const [v] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), market.toBuffer(), mint.toBuffer()], MANIFEST_PROGRAM_ID);
  return v;
}
export function findATA(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID);
  return ata;
}

// ── price encoding (matches the SDK's toMantissaAndExponent) ──────
/**
 * Convert a human token price (quote tokens per base token) into Manifest's
 * (priceMantissa: u32, priceExponent: i8) of quote-atoms per base-atom.
 * For YES/collateral both 6-dec, price 0..1 IS the probability.
 */
export function priceToMantissaExp(
  tokenPrice: number, baseDecimals: number, quoteDecimals: number, maxExponent = 8,
): { priceMantissa: number; priceExponent: number } {
  const atomsPrice = tokenPrice * (10 ** quoteDecimals / 10 ** baseDecimals);
  const U32_MAX = 4_294_967_296;
  const mant = (exp: number) => Math.round(atomsPrice * Math.pow(10, -exp));
  let exponent = 0;
  while (exponent < maxExponent && mant(exponent) > U32_MAX) exponent += 1;
  while (exponent > -20 && mant(exponent - 1) < U32_MAX) exponent -= 1;
  return { priceMantissa: mant(exponent), priceExponent: exponent };
}

export enum ManifestOrderType { Limit = 0, ImmediateOrCancel = 1, PostOnly = 2, Global = 3, Reverse = 4, ReverseTight = 5 }

export interface PlaceOrder {
  baseAtoms: number | bigint;
  priceMantissa: number;
  priceExponent: number;
  isBid: boolean;            // true = buy YES (bid), false = sell YES (ask)
  lastValidSlot?: number;    // 0 = good-till-cancelled
  orderType?: ManifestOrderType;
}
export interface CancelOrder { sequenceNumber: number | bigint; indexHint?: number | null }

function encodePlace(o: PlaceOrder): Uint8Array {
  return concat(
    u64(o.baseAtoms), u32(o.priceMantissa), i8(o.priceExponent),
    boolB(o.isBid), u32(o.lastValidSlot ?? 0), u8(o.orderType ?? ManifestOrderType.Limit),
  );
}
function encodeCancel(c: CancelOrder): Uint8Array {
  return concat(u64(c.sequenceNumber), coption(c.indexHint == null ? null : u32(c.indexHint)));
}

// ── core instructions ────────────────────────────────────────────

/** ClaimSeat (disc 1) — one-time per market per trader. */
export function claimSeatIx(payer: PublicKey, market: PublicKey): TransactionInstruction {
  return buildIx(MANIFEST_PROGRAM_ID, [ws(payer), w(market), r(SystemProgram.programId)], u8(1));
}

/** Expand (disc 5) — grow the market account by one block so it can hold more
 *  seats/orders/balances. Manifest markets start at 256 bytes; deposits and
 *  resting orders need expanded space. (The SDK's wrapper does this automatically;
 *  core-direct callers must include enough Expands ahead of state-growing ixs.) */
export function expandIx(payer: PublicKey, market: PublicKey): TransactionInstruction {
  return buildIx(MANIFEST_PROGRAM_ID, [ws(payer), w(market), r(SystemProgram.programId)], u8(5));
}

// NB the generated Deposit/Withdraw structs carry traderIndexHint TWICE: once
// inside params (DepositParams) and once at the instruction top level. Both are
// None here, so the data is disc + u64(amountAtoms) + coption(None) + coption(None).

/** Deposit (disc 2) — move `amountAtoms` of `mint` from the trader's ATA into the market. */
export function depositIx(payer: PublicKey, market: PublicKey, mint: PublicKey, amountAtoms: number | bigint): TransactionInstruction {
  const data = concat(u8(2), u64(amountAtoms), coption(null), coption(null));
  return buildIx(MANIFEST_PROGRAM_ID, [
    ws(payer), w(market), w(findATA(payer, mint)), w(getVaultAddress(market, mint)), r(TOKEN_PROGRAM_ID), r(mint),
  ], data);
}

/** Withdraw (disc 3) — pull `amountAtoms` of `mint` back to the trader's ATA. */
export function withdrawIx(payer: PublicKey, market: PublicKey, mint: PublicKey, amountAtoms: number | bigint): TransactionInstruction {
  const data = concat(u8(3), u64(amountAtoms), coption(null), coption(null));
  return buildIx(MANIFEST_PROGRAM_ID, [
    ws(payer), w(market), w(findATA(payer, mint)), w(getVaultAddress(market, mint)), r(TOKEN_PROGRAM_ID), r(mint),
  ], data);
}

/**
 * BatchUpdate (disc 6) — place and/or cancel orders in one ix.
 * accounts: payer[WS], market[W] (+ optional base/quote market vaults for orders
 * that settle immediately). Resting limit orders funded via a prior Deposit need
 * only payer + market.
 */
export function batchUpdateIx(
  payer: PublicKey, market: PublicKey, orders: PlaceOrder[], cancels: CancelOrder[] = [],
  vaults?: { baseVault?: PublicKey; quoteVault?: PublicKey },
): TransactionInstruction {
  const params = concat(
    coption(null),                       // traderIndexHint: None
    array(cancels.map(encodeCancel)),
    array(orders.map(encodePlace)),
  );
  const keys: AccountMeta[] = [ws(payer), w(market), r(SystemProgram.programId)];
  if (vaults?.baseVault) keys.push(w(vaults.baseVault));
  if (vaults?.quoteVault) keys.push(w(vaults.quoteVault));
  return buildIx(MANIFEST_PROGRAM_ID, keys, concat(u8(6), params));
}

// ── wrapped SOL helpers (SOL collateral via WSOL) ─────────────────
/** SyncNative (token program ix 17) — refresh a WSOL ATA after funding it. */
export function syncNativeIx(wsolAta: PublicKey): TransactionInstruction {
  return buildIx(TOKEN_PROGRAM_ID, [w(wsolAta)], u8(17));
}
/** Wrap `lamports` SOL into the owner's WSOL ATA (create ATA if missing, transfer, sync). */
export function wrapSolIxs(owner: PublicKey, lamports: number | bigint, ataExists: boolean): TransactionInstruction[] {
  const ata = findATA(owner, WSOL_MINT);
  const ixs: TransactionInstruction[] = [];
  if (!ataExists) ixs.push(createAtaIx(owner, owner, WSOL_MINT));
  ixs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: ata, lamports: Number(lamports) }));
  ixs.push(syncNativeIx(ata));
  return ixs;
}
/** Close the owner's WSOL ATA, returning the SOL (token program CloseAccount ix 9). */
export function unwrapSolIx(owner: PublicKey): TransactionInstruction {
  const ata = findATA(owner, WSOL_MINT);
  return buildIx(TOKEN_PROGRAM_ID, [w(ata), w(owner), r(owner)], u8(9));
}
/** create-ATA (idempotent at caller). */
export function createAtaIx(payer: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return buildIx(ASSOCIATED_TOKEN_PROGRAM_ID, [
    ws(payer), w(findATA(owner, mint)), r(owner), r(mint), r(SystemProgram.programId), r(TOKEN_PROGRAM_ID),
  ], new Uint8Array(0));
}

// ── stop / take-profit: trigger layer (NOT native CLOB orders) ────
// Manifest (like every CLOB) has no resting stop/TP. A trigger order is stored
// off-book; the client/keeper polls the book mid price and, when crossed, submits
// an IOC/limit BatchUpdate. These helpers express + evaluate that condition.
export type TriggerKind = 'stop' | 'takeProfit';
export interface TriggerOrder {
  kind: TriggerKind;
  triggerPrice: number;   // probability (0..1) at which to fire
  isBid: boolean;         // direction of the order to submit when triggered
}
/**
 * Should this trigger fire at the current book price?
 *  - stop on a long (isBid sell-side protection): fire when price <= trigger.
 *  - take-profit: fire when price >= trigger.
 * (Direction-aware; callers pass the side they intend to submit.)
 */
export function evalTrigger(t: TriggerOrder, currentPrice: number): boolean {
  return t.kind === 'stop' ? currentPrice <= t.triggerPrice : currentPrice >= t.triggerPrice;
}
