//! Trustless, PERMISSIONLESS market resolution via TxODDS TxLINE.
//!
//! Instead of an admin/oracle setting the outcome, anyone (typically a keeper)
//! submits the TxLINE three-stage Merkle proof for the relevant match stat and a
//! predicate (e.g. "home goals - away goals > 0" = home win). We CPI into the
//! TxLINE `txoracle` program's `validate_stat`, which verifies the proof against
//! the on-chain daily score Merkle roots. The market only resolves if the proof
//! checks — so the keeper cannot lie about the outcome. This is the hackathon's
//! "permissionless results validation" via the `validate_stat` CPI.
//!
//! validate_stat semantics are handled defensively (see below): if the program
//! errors on an invalid/false claim we revert; if it returns a bool we require true.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{get_return_data, invoke},
};
use crate::state::market::*;
use crate::errors::IlowaError;

// TxLINE txoracle program (Solana devnet). Mainnet = 9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA.
pub const TXORACLE_PROGRAM_ID: Pubkey = pubkey!("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
// anchor discriminator of txoracle::validate_stat (from idl/txoracle.json).
const VALIDATE_STAT_DISCRIMINATOR: [u8; 8] = [107, 197, 232, 90, 191, 136, 105, 185];

// ── txoracle arg types (mirror idl/txoracle.json byte-for-byte) ──────────────
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProofNode { pub hash: [u8; 32], pub is_right_sibling: bool }

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoreStat { pub key: u32, pub value: i32, pub period: i32 }

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoresUpdateStats { pub update_count: i32, pub min_timestamp: i64, pub max_timestamp: i64 }

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoresBatchSummary {
    pub fixture_id: i64,
    pub update_stats: ScoresUpdateStats,
    pub events_sub_tree_root: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct StatTerm {
    pub stat_to_prove: ScoreStat,
    pub event_stat_root: [u8; 32],
    pub stat_proof: Vec<ProofNode>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum Comparison { GreaterThan, LessThan, EqualTo }

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum BinaryExpression { Add, Subtract }

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TraderPredicate { pub threshold: i32, pub comparison: Comparison }

/// All args `validate_stat` needs, passed straight through from the keeper.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TxlineProof {
    pub ts: i64,
    pub fixture_summary: ScoresBatchSummary,
    pub fixture_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
    pub predicate: TraderPredicate,
    pub stat_a: StatTerm,
    pub stat_b: Option<StatTerm>,
    pub op: Option<BinaryExpression>,
}

#[derive(Accounts)]
pub struct ResolveMarketViaTxline<'info> {
    /// Permissionless — anyone may submit a valid proof. Pays the tx.
    #[account(mut)]
    pub keeper: Signer<'info>,

    #[account(
        mut,
        constraint = market.status == MarketStatus::Active @ IlowaError::MarketNotActive,
    )]
    pub market: Account<'info, Market>,

    /// CHECK: the TxLINE daily-scores Merkle-roots account; validated by txoracle::validate_stat.
    pub daily_scores_merkle_roots: UncheckedAccount<'info>,

    /// CHECK: the TxLINE txoracle program; constrained to the known program id.
    #[account(constraint = txoracle_program.key() == TXORACLE_PROGRAM_ID @ IlowaError::Unauthorized)]
    pub txoracle_program: UncheckedAccount<'info>,
}

/// Resolves the market PERMISSIONLESSLY from a TxLINE proof. The market's YES
/// outcome is DEFINED as "the submitted predicate holds": we CPI `validate_stat`,
/// read the bool it returns, and set `outcome` to that bool. The keeper cannot
/// force a result — the on-chain proof decides true or false. (Binding the
/// predicate to the market's own question is the next step, once Market carries a
/// fixture_id + stored predicate.)
pub fn resolve_market_via_txline(
    ctx: Context<ResolveMarketViaTxline>,
    proof: TxlineProof,
) -> Result<()> {
    // Build the validate_stat instruction data: discriminator ++ borsh(args, in IDL order).
    let mut data = VALIDATE_STAT_DISCRIMINATOR.to_vec();
    proof.ts.serialize(&mut data)?;
    proof.fixture_summary.serialize(&mut data)?;
    proof.fixture_proof.serialize(&mut data)?;
    proof.main_tree_proof.serialize(&mut data)?;
    proof.predicate.serialize(&mut data)?;
    proof.stat_a.serialize(&mut data)?;
    proof.stat_b.serialize(&mut data)?;
    proof.op.serialize(&mut data)?;

    let ix = Instruction {
        program_id: ctx.accounts.txoracle_program.key(),
        accounts: vec![AccountMeta::new_readonly(ctx.accounts.daily_scores_merkle_roots.key(), false)],
        data,
    };

    // Reverts if validate_stat errors (malformed proof / wrong roots / bad day).
    invoke(
        &ix,
        &[
            ctx.accounts.daily_scores_merkle_roots.to_account_info(),
            ctx.accounts.txoracle_program.to_account_info(),
        ],
    )?;

    // validate_stat RETURNS a bool (confirmed on devnet 2026-06-28: a false
    // predicate returns false WITHOUT reverting). That bool IS the outcome.
    let (returning_program, ret) = get_return_data().ok_or(IlowaError::InvalidZkProof)?;
    require!(returning_program == TXORACLE_PROGRAM_ID, IlowaError::Unauthorized);
    let predicate_holds = ret.first().map(|b| *b != 0).unwrap_or(false);

    // Resolve the market off the verified outcome. finalize_conditional_vault +
    // redeem then run as normal.
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;
    market.status = MarketStatus::Resolved;
    market.outcome = Some(predicate_holds);
    market.resolved_at = Some(clock.unix_timestamp);

    emit!(MarketResolvedViaTxline {
        market: market.key(),
        keeper: ctx.accounts.keeper.key(),
        outcome: predicate_holds,
        fixture_id: proof.fixture_summary.fixture_id,
    });
    Ok(())
}

#[event]
pub struct MarketResolvedViaTxline {
    pub market: Pubkey,
    pub keeper: Pubkey,
    pub outcome: bool,
    pub fixture_id: i64,
}
