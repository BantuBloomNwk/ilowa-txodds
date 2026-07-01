/**
 * Place a single resting BID on a WSOL CLOB market (maker = id.json), wrapping the
 * SOL it needs. Used to lift the bid side so a take-profit sell fills on camera.
 *   npx tsx scripts/clob-add-bid.ts --manifest <book> --price 0.61 --size 1
 */
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction, NATIVE_MINT } from '@solana/spl-token';
import { ManifestClient, OrderType } from '@cks-systems/manifest-sdk';
import { readFileSync } from 'fs';
import os from 'os';

const RPC = process.env.RPC || 'https://api.devnet.solana.com';
const conn = new Connection(RPC, 'confirmed');
const maker = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(`${os.homedir()}/.config/solana/id.json`, 'utf8'))));
const arg = (f: string) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
const MANIFEST = new PublicKey(arg('--manifest')!);
const PRICE = Number(arg('--price') || 0.61), SIZE = Number(arg('--size') || 1);
const send = (ixs: any[], extra: Keypair[] = []) => sendAndConfirmTransaction(conn, new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs), [maker, ...extra], { commitment: 'confirmed' });

(async () => {
  // wrap WSOL for the bid collateral (+buffer)
  const need = PRICE * SIZE + 0.2;
  const ata = getAssociatedTokenAddressSync(NATIVE_MINT, maker.publicKey, true);
  let have = 0; try { have = Number((await getAccount(conn, ata)).amount) / 1e9; } catch {}
  if (have < need) await send([
    createAssociatedTokenAccountIdempotentInstruction(maker.publicKey, ata, maker.publicKey, NATIVE_MINT),
    SystemProgram.transfer({ fromPubkey: maker.publicKey, toPubkey: ata, lamports: Math.ceil((need - have) * 1e9) }),
    createSyncNativeInstruction(ata),
  ]);
  const s0 = await ManifestClient.getSetupIxs(conn, MANIFEST, maker.publicKey);
  if (s0.setupNeeded) await send(s0.instructions, s0.wrapperKeypair ? [s0.wrapperKeypair] : []);
  const client = await ManifestClient.getClientForMarketNoPrivateKey(conn, MANIFEST, maker.publicKey);
  const ixs = await client.placeOrderWithRequiredDepositIxs(maker.publicKey, { numBaseTokens: SIZE, tokenPrice: PRICE, isBid: true, orderType: OrderType.Limit, clientOrderId: Date.now(), lastValidSlot: 0 });
  await send(ixs);
  const book = await fetch(`https://ilowa-api.fly.dev/api/clob/book/${MANIFEST.toBase58()}`).then((r) => r.json()).catch(() => null);
  console.log(`placed BID ${SIZE} @ ${PRICE}\nbook:`, JSON.stringify(book));
})().catch((e) => { console.error('ERROR', e?.message || e); process.exit(1); });
