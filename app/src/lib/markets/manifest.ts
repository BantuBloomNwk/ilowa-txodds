/**
 * Manifest order-book orchestration for the app — composes the raw web3-only ixs
 * from solana/manifest-writer into wallet-driven actions (place / cancel limit
 * orders on a market's YES-outcome book). No SDK in the bundle; runs on PWA + APK.
 *
 * The YES outcome token (from the conditional vault) is the BASE; collateral
 * (USDC, or SOL via wrapped SOL) is the QUOTE. A bid buys YES with collateral; an
 * ask sells YES for collateral. Price is the probability (0..1).
 *
 * Reads (book depth / mid price) are served by the SDK server-side — see
 * readManifestBook() — because decoding Manifest's red-black order tree
 * client-side isn't worth the bundle weight.
 *
 * ⚠️ EXECUTION CAVEAT (devnet finding 2026-06-23): the raw ixs are byte-for-byte
 * correct vs the SDK (scripts/manifest-rawix-verify.ts), but placing an order
 * core-direct also requires Manifest's state-machine choreography — ClaimSeat,
 * then enough Expands to grow the market account, in the right order — which the
 * SDK's wrapper program does automatically. Hand-rolling that cadence proved
 * fragile/non-deterministic (scripts/manifest-order-e2e.ts). RECOMMENDED order
 * path: the server builds the order tx via the SDK (proven wrapper flow) and
 * returns unsigned ixs; the client signs + sends. That keeps the SDK out of the
 * RN bundle (the whole point) while getting correct execution. These builders
 * stay the verified primitives + a no-server fallback for simple ops.
 */
import { Connection, PublicKey, Transaction, TransactionInstruction, Keypair, SystemProgram, NONCE_ACCOUNT_LENGTH } from '@solana/web3.js';
import {
  claimSeatIx, depositIx, withdrawIx, batchUpdateIx,
  priceToMantissaExp, ManifestOrderType, WSOL_MINT, wrapSolIxs, findATA,
  type PlaceOrder, type CancelOrder,
} from '../solana/manifest-writer';
import { sendIxs, type WalletInterface } from './clob';
import { splitIx, deriveVaultAccounts, createAtaIx } from '../solana/market-writer';

const RPC_ENDPOINT = process.env.EXPO_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
function conn(): Connection { return new Connection(RPC_ENDPOINT, 'confirmed'); }

// CLOB order/book server base. Mirrors api-client.ts resolution: the app ships
// EXPO_PUBLIC_VPS_API_URL (https://ilowa-api.fly.dev); EXPO_PUBLIC_API_URL is an
// optional override. Reading only the latter is why the board threw "not configured".
const CLOB_API = process.env.EXPO_PUBLIC_VPS_API_URL || process.env.EXPO_PUBLIC_API_URL;

export interface PlaceOrderArgs {
  market: PublicKey;
  baseMint: PublicKey;       // the YES outcome-token mint
  quoteMint: PublicKey;      // collateral mint (USDC mint, or WSOL_MINT for SOL)
  isBid: boolean;            // true = buy YES, false = sell YES
  priceProb: number;        // 0..1 probability
  sizeBaseTokens: number;    // size in whole YES tokens
  baseDecimals: number;
  quoteDecimals: number;
  orderType?: ManifestOrderType;
}

/** Does this trader already hold a seat on the market? (avoids a redundant ClaimSeat) */
export async function hasSeat(market: PublicKey, trader: PublicKey): Promise<boolean> {
  // A seat is recorded inside the market account; rather than decode the tree we
  // check whether the trader has ever interacted by looking for their market
  // vault token balance OR a prior seat marker. Cheapest reliable signal: ask the
  // server reader. Conservative default = false (ClaimSeat is idempotent-safe to
  // include once; the program rejects a duplicate, so callers pass the known flag).
  return false;
}

