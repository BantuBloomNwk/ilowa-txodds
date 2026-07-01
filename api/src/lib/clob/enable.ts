/**
 * Shared CLOB enablement: the keeper creates the on-chain ilowa Market, inits the
 * conditional vault, opens a Manifest book (WSOL collateral), and links it to a
 * feed row in clob_markets. Used by the guarded self-serve route and the Elder
 * auto-seed. Keeper key read at runtime (FAUCET_SECRET_KEY, falling back to the
 * fly.toml [env] KEEPER_SECRET_KEY which reliably reaches the process).
 */
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { Market } from '@cks-systems/manifest-sdk';
import bs58 from 'bs58';
import { deriveVaultAccounts, initConditionalVaultIx, createMarketIx, findMarketPDA } from './vault';

const readEnv = (k: string) => process.env[k] || '';
const RPC = () => readEnv('SOLANA_RPC_URL') || 'https://api.devnet.solana.com';
const WSOL = 'So11111111111111111111111111111111111111112';

function sb() {
  const url = readEnv('SUPABASE_URL');
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
}

function loadKeeper(): Keypair {
  const faucet = readEnv('FAUCET_SECRET_KEY');
  if (faucet) { try { return Keypair.fromSecretKey(bs58.decode(faucet)); } catch { /* maybe JSON array */ try { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(faucet))); } catch {} } }
  const env = readEnv('KEEPER_SECRET_KEY');
  if (env) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(env)));
  throw new Error('keeper not configured');
}

export interface ClobMapping {
  market_pubkey: string; vault: string; yes_mint: string; no_mint: string;
  collateral_vault: string; collateral_mint: string; manifest_market: string; scalar_market_id: string;
}

/** manifest_market if this feed row already has a book, else null. */
export async function alreadyEnabled(scalarMarketId: string): Promise<string | null> {
  const s = sb(); if (!s.url) return null;
  const ex = await fetch(`${s.url}/rest/v1/clob_markets?select=manifest_market&scalar_market_id=eq.${scalarMarketId}`, { headers: s.headers }).then((r) => r.json()).catch(() => []);
  return Array.isArray(ex) && ex.length ? ex[0].manifest_market : null;
}

export async function enableClobForFeed(scalarMarketId: string, question: string, collateralMintStr?: string): Promise<ClobMapping> {
  const collateralMint = new PublicKey(collateralMintStr || WSOL);
  const conn = new Connection(RPC(), 'confirmed');
  const keeper = loadKeeper();
  const send = (ixs: any[], signers: Keypair[] = []) =>
    sendAndConfirmTransaction(conn, new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs), [keeper, ...signers], { commitment: 'confirmed' });

  // 1) on-chain market (unique expiry avoids PDA collision)
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 86400 + Math.floor(Math.random() * 100000);
  const market = findMarketPDA(keeper.publicKey, expiresAt);
  await send([createMarketIx(keeper.publicKey, String(question || 'Ilowa market').slice(0, 180), 'general', 'global', false, expiresAt)]);

  // 2) conditional vault
  const v = deriveVaultAccounts(market, collateralMint);
  await send([initConditionalVaultIx(keeper.publicKey, market, collateralMint)]);

  // 3) Manifest book (base = YES, quote = collateral)
  const { ixs, signers } = await Market.setupIxs(conn, v.yesMint, collateralMint, keeper.publicKey);
  const manifestMarket = signers[0].publicKey;
  await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [keeper, ...signers], { commitment: 'confirmed' });

  // 4) persist + link to the feed row
  const mapping: ClobMapping = {
    market_pubkey: market.toBase58(), vault: v.vault.toBase58(),
    yes_mint: v.yesMint.toBase58(), no_mint: v.noMint.toBase58(),
    collateral_vault: v.collateralVault.toBase58(), collateral_mint: collateralMint.toBase58(),
    manifest_market: manifestMarket.toBase58(), scalar_market_id: scalarMarketId,
  };
  const s = sb();
  if (s.url) {
    const ins = await fetch(`${s.url}/rest/v1/clob_markets?on_conflict=market_pubkey`, {
      method: 'POST', headers: { ...s.headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(mapping),
    }).catch(() => null);
    if (!ins || !ins.ok) throw new Error(`book created on-chain but link not saved: ${ins ? ins.status : 'network'}`);
  }
  return mapping;
}
