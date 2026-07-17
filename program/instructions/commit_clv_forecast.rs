use anchor_lang::prelude::*;
use crate::state::clv_commitment::ClvCommitment;
use crate::errors::IlowaError;

/// Provable-CLV Elder, phase 2. Writes the Elder's pre-close probability commitment on-chain,
/// init-only, so the "committed before close, cannot be backdated" claim is trustless instead
/// of server-attested (see docs/specs/provable-clv-elder.md §9). Keeper-signed: the keeper pays
/// and calls this the moment the Elder forms a probability, before the market closes. Nobody,
/// including us, can call this twice for the same (market, elder_version, kind) — `init`
/// rejects a second attempt outright, which is the actual backdating defense.
pub fn commit_clv_forecast(
    ctx: Context<CommitClvForecast>,
    elder_version_hash: [u8; 32],
    kind_hash: [u8; 32],
    p_implied_bps: u16,
) -> Result<()> {
    require!(p_implied_bps <= 10_000, IlowaError::InvalidProbability);

    let clock = Clock::get()?;
    let c = &mut ctx.accounts.commitment;
    c.market = ctx.accounts.market.key();
    c.elder_version_hash = elder_version_hash;
    c.kind_hash = kind_hash;
    c.p_implied_bps = p_implied_bps;
    c.committed_slot = clock.slot;
    c.committed_unix = clock.unix_timestamp;
    c.bump = ctx.bumps.commitment;

    emit!(ClvForecastCommitted {
        market: c.market,
        elder_version_hash,
        kind_hash,
        p_implied_bps,
        committed_slot: c.committed_slot,
    });

    Ok(())
}

#[derive(Accounts)]
#[instruction(elder_version_hash: [u8; 32], kind_hash: [u8; 32])]
pub struct CommitClvForecast<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,

    /// CHECK: only used as a PDA seed anchor (the CLOB market pubkey), never read or written.
    pub market: UncheckedAccount<'info>,

    #[account(
        init,
        payer = keeper,
        space = 8 + ClvCommitment::SPACE,
        seeds = [b"clv_commit", market.key().as_ref(), elder_version_hash.as_ref(), kind_hash.as_ref()],
        bump,
    )]
    pub commitment: Account<'info, ClvCommitment>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct ClvForecastCommitted {
    pub market: Pubkey,
    pub elder_version_hash: [u8; 32],
    pub kind_hash: [u8; 32],
    pub p_implied_bps: u16,
    pub committed_slot: u64,
}