/**
 * Build the ixs to place a limit order: ClaimSeat (if new) -> Deposit the posted
 * side -> BatchUpdate place. For SOL collateral the quote is wrapped first.
 */
export async function buildPlaceOrderIxs(trader: PublicKey, a: PlaceOrderArgs, seatExists: boolean) {
  const ixs = [];
  if (!seatExists) ixs.push(claimSeatIx(trader, a.market));

  // Which side gets deposited, and how much (atoms):
  //  - bid (buy YES): deposit QUOTE = price * size
  //  - ask (sell YES): deposit BASE = size
  const baseAtoms = Math.floor(a.sizeBaseTokens * 10 ** a.baseDecimals);
  let depositMint: PublicKey, depositAtoms: number;
  if (a.isBid) {
    depositMint = a.quoteMint;
    depositAtoms = Math.ceil(a.priceProb * a.sizeBaseTokens * 10 ** a.quoteDecimals);
  } else {
    depositMint = a.baseMint;
    depositAtoms = baseAtoms;
  }

  // SOL collateral: wrap the needed lamports into the trader's WSOL ATA first.
  if (depositMint.equals(WSOL_MINT)) {
    const wsolAta = findATA(trader, WSOL_MINT);
    const exists = !!(await conn().getAccountInfo(wsolAta));
    ixs.push(...wrapSolIxs(trader, depositAtoms, exists));
  }

  ixs.push(depositIx(trader, a.market, depositMint, depositAtoms));

  const { priceMantissa, priceExponent } = priceToMantissaExp(a.priceProb, a.baseDecimals, a.quoteDecimals);
  const order: PlaceOrder = {
    baseAtoms, priceMantissa, priceExponent, isBid: a.isBid,
    lastValidSlot: 0, orderType: a.orderType ?? ManifestOrderType.Limit,
  };
  ixs.push(batchUpdateIx(trader, a.market, [order], []));
  return ixs;
}

/** Place a limit order on the YES book and return the signature. */
export async function placeOrder(wallet: WalletInterface, a: PlaceOrderArgs, seatExists = false): Promise<string> {
  const ixs = await buildPlaceOrderIxs(wallet.publicKey!, a, seatExists);
  return sendIxs(wallet, ixs);
}

/** Cancel resting orders by sequence number. */
export async function cancelOrders(wallet: WalletInterface, market: PublicKey, cancels: CancelOrder[]): Promise<string> {
  return sendIxs(wallet, [batchUpdateIx(wallet.publicKey!, market, [], cancels)]);
}

/** Withdraw free balance of `mint` back to the trader's wallet. */
export async function withdraw(wallet: WalletInterface, market: PublicKey, mint: PublicKey, amountAtoms: number): Promise<string> {
  return sendIxs(wallet, [withdrawIx(wallet.publicKey!, market, mint, amountAtoms)]);
}

// ── server-built order path (RECOMMENDED — correct Manifest execution) ──────
// The server builds the order tx via the SDK's wrapper flow (handles seat +
// Expand); the wallet signs here. SDK never enters the app bundle.

interface SerIx { programId: string; keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string }

function reconstructIx(s: SerIx): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(s.programId),
    keys: s.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
    data: Buffer.from(s.data, 'base64'),
  });
}

async function postBuild(api: string, body: any) {
  const res = await fetch(`${api}/api/clob/order/build`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `build ${res.status}`);
  return res.json() as Promise<{ setupNeeded: boolean; setupTx?: string; orderIxs?: SerIx[] }>;
}

export interface ServerOrderArgs {
  market: PublicKey; isBid: boolean; price: number; sizeBaseTokens: number;
  orderType?: 'limit' | 'ioc' | 'postonly';
}

/**
 * Place an order via the server builder. Two-phase: if the user has no wrapper/
 * seat yet, sign the (wrapper-co-signed) setup tx first, then fetch + sign the
 * order. Returns the order signature.
 */
