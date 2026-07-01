use anchor_lang::prelude::*;
use crate::state::market::*;
use crate::errors::IlowaError;

#[derive(Accounts)]
#[instruction(question: String, category: String, region: String, is_private: bool, expires_at: i64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [b"market", creator.key().as_ref(), &expires_at.to_le_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,

    pub system_program: Program<'info, System>,
}

pub fn create_market(
    ctx: Context<CreateMarket>,
    question: String,
    category: String,
    region: String,
    is_private: bool,
    expires_at: i64,
) -> Result<()> {
    require!(question.len() <= 280, IlowaError::QuestionTooLong);

    let clock = Clock::get()?;
    require!(expires_at > clock.unix_timestamp, IlowaError::InvalidExpiry);

    let market = &mut ctx.accounts.market;
    market.creator = ctx.accounts.creator.key();
    market.question = question;
    market.category = category;
    market.region = region;
    market.is_private = is_private;
    market.status = MarketStatus::Active;
    market.outcome = None;
    market.yes_pool = 0;
    market.no_pool = 0;
    market.total_bets = 0;
    market.created_at = clock.unix_timestamp;
    market.expires_at = expires_at;
    market.resolved_at = None;
    market.bump = ctx.bumps.market;

    emit!(MarketCreated {
        market: market.key(),
        creator: ctx.accounts.creator.key(),
        expires_at,
    });

    Ok(())
}

#[event]
pub struct MarketCreated {
    pub market: Pubkey,
    pub creator: Pubkey,
    pub expires_at: i64,
}
