/**
 * Seed a small 2-sided book on a WSOL World Cup CLOB market so users can actually
 * trade (an empty book can't fill). Maker = ~/.config/solana/id.json. Wraps the
 * SOL it needs into WSOL, splits collateral -> YES, posts tight asks + bids.
 *
 *   npx tsx scripts/clob-seed-wc.ts --market <pda> --manifest <book>
 */
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction, NATIVE_MINT } from '@solana/spl-token';
import { ManifestClient, OrderType } from '@cks-systems/manifest-sdk';
import { splitIx, createAtaIx, deriveVaultAccounts, findATA } from '../app/src/lib/solana/market-writer';
import { readFileSync } from 'fs';
import os from 'os';

const RPC = process.env.RPC || 'https://api.devnet.solana.com';
const conn = new Connection(RPC, 'confirmed');
const maker = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${os.homedir()}/.config/solana/id.json`, 'utf8'))));
const arg = (f: string) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
const ILOWA_MARKET = new PublicKey(arg('--market')!);
const MANIFEST_MARKET = new PublicKey(arg('--manifest')!);
const COLLATERAL = NATIVE_MINT; // WSOL
const DEC = 9, UNIT = 10 ** DEC; // WSOL + the vault's YES/NO mints are 9-decimal

// tight book around the implied odds (small sizes = small real-SOL cost)
const SZ = Number(arg('--size')) || 0.5;
const BIDS = [{ price: 0.50, size: SZ }, { price: 0.44, size: SZ }, { price: 0.38, size: SZ }];
const ASKS = [{ price: 0.62, size: SZ }, { price: 0.68, size: SZ }, { price: 0.75, size: SZ }];
const NEED_YES = ASKS.reduce((s, a) => s + a.size, 0);
const BID_COST = BIDS.reduce((s, b) => s + b.price * b.size, 0);

const sendTx = (ixs: any[], extra: Keypair[] = []) =>
  sendAndConfirmTransaction(conn, new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs), [maker, ...extra], { commitment: 'confirmed' });
const bal = async (mint: PublicKey) => { try { return Number((await getAccount(conn, await getAssociatedTokenAddress(mint, maker.publicKey))).amount) / UNIT; } catch { return 0; } };

(async () => {
  console.log(`seed WC book → market ${ILOWA_MARKET.toBase58()} book ${MANIFEST_MARKET.toBase58()}`);
  const v = deriveVaultAccounts(ILOWA_MARKET, COLLATERAL, maker.publicKey);

  // 1) wrap the WSOL we need (split YES + bid collateral + buffer)
  const needWsol = NEED_YES + BID_COST + 0.3;
  const haveWsol = await bal(COLLATERAL);
  if (haveWsol < needWsol) {
    const ata = getAssociatedTokenAddressSync(COLLATERAL, maker.publicKey, true);
    const lamports = Math.ceil((needWsol - haveWsol) * 1e9);
    console.log(`wrapping ${(needWsol - haveWsol).toFixed(2)} SOL -> WSOL`);
    await sendTx([
      createAssociatedTokenAccountIdempotentInstruction(maker.publicKey, ata, maker.publicKey, COLLATERAL),
      SystemProgram.transfer({ fromPubkey: maker.publicKey, toPubkey: ata, lamports }),
      createSyncNativeInstruction(ata),
    ]);
  }

  // 2) split WSOL -> YES+NO for the asks
  const need: any[] = [];
  for (const mint of [v.yesMint, v.noMint]) if (!(await conn.getAccountInfo(findATA(maker.publicKey, mint)))) need.push(createAtaIx(maker.publicKey, maker.publicKey, mint));
  const haveYes = await bal(v.yesMint);
  const splitNeed = Math.max(0, NEED_YES - haveYes);
  if (splitNeed > 0) await sendTx([...need, splitIx(maker.publicKey, ILOWA_MARKET, COLLATERAL, Math.ceil(splitNeed * UNIT))]);
  else if (need.length) await sendTx(need);
  console.log(`YES held: ${await bal(v.yesMint)}`);

  // 3) seat
  const s0 = await ManifestClient.getSetupIxs(conn, MANIFEST_MARKET, maker.publicKey);
  if (s0.setupNeeded) await sendTx(s0.instructions, s0.wrapperKeypair ? [s0.wrapperKeypair] : []);
  for (let i = 0; i < 12; i++) { const s = await ManifestClient.getSetupIxs(conn, MANIFEST_MARKET, maker.publicKey); if (!s.setupNeeded) break; await new Promise((r) => setTimeout(r, 2500)); }

  // 4) place
  const client = await ManifestClient.getClientForMarketNoPrivateKey(conn, MANIFEST_MARKET, maker.publicKey);
  const place = async (isBid: boolean, price: number, size: number) => {
    const ixs = await client.placeOrderWithRequiredDepositIxs(maker.publicKey, { numBaseTokens: size, tokenPrice: price, isBid, orderType: OrderType.Limit, clientOrderId: Date.now() + Math.floor(Math.random() * 1000), lastValidSlot: 0 });
    await sendTx(ixs); console.log(`  ${isBid ? 'BID' : 'ASK'} ${size} @ ${price}`);
  };
  for (const b of BIDS) await place(true, b.price, b.size);
  for (const a of ASKS) await place(false, a.price, a.size);

  const book = await fetch(`https://ilowa-api.fly.dev/api/clob/book/${MANIFEST_MARKET.toBase58()}`).then((r) => r.json()).catch(() => null);
  console.log('book:', JSON.stringify(book));
  process.exit(book && book.bids?.length && book.asks?.length ? 0 : 1);
})().catch((e) => { console.error('ERROR', e?.message || e); process.exit(1); });
