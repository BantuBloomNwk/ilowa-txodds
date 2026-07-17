/**
 * Jupiter Integration, Ultra Swap v1 + Tokens V2 + Price V3
 *
 * Updated to current Jupiter APIs per https://dev.jup.ag/get-started
 *
 * Three APIs (no API key needed for lite-api):
 *   Ultra Swap : https://lite-api.jup.ag/ultra/v1   (order → sign → execute)
 *   Tokens V2  : https://lite-api.jup.ag/tokens/v2  (search, discovery)
 *   Price V3   : https://lite-api.jup.ag/price/v3   (USD reference prices)
 *
 * Key differences from old V6:
 *   - Unified order+execute (no separate quote+swap)
 *   - Jupiter handles tx landing via /execute (no manual RPC polling)
 *   - VersionedTransaction (v0) by default
 *   - requestId ties order to execution
 */

import { VersionedTransaction, Keypair } from '@solana/web3.js';
import { toUint8Array, fromUint8Array } from 'js-base64';

// ── API Base URLs ────────────────────────────────────────────────
const ULTRA_API  = 'https://lite-api.jup.ag/ultra/v1';
const TOKENS_API = 'https://lite-api.jup.ag/tokens/v2';
const PRICE_API  = 'https://lite-api.jup.ag/price/v3';

// ── Common Solana Token Mints ────────────────────────────────────
export const TOKENS = {
  SOL:  'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
} as const;

const TOKEN_DECIMALS: Record<string, number> = {
  [TOKENS.SOL]: 9,
  [TOKENS.USDC]: 6,
  [TOKENS.USDT]: 6,
};

function getDecimals(mint: string): number {
  return TOKEN_DECIMALS[mint] ?? 6;
}

function mintLabel(mint: string): string {
  if (mint === TOKENS.SOL) return 'SOL';
  if (mint === TOKENS.USDC) return 'USDC';
  if (mint === TOKENS.USDT) return 'USDT';
  return mint.slice(0, 6) + '…';
}

// ── Types ────────────────────────────────────────────────────────

export interface SwapOrder {
  inputMint: string;
  outputMint: string;
  inAmount: string;         // raw lamports / smallest unit
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string;
  swapType: string;         // 'aggregator' | 'rfq'
  router: string;           // 'iris' | 'jupiterz' | 'dflow' | 'okx'
  routePlan: RoutePlanStep[];
  transaction: string | null;  // base64-encoded VersionedTransaction (null if no taker)
  requestId: string;        // required for /execute
  gasless: boolean;
  feeBps: number;
  signatureFeeLamports: number;
  prioritizationFeeLamports: number;
  rentFeeLamports: number;
  inUsdValue: number;
  outUsdValue: number;
  priceImpact: number;
  mode: string;             // 'ultra'
  totalTime: number;
  errorCode?: number;
  errorMessage?: string;
}

export interface RoutePlanStep {
  percent: number;
  bps: number;
  usdValue: number;
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
  };
}

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inputAmount: number;        // human-readable (e.g. 100 USDC)
  outputAmount: number;       // human-readable (e.g. 0.65 SOL)
  priceImpactPct: number;
  routeLabel: string;         // e.g. "USDC → Meteora DLMM → SOL"
  minimumReceived: number;    // after slippage
  slippageBps: number;
  fees: {
    platformFeeBps: number;
    signatureFeeLamports: number;
    priorityFeeLamports: number;
    rentFeeLamports: number;
  };
  inUsdValue: number;
  outUsdValue: number;
  rawOrder: SwapOrder;        // pass to executeSwap()
}

export interface SwapResult {
  status: 'Success' | 'Failed';
  signature: string;
  inputAmountResult: string;
  outputAmountResult: string;
  swapEvents: Array<{
    inputMint: string;
    inputAmount: string;
    outputMint: string;
    outputAmount: string;
  }>;
}

export interface TokenPrice {
  mint: string;
  usdPrice: number;
  liquidity: number;
  decimals: number;
  priceChange24h: number;
}

export interface TokenSearchResult {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI: string;
  tags: string[];
  verified: boolean;
}

// ══════════════════════════════════════════════════════════════════
// ULTRA SWAP v1, Order + Execute
// ══════════════════════════════════════════════════════════════════

/**
 * Get a swap order (quote + unsigned transaction) from Jupiter Ultra.
 *
 * When `taker` is provided, the response includes a base64 VersionedTransaction.
 * When `taker` is null, it's a quote-only request (no tx returned).
 *
 * @param inputMint  Token mint to sell
 * @param outputMint Token mint to buy
 * @param amount     Amount in human-readable units (e.g. 100 for 100 USDC)
 * @param taker      Wallet public key (base58), pass null for quote-only
 */