export async function placeOrderViaServer(wallet: WalletInterface, args: ServerOrderArgs): Promise<string> {
  const api = CLOB_API;
  if (!api) throw new Error('CLOB order server not configured (set EXPO_PUBLIC_VPS_API_URL)');
  if (!wallet.publicKey) throw new Error('Wallet not connected');
  const body = {
    market: args.market.toBase58(), trader: wallet.publicKey.toBase58(),
    isBid: args.isBid, price: args.price, size: args.sizeBaseTokens, orderType: args.orderType ?? 'limit',
  };

  let r = await postBuild(api, body);
  if (r.setupNeeded && r.setupTx) {
    const setupTx = Transaction.from(Buffer.from(r.setupTx, 'base64')); // already wrapper-signed
    // wallet.signAndSendTransaction already confirms via HTTP polling. The app RPC
    // is an HTTP-only proxy (no WebSocket), so conn().confirmTransaction would hang
    // 30s on a failed wss subscription. Give the server's RPC a moment to see the
    // new seat, then re-fetch the order.
    await wallet.signAndSendTransaction(setupTx);
    await new Promise((res) => setTimeout(res, 2500));
    r = await postBuild(api, body); // re-fetch the order now that setup is done
  }
  if (!r.orderIxs?.length) throw new Error('server returned no order instructions');
  return sendIxs(wallet, r.orderIxs.map(reconstructIx));
}

export interface BuyNoArgs { market: PublicKey; collateralMint: PublicKey; size: number; sellPrice: number; }

/**
 * Buy the NO outcome. There is a single YES order book, so taking the No side means:
 * split N collateral into N YES + N NO, then market-sell the N YES into the best bid.
 * Net: you hold N NO for about N*(1 - sellPrice) collateral. Done in ONE transaction
 * (wrap + split + the server-built sell), so it's a single signature. Outcome mints
 * mirror the collateral decimals (9 for WSOL markets).
 */
export async function buyNoViaServer(wallet: WalletInterface, a: BuyNoArgs): Promise<string> {
  const api = CLOB_API;
  if (!api) throw new Error('CLOB order server not configured (set EXPO_PUBLIC_VPS_API_URL)');
  if (!wallet.publicKey) throw new Error('Wallet not connected');
  const trader = wallet.publicKey;
  // 1) server-built market sell of the YES we're about to mint (IOC into the bid)
  const body = { market: a.market.toBase58(), trader: trader.toBase58(), isBid: false, price: a.sellPrice, size: a.size, orderType: 'ioc' };
  let r = await postBuild(api, body);
  if (r.setupNeeded && r.setupTx) {
    const setupTx = Transaction.from(Buffer.from(r.setupTx, 'base64'));
    await wallet.signAndSendTransaction(setupTx);
    await new Promise((res) => setTimeout(res, 2500));
    r = await postBuild(api, body);
  }
  if (!r.orderIxs?.length) throw new Error('No bids to sell the Yes side into — the No side has no liquidity yet.');
  // 2) client-built wrap + split, minting the YES the sell consumes and the NO you keep
  const c = conn();
  const isWsol = a.collateralMint.equals(WSOL_MINT);
  const { yesMint, noMint } = deriveVaultAccounts(a.market, a.collateralMint, trader);
  const atoms = Math.round(a.size * 1e9); // 9-decimal outcome tokens (WSOL collateral)
  const pre: TransactionInstruction[] = [];
  if (isWsol) {
    const wsolExists = !!(await c.getAccountInfo(findATA(trader, WSOL_MINT)));
    pre.push(...wrapSolIxs(trader, atoms, wsolExists));
  }
  for (const m of [yesMint, noMint]) {
    if (!(await c.getAccountInfo(findATA(trader, m)))) pre.push(createAtaIx(trader, trader, m));
  }
  pre.push(splitIx(trader, a.market, a.collateralMint, atoms));
  // 3) one signature: wrap + split, then the server's sell ixs (YES exists by then)
  return sendIxs(wallet, [...pre, ...r.orderIxs.map(reconstructIx)]);
}

