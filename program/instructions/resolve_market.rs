use anchor_lang::prelude::*;
use crate::state::market::*;
use crate::errors::IlowaError;

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(mut)]
    pub resolver: Signer<'info>,

    #[account(
        mut,
        constraint = market.status == MarketStatus::Active @ IlowaError::MarketNotActive,
        constraint = market.creator == resolver.key() @ IlowaError::Unauthorized,
    )]
    pub market: Account<'info, Market>,
}

pub fn resolve_market(
    ctx: Context<ResolveMarket>,
    outcome: bool,
) -> Result<()> {
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;

    market.status = MarketStatus::Resolved;
    market.outcome = Some(outcome);
    market.resolved_at = Some(clock.unix_timestamp);

    emit!(MarketResolved {
        market: market.key(),
        resolver: ctx.accounts.resolver.key(),
        outcome,
        yes_pool: market.yes_pool,
        no_pool: market.no_pool,
    });

    Ok(())
}

#[event]
pub struct MarketResolved {
    pub market: Pubkey,
    pub resolver: Pubkey,
    pub outcome: bool,
    pub yes_pool: u64,
    pub no_pool: u64,
}