export async function getSwapOrder(
  inputMint: string,
  outputMint: string,
  amount: number,
  taker: string | null = null,
): Promise<SwapOrder> {
  const decimals = getDecimals(inputMint);
  const rawAmount = Math.floor(amount * Math.pow(10, decimals));

  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: rawAmount.toString(),
  });
  if (taker) params.set('taker', taker);

  const resp = await fetch(`${ULTRA_API}/order?${params}`);
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Jupiter order failed (${resp.status}): ${err}`);
  }

  const order: SwapOrder = await resp.json();

  if (order.errorCode) {
    throw new Error(order.errorMessage || `Jupiter error code ${order.errorCode}`);
  }

  return order;
}

/**
 * Get a quote (no wallet needed). Same as getSwapOrder but without taker.
 */
export async function getSwapQuote(
  inputMint: string,
  outputMint: string,
  amount: number,
): Promise<SwapQuote> {
  const order = await getSwapOrder(inputMint, outputMint, amount, null);
  return orderToQuote(order, amount, inputMint, outputMint);
}

/**
 * Get a quote with transaction (wallet required).
 */
export async function getSwapQuoteWithTx(
  inputMint: string,
  outputMint: string,
  amount: number,
  taker: string,
): Promise<SwapQuote> {
  const order = await getSwapOrder(inputMint, outputMint, amount, taker);
  return orderToQuote(order, amount, inputMint, outputMint);
}

/**
 * Execute a signed swap transaction via Jupiter.
 * Jupiter handles tx landing, no manual RPC polling needed.
 *
 * @param signedTxBase64 The signed VersionedTransaction as base64
 * @param requestId      From the order response
 */
export async function executeSwap(
  signedTxBase64: string,
  requestId: string,
  maxRetries: number = 3,
): Promise<SwapResult> {
  const body = JSON.stringify({
    signedTransaction: signedTxBase64,
    requestId,
  });

  let lastError: Error | null = null;

  // Jupiter docs: you can re-submit with the same signedTransaction+requestId
  // for up to 2 minutes to poll status. The tx won't double-execute (same sig).
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(`${ULTRA_API}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Jupiter execute failed (${resp.status}): ${err}`);
      }

      const result: SwapResult = await resp.json();

      if (result.status === 'Success') {
        return result;
      }

      // Failed on-chain, no point retrying
      if (result.signature) {
        throw new Error(`Swap failed on-chain. Tx: ${result.signature}`);
      }

      lastError = new Error(
        `Swap status: ${result.status || 'unknown'}. Retrying…`,
      );
    } catch (err: any) {
      lastError = err;
    }

    // Wait before retry (2s, 4s, 8s)
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
    }
  }

  throw lastError || new Error('Swap execution timed out');
}

/**
 * Full swap flow for local wallets (keypair signing).
 *
 * 1. GET /order with taker → get unsigned VersionedTransaction
 * 2. Deserialize + sign with keypair
 * 3. POST /execute with signed tx + requestId
 *
 * For external wallets (MWA/Phantom), use getSwapQuoteWithTx() + manual sign + executeSwap().
 */
export async function swapWithKeypair(
  inputMint: string,
  outputMint: string,
  amount: number,
  keypair: Keypair,
): Promise<SwapResult> {
  const taker = keypair.publicKey.toBase58();

  // 1. Get order with transaction
  const order = await getSwapOrder(inputMint, outputMint, amount, taker);

  if (!order.transaction) {
    throw new Error('No transaction returned, check wallet balance');
  }

  // 2. Deserialize and sign
  const txBytes = toUint8Array(order.transaction);
  const tx = VersionedTransaction.deserialize(txBytes);
  tx.sign([keypair]);
  const signedTxBase64 = fromUint8Array(tx.serialize());

  // 3. Execute via Jupiter (they handle landing)
  return executeSwap(signedTxBase64, order.requestId);
}

// ══════════════════════════════════════════════════════════════════
// PRICE V3, USD Reference Prices
// ══════════════════════════════════════════════════════════════════

/**
 * Get USD prices for up to 50 tokens.
 * Uses Jupiter Price V3 API.
 *
 * @param mints Array of token mint addresses
 */
export async function getPrices(mints: string[]): Promise<Record<string, TokenPrice>> {
  const ids = mints.join(',');
  const resp = await fetch(`${PRICE_API}?ids=${ids}`);
  if (!resp.ok) {
    throw new Error(`Price API failed (${resp.status})`);
  }

  const data = await resp.json();
  const result: Record<string, TokenPrice> = {};

  for (const mint of mints) {
    const p = data[mint];
    if (p) {
      result[mint] = {
        mint,
        usdPrice: p.usdPrice ?? 0,
        liquidity: p.liquidity ?? 0,
        decimals: p.decimals ?? getDecimals(mint),
        priceChange24h: p.priceChange24h ?? 0,
      };
    }
  }

  return result;
}

/**
 * Get SOL price in USD via Price V3.
 */
export async function getSOLPrice(): Promise<number> {
  try {
    const prices = await getPrices([TOKENS.SOL]);
    return prices[TOKENS.SOL]?.usdPrice ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Get multiple token prices at once. Returns { mint: usdPrice }.
 */
export async function getTokenPrices(mints: string[]): Promise<Record<string, number>> {
  const prices = await getPrices(mints);
  const result: Record<string, number> = {};
  for (const [mint, data] of Object.entries(prices)) {
    result[mint] = data.usdPrice;
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════
// TOKENS V2, Search & Discovery
// ══════════════════════════════════════════════════════════════════

/**
 * Search tokens by symbol, name, or mint address.
 */
export async function searchTokens(query: string): Promise<TokenSearchResult[]> {
  const resp = await fetch(`${TOKENS_API}/search?query=${encodeURIComponent(query)}`);
  if (!resp.ok) return [];
  return resp.json();
}

/**
 * Get tokens by tag (e.g. 'verified', 'community', 'strict').
 */
export async function getTokensByTag(tag: string): Promise<TokenSearchResult[]> {
  const resp = await fetch(`${TOKENS_API}/tag/${encodeURIComponent(tag)}`);
  if (!resp.ok) return [];
  return resp.json();
}

/**
 * Get trending tokens for a given interval.
 * @param interval '1h' | '2h' | '4h' | '8h' | '24h'
 */
export async function getTrendingTokens(
  interval: '1h' | '2h' | '4h' | '8h' | '24h' = '24h',
): Promise<TokenSearchResult[]> {
  const resp = await fetch(`${TOKENS_API}/category/trending?interval=${interval}`);
  if (!resp.ok) return [];
  return resp.json();
}

// ══════════════════════════════════════════════════════════════════
// SHIELD, Token Safety Checks
// ══════════════════════════════════════════════════════════════════

export interface TokenShieldInfo {
  mint: string;
  warnings: string[];
  isSafe: boolean;
}

/**
 * Check token safety warnings via Jupiter Shield.
 */
export async function getTokenWarnings(mints: string[]): Promise<Record<string, TokenShieldInfo>> {
  const resp = await fetch(`${ULTRA_API}/shield`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mints }),
  });

  if (!resp.ok) return {};
  const data = await resp.json();
  const result: Record<string, TokenShieldInfo> = {};

  for (const mint of mints) {
    const info = data[mint];
    result[mint] = {
      mint,
      warnings: info?.warnings ?? [],
      isSafe: !info?.warnings?.length,
    };
  }

  return result;
}

// ══════════════════════════════════════════════════════════════════
// Quick Helpers
// ══════════════════════════════════════════════════════════════════

/**
 * Get a USDC → SOL quote.
 */
export async function quoteUSDCtoSOL(usdcAmount: number): Promise<SwapQuote> {
  return getSwapQuote(TOKENS.USDC, TOKENS.SOL, usdcAmount);
}

/**
 * Get a USDT → SOL quote.
 */
export async function quoteUSDTtoSOL(usdtAmount: number): Promise<SwapQuote> {
  return getSwapQuote(TOKENS.USDT, TOKENS.SOL, usdtAmount);
}

// ── Internal ─────────────────────────────────────────────────────

function orderToQuote(
  order: SwapOrder,
  inputAmount: number,
  inputMint: string,
  outputMint: string,
): SwapQuote {
  const outDecimals = getDecimals(outputMint);

  const routeParts: string[] = order.routePlan?.map(
    (step) => step.swapInfo?.label || 'DEX'
  ) || ['Direct'];
  const inLabel = mintLabel(inputMint);
  const outLabel = mintLabel(outputMint);

  return {
    inputMint,
    outputMint,
    inputAmount,
    outputAmount: Number(order.outAmount) / Math.pow(10, outDecimals),
    priceImpactPct: Number(order.priceImpactPct || 0),
    routeLabel: `${inLabel} → ${routeParts.join(' → ')} → ${outLabel}`,
    minimumReceived: Number(order.otherAmountThreshold || order.outAmount) / Math.pow(10, outDecimals),
    slippageBps: order.slippageBps,
    fees: {
      platformFeeBps: order.feeBps,
      signatureFeeLamports: order.signatureFeeLamports,
      priorityFeeLamports: order.prioritizationFeeLamports,
      rentFeeLamports: order.rentFeeLamports,
    },
    inUsdValue: order.inUsdValue,
    outUsdValue: order.outUsdValue,
    rawOrder: order,
  };
}