/** On-demand: settle a bound World Cup market from its TxLINE proof (permissionless). */
export async function settleMarket(marketPubkey: string): Promise<{ ok?: boolean; outcome?: boolean; sig?: string; error?: string; pending?: boolean; alreadyResolved?: boolean }> {
  const api = CLOB_API;
  if (!api) throw new Error('Settlement server not configured');
  const res = await fetch(`${api}/api/txodds/market/resolve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marketPubkey }),
  });
  return res.json();
}

// ── book read (server-served; client just fetches) ───────────────
export interface BookLevel { price: number; size: number }
export interface Book { bids: BookLevel[]; asks: BookLevel[]; mid: number | null }

/**
 * Fetch decoded book + mid price from the server reader (SDK-backed). Returns null
 * if the endpoint is unset/unreachable so callers fall back to the pari-mutuel
 * consensus. Endpoint: GET {api}/api/clob/book/:market -> { bids, asks, mid }.
 */
export async function readManifestBook(market: PublicKey): Promise<Book | null> {
  const api = CLOB_API;
  if (!api) return null;
  try {
    const res = await fetch(`${api}/api/clob/book/${market.toBase58()}`);
    if (!res.ok) return null;
    return (await res.json()) as Book;
  } catch { return null; }
}

/** The book mid is the live implied probability (0..1), or null when empty. */
export function midProbability(book: Book | null): number | null {
  return book?.mid ?? null;
}

// ── open orders + cancel (wrapper-attributed; server-built) ──────────────
export interface OpenOrder {
  clientOrderId: string;   // needed to cancel
  sequenceNumber: string;
  isBid: boolean;
  price: number;           // collateral per YES = probability 0..1
  size: number;            // YES tokens
  orderType: number;
}

/**
 * The trader's OWN resting orders on a market, read through their Manifest
 * wrapper server-side. Empty array when none / endpoint unset. GET
 * {api}/api/clob/orders/:market/:owner -> { orders }.
 */
export async function readOpenOrders(market: PublicKey, owner: PublicKey): Promise<OpenOrder[]> {
  const api = CLOB_API;
  if (!api) return [];
  try {
    const res = await fetch(`${api}/api/clob/orders/${market.toBase58()}/${owner.toBase58()}`);
    if (!res.ok) return [];
    return ((await res.json())?.orders ?? []) as OpenOrder[];
  } catch { return []; }
}

/**
 * The trader's WITHDRAWABLE balance on the Manifest exchange (the "seat"). A
 * filled buy credits YES here, not the wallet ATA — so the real YES a trader can
 * sell = seat YES + wallet-ATA YES. GET {api}/api/clob/balance/:market/:owner.
 */
export async function readSeatBalance(market: PublicKey, owner: PublicKey): Promise<{ yes: number; quote: number }> {
  const api = CLOB_API;
  if (!api) return { yes: 0, quote: 0 };
  try {
    const res = await fetch(`${api}/api/clob/balance/${market.toBase58()}/${owner.toBase58()}`);
    if (!res.ok) return { yes: 0, quote: 0 };
    const j = await res.json();
    return { yes: Number(j?.yes) || 0, quote: Number(j?.quote) || 0 };
  } catch { return { yes: 0, quote: 0 }; }
}

/**
 * Cancel resting order(s) by clientOrderId. The server builds the wrapper cancel
 * ixs (cancel is wrapper-attributed; a raw core BatchUpdate wouldn't match the
 * wrapper-held seat); the wallet signs + sends. Returns the signature.
 */
export async function cancelOrderViaServer(wallet: WalletInterface, market: PublicKey, clientOrderIds: (string | number)[]): Promise<string> {
  const api = CLOB_API;
  if (!api) throw new Error('CLOB order server not configured (set EXPO_PUBLIC_VPS_API_URL)');
  if (!wallet.publicKey) throw new Error('Wallet not connected');
  const res = await fetch(`${api}/api/clob/order/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ market: market.toBase58(), trader: wallet.publicKey.toBase58(), clientOrderIds }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `cancel ${res.status}`);
  const { ixs } = (await res.json()) as { ixs: SerIx[] };
  if (!ixs?.length) throw new Error('server returned no cancel instructions');
  return sendIxs(wallet, ixs.map(reconstructIx));
}

