/**
 * Server-side conditional-vault helpers (raw web3 ixs, no Anchor Program / no stale
 * IDL). Mirrors app/src/lib/solana/market-writer.ts so the enable endpoint can init
 * a market's vault. Discriminator + account order come from the deployed IDL.
 */
import {
  PublicKey, SystemProgram, TransactionInstruction, AccountMeta, SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';

export const PROGRAM_ID = new PublicKey('HYDwFwax9U6svCRYWD7Fqq3TXxSSQCQ6CwKrb3ZTkD3z');
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

const DISC_INIT_CONDITIONAL_VAULT = Buffer.from([26, 206, 59, 168, 69, 69, 106, 141]);

const pda = (seeds: (Buffer | Uint8Array)[]) =>
  PublicKey.findProgramAddressSync(seeds.map((s) => Buffer.from(s)), PROGRAM_ID)[0];

export function deriveVaultAccounts(market: PublicKey, collateralMint: PublicKey) {
  const vault = pda([Buffer.from('cvault'), market.toBuffer()]);
  return {
    vault,
    collateralVault: pda([Buffer.from('cvault_collat'), vault.toBuffer()]),
    yesMint: pda([Buffer.from('cvault_yes'), vault.toBuffer()]),
    noMint: pda([Buffer.from('cvault_no'), vault.toBuffer()]),
  };
}

const ws = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: true, isWritable: true });
const w = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
const r = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });

// ── create_market (so the keeper can stand up the on-chain market a CLOB needs) ──
const DISC_CREATE_MARKET = Buffer.from([103, 226, 97, 235, 200, 188, 251, 254]);
const i64LE = (n: number): Buffer => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(Math.floor(n))); return b; };
const borshStr = (s: string): Buffer => { const u = Buffer.from(s, 'utf8'); const len = Buffer.alloc(4); len.writeUInt32LE(u.length); return Buffer.concat([len, u]); };

export function findMarketPDA(creator: PublicKey, expiresAt: number): PublicKey {
  return pda([Buffer.from('market'), creator.toBuffer(), i64LE(expiresAt)]);
}

/** create_market(question, category, region, is_private, expires_at). */
export function createMarketIx(creator: PublicKey, question: string, category: string, region: string, isPrivate: boolean, expiresAt: number): TransactionInstruction {
  const market = findMarketPDA(creator, expiresAt);
  const data = Buffer.concat([DISC_CREATE_MARKET, borshStr(question), borshStr(category), borshStr(region), Buffer.from([isPrivate ? 1 : 0]), i64LE(expiresAt)]);
  return new TransactionInstruction({ programId: PROGRAM_ID, keys: [ws(creator), w(market), r(SystemProgram.programId)], data });
}

/** init_conditional_vault — one-time per market. */
export function initConditionalVaultIx(payer: PublicKey, market: PublicKey, collateralMint: PublicKey): TransactionInstruction {
  const { vault, collateralVault, yesMint, noMint } = deriveVaultAccounts(market, collateralMint);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      ws(payer), r(market), r(collateralMint), w(vault), w(collateralVault),
      w(yesMint), w(noMint), r(TOKEN_PROGRAM_ID), r(SystemProgram.programId), r(SYSVAR_RENT_PUBKEY),
    ],
    data: DISC_INIT_CONDITIONAL_VAULT,
  });
}
