use anchor_lang::prelude::*;
use crate::state::market::{Market, MarketStatus, Bet};
use crate::errors::IlowaError;

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        constraint = market.status == MarketStatus::Resolved @ IlowaError::MarketNotResolved,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"bet", market.key().as_ref(), user.key().as_ref()],
        bump = bet.bump,
        constraint = bet.user == user.key() @ IlowaError::Unauthorized,
        constraint = !bet.claimed @ IlowaError::AlreadyClaimed,
    )]
    pub bet: Account<'info, Bet>,

    /// CHECK: Market vault PDA that holds the funds
    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub market_vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
    let market = &ctx.accounts.market;
    let bet = &mut ctx.accounts.bet;

    // Check if user won
    let market_outcome = market.outcome.ok_or(IlowaError::MarketNotResolved)?;
    require!(bet.outcome == market_outcome, IlowaError::BetLost);

    // Calculate winnings
    // Winner gets: their bet + proportional share of losing pool
    let (winning_pool, losing_pool) = if market_outcome {
        (market.yes_pool, market.no_pool)
    } else {
        (market.no_pool, market.yes_pool)
    };

    // Prevent division by zero
    require!(winning_pool > 0, IlowaError::NoWinningBets);

    // User's share = (bet_amount / winning_pool) * (winning_pool + losing_pool)
    // Simplified: bet_amount + (bet_amount * losing_pool / winning_pool)
    let winnings = bet.amount
        .checked_add(
            bet.amount
                .checked_mul(losing_pool)
                .ok_or(IlowaError::ArithmeticOverflow)?
                .checked_div(winning_pool)
                .ok_or(IlowaError::ArithmeticOverflow)?
        )
        .ok_or(IlowaError::ArithmeticOverflow)?;

    // Transfer winnings from vault to user
    let market_key = market.key();
    let seeds = &[
        b"vault",
        market_key.as_ref(),
        &[ctx.bumps.market_vault],
    ];
    let signer_seeds = &[&seeds[..]];

    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.key(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.market_vault.to_account_info(),
                to: ctx.accounts.user.to_account_info(),
            },
            signer_seeds,
        ),
        winnings,
    )?;

    // Mark bet as claimed
    bet.claimed = true;

    emit!(WinningsClaimed {
        market: market.key(),
        user: ctx.accounts.user.key(),
        amount: winnings,
    });

    Ok(())
}

#[event]
pub struct WinningsClaimed {
    pub market: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
}