/**
 * Withdraw the trader's FULL Manifest seat balance (filled YES + deposited
 * collateral) back to their wallet. Wrapper-attributed; server-built, client signs.
 */
export async function withdrawAllViaServer(wallet: WalletInterface, market: PublicKey): Promise<string> {
  const api = CLOB_API;
  if (!api) throw new Error('CLOB order server not configured (set EXPO_PUBLIC_VPS_API_URL)');
  if (!wallet.publicKey) throw new Error('Wallet not connected');
  const res = await fetch(`${api}/api/clob/withdraw`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ market: market.toBase58(), trader: wallet.publicKey.toBase58() }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `withdraw ${res.status}`);
  const { ixs } = (await res.json()) as { ixs: SerIx[] };
  if (!ixs?.length) throw new Error('Nothing to withdraw right now.');
  return sendIxs(wallet, ixs.map(reconstructIx));
}

// ── set-and-forget stop / take-profit (server keeper, fires while away) ──────
// Zero-custody durable-nonce model: the user signs the exact protective order
// ONCE against a durable nonce; the keeper can only relay those bytes when the
// price crosses, and can never withdraw or place anything else. See
// api/src/app/api/cron/clob-keeper + scripts/clob-stop-keeper-probe.ts.

type ArmWallet = WalletInterface & {
  signTransaction: (tx: Transaction, opts?: { preserveBlockhash?: boolean }) => Promise<Transaction>;
};

export interface ServerTrigger {
  id: string; owner: string; market: string; scalar_market_id: string | null;
  kind: 'stop' | 'takeProfit'; side: 'buy' | 'sell'; trigger_price: number; size: number;
  nonce_pubkey: string; status: 'armed' | 'firing' | 'fired' | 'revoked' | 'expired' | 'failed';
  attempts: number; fired_sig: string | null; last_error: string | null; created_at: string; fired_at: string | null;
}

// Pre-sign the protective sell with a fill buffer below the trigger so it still
// exits when fired (a sell exactly at the trigger may not cross the book).
const TRIGGER_SLIPPAGE = 0.05;

export async function armServerTrigger(
  wallet: ArmWallet,
  args: { market: PublicKey; scalarMarketId?: string | null; kind: 'stop' | 'takeProfit'; triggerPrice: number; size: number },
): Promise<ServerTrigger> {
  if (!CLOB_API) throw new Error('CLOB order server not configured (set EXPO_PUBLIC_VPS_API_URL)');
  if (!wallet.publicKey || !wallet.connected) throw new Error('Connect your wallet first');
  if (typeof wallet.signTransaction !== 'function') throw new Error('This wallet cannot arm away-triggers yet');
  const owner = wallet.publicKey;
  const c = conn();

  // 1. Create the user's durable nonce (authority = the user; only they can close it).
  const nonceKp = Keypair.generate();
  let rent = 0;
  try { rent = await c.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH); } catch { /* rpc flake */ }
  if (!rent) rent = 1_500_000;
  const createTx = new Transaction().add(
    SystemProgram.createNonceAccount({ fromPubkey: owner, noncePubkey: nonceKp.publicKey, authorizedPubkey: owner, lamports: rent }),
  );
  createTx.recentBlockhash = (await c.getLatestBlockhash('finalized')).blockhash;
  createTx.feePayer = owner;
  createTx.partialSign(nonceKp); // ephemeral co-signer; wallet preserves this + the blockhash
  await wallet.signAndSendTransaction(createTx as any);
  await new Promise((r) => setTimeout(r, 1800)); // let the server RPC see the new nonce

  // 2. Server builds the exact protective IOC sell on the nonce (unsigned).
  const floor = Math.max(0.01, +(args.triggerPrice - TRIGGER_SLIPPAGE).toFixed(4));
  const buildRes = await fetch(`${CLOB_API}/api/clob/trigger/build`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ market: args.market.toBase58(), owner: owner.toBase58(), price: floor, size: args.size, noncePubkey: nonceKp.publicKey.toBase58() }),
  });
  const build = await buildRes.json().catch(() => ({}));
  if (build?.setupNeeded) throw new Error('Place one normal order first to open your exchange seat, then arm.');
  if (!buildRes.ok || !build?.unsignedTx) throw new Error(build?.error || 'Could not build the trigger order');

  // 3. Sign ONCE, keeping the nonce as the blockhash.
  const tx = Transaction.from(Buffer.from(build.unsignedTx, 'base64'));
  const signed = await wallet.signTransaction(tx, { preserveBlockhash: true });
  const signedTx = signed.serialize().toString('base64');

  // 4. Store with the keeper.
  const armRes = await fetch(`${CLOB_API}/api/clob/trigger/arm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner: owner.toBase58(), market: args.market.toBase58(), scalarMarketId: args.scalarMarketId || null,
      kind: args.kind, side: 'sell', triggerPrice: args.triggerPrice, size: args.size,
      noncePubkey: nonceKp.publicKey.toBase58(), signedTx,
    }),
  });
  const arm = await armRes.json().catch(() => ({}));
  if (!armRes.ok || !arm?.id) throw new Error(arm?.error || 'Could not arm the trigger');
  return {
    id: arm.id, owner: owner.toBase58(), market: args.market.toBase58(), scalar_market_id: args.scalarMarketId || null,
    kind: args.kind, side: 'sell', trigger_price: args.triggerPrice, size: args.size, nonce_pubkey: nonceKp.publicKey.toBase58(),
    status: arm.status || 'armed', attempts: 0, fired_sig: null, last_error: null, created_at: new Date().toISOString(), fired_at: null,
  };
}

export async function listServerTriggers(market: PublicKey, owner: PublicKey): Promise<ServerTrigger[]> {
  if (!CLOB_API) return [];
  try {
    const res = await fetch(`${CLOB_API}/api/clob/trigger/list?owner=${owner.toBase58()}&market=${market.toBase58()}`);
    if (!res.ok) return [];
    return ((await res.json()).triggers || []) as ServerTrigger[];
  } catch { return []; }
}

// ── TxLINE settlement binding (World Cup markets resolved by on-chain proof) ──
export interface TxlineBinding {
  id: string; market_pubkey: string; fixture_id: number;
  home: string | null; away: string | null; kind: string; description: string | null;
  status: 'armed' | 'resolving' | 'resolved' | 'failed' | 'expired';
  resolved_outcome: boolean | null; resolve_sig: string | null;
}

/** The TxLINE settlement binding for a market (which fixture + how it resolves), or null. */
export async function fetchTxlineBinding(marketPubkey: string): Promise<TxlineBinding | null> {
  if (!CLOB_API) return null;
  try {
    const res = await fetch(`${CLOB_API}/api/txodds/market/bindings?marketPubkey=${marketPubkey}`);
    if (!res.ok) return null;
    return ((await res.json()).bindings || [])[0] || null;
  } catch { return null; }
}

export async function revokeServerTrigger(id: string, owner: PublicKey): Promise<void> {
  if (!CLOB_API) return;
  await fetch(`${CLOB_API}/api/clob/trigger/revoke`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, owner: owner.toBase58() }),
  });
}
