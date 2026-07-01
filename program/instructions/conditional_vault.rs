use anchor_lang::prelude::*;
use anchor_spl::token::{
    self, Burn, Mint, MintTo, Token, TokenAccount, Transfer,
};

use crate::errors::IlowaError;
use crate::state::conditional_vault::ConditionalVault;
use crate::state::market::{Market, MarketStatus};

// PDA seeds
pub const CVAULT_SEED: &[u8] = b"cvault";
pub const CVAULT_COLLATERAL_SEED: &[u8] = b"cvault_collat";
pub const CVAULT_YES_SEED: &[u8] = b"cvault_yes";
pub const CVAULT_NO_SEED: &[u8] = b"cvault_no";

// ── init_conditional_vault ────────────────────────────────────────────────
// One-time per market: create the vault PDA, its collateral token account, and
// the YES/NO outcome mints (mint authority = vault PDA, decimals = collateral's).

#[derive(Accounts)]
pub struct InitConditionalVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    // The bound prediction market. Must still be active so outcome tokens are
    // only ever issued before resolution.
    #[account(
        constraint = market.status == MarketStatus::Active @ IlowaError::MarketNotActive,
    )]
    pub market: Account<'info, Market>,

    pub collateral_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        space = 8 + ConditionalVault::INIT_SPACE,
        seeds = [CVAULT_SEED, market.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, ConditionalVault>,

    #[account(
        init,
        payer = payer,
        seeds = [CVAULT_COLLATERAL_SEED, vault.key().as_ref()],
        bump,
        token::mint = collateral_mint,
        token::authority = vault,
    )]
    pub collateral_vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = payer,
        seeds = [CVAULT_YES_SEED, vault.key().as_ref()],
        bump,
        mint::decimals = collateral_mint.decimals,
        mint::authority = vault,
    )]
    pub yes_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        seeds = [CVAULT_NO_SEED, vault.key().as_ref()],
        bump,
        mint::decimals = collateral_mint.decimals,
        mint::authority = vault,
    )]
    pub no_mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn init_conditional_vault(ctx: Context<InitConditionalVault>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.market = ctx.accounts.market.key();
    vault.collateral_mint = ctx.accounts.collateral_mint.key();
    vault.collateral_vault = ctx.accounts.collateral_vault.key();
    vault.yes_mint = ctx.accounts.yes_mint.key();
    vault.no_mint = ctx.accounts.no_mint.key();
    vault.authority = ctx.accounts.payer.key();
    vault.finalized = false;
    vault.winning_outcome = None;
    vault.decimals = ctx.accounts.collateral_mint.decimals;
    vault.bump = ctx.bumps.vault;

    emit!(ConditionalVaultInitialized {
        vault: vault.key(),
        market: vault.market,
        collateral_mint: vault.collateral_mint,
        yes_mint: vault.yes_mint,
        no_mint: vault.no_mint,
    });
    Ok(())
}

// ── split ─────────────────────────────────────────────────────────────────
// Lock `amount` collateral, mint `amount` YES + `amount` NO to the depositor.

#[derive(Accounts)]
pub struct SplitTokens<'info> {
    pub user: Signer<'info>,

    #[account(
        seeds = [CVAULT_SEED, vault.market.as_ref()],
        bump = vault.bump,
        constraint = !vault.finalized @ IlowaError::MarketAlreadyResolved,
    )]
    pub vault: Account<'info, ConditionalVault>,

    #[account(mut, address = vault.collateral_vault)]
    pub collateral_vault: Account<'info, TokenAccount>,
    #[account(mut, address = vault.yes_mint)]
    pub yes_mint: Account<'info, Mint>,
    #[account(mut, address = vault.no_mint)]
    pub no_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = user_collateral.mint == vault.collateral_mint @ IlowaError::InvalidCommitment,
        constraint = user_collateral.owner == user.key() @ IlowaError::Unauthorized,
    )]
    pub user_collateral: Account<'info, TokenAccount>,
    #[account(mut, constraint = user_yes.mint == vault.yes_mint @ IlowaError::InvalidCommitment)]
    pub user_yes: Account<'info, TokenAccount>,
    #[account(mut, constraint = user_no.mint == vault.no_mint @ IlowaError::InvalidCommitment)]
    pub user_no: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn split(ctx: Context<SplitTokens>, amount: u64) -> Result<()> {
    require!(amount > 0, IlowaError::InsufficientFunds);

    // 1. pull collateral from the user into the vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.user_collateral.to_account_info(),
                to: ctx.accounts.collateral_vault.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    // 2. mint the matched outcome-token pair, vault PDA signs
    let market_key = ctx.accounts.vault.market;
    let signer_seeds: &[&[&[u8]]] = &[&[CVAULT_SEED, market_key.as_ref(), &[ctx.accounts.vault.bump]]];

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.yes_mint.to_account_info(),
                to: ctx.accounts.user_yes.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.no_mint.to_account_info(),
                to: ctx.accounts.user_no.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    emit!(TokensSplit { vault: ctx.accounts.vault.key(), user: ctx.accounts.user.key(), amount });
    Ok(())
}

// ── merge ─────────────────────────────────────────────────────────────────
// Burn `amount` YES + `amount` NO, return `amount` collateral. Available any
// time before finalize (a complete set is always worth exactly its collateral).

#[derive(Accounts)]
pub struct MergeTokens<'info> {
    pub user: Signer<'info>,

    #[account(
        seeds = [CVAULT_SEED, vault.market.as_ref()],
        bump = vault.bump,
        constraint = !vault.finalized @ IlowaError::MarketAlreadyResolved,
    )]
    pub vault: Account<'info, ConditionalVault>,

    #[account(mut, address = vault.collateral_vault)]
    pub collateral_vault: Account<'info, TokenAccount>,
    #[account(mut, address = vault.yes_mint)]
    pub yes_mint: Account<'info, Mint>,
    #[account(mut, address = vault.no_mint)]
    pub no_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = user_collateral.mint == vault.collateral_mint @ IlowaError::InvalidCommitment,
        constraint = user_collateral.owner == user.key() @ IlowaError::Unauthorized,
    )]
    pub user_collateral: Account<'info, TokenAccount>,
    #[account(mut, constraint = user_yes.mint == vault.yes_mint @ IlowaError::InvalidCommitment)]
    pub user_yes: Account<'info, TokenAccount>,
    #[account(mut, constraint = user_no.mint == vault.no_mint @ IlowaError::InvalidCommitment)]
    pub user_no: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn merge(ctx: Context<MergeTokens>, amount: u64) -> Result<()> {
    require!(amount > 0, IlowaError::InsufficientFunds);

    // burn the complete set from the user
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Burn {
                mint: ctx.accounts.yes_mint.to_account_info(),
                from: ctx.accounts.user_yes.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Burn {
                mint: ctx.accounts.no_mint.to_account_info(),
                from: ctx.accounts.user_no.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    // return the collateral, vault PDA signs
    let market_key = ctx.accounts.vault.market;
    let signer_seeds: &[&[&[u8]]] = &[&[CVAULT_SEED, market_key.as_ref(), &[ctx.accounts.vault.bump]]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.collateral_vault.to_account_info(),
                to: ctx.accounts.user_collateral.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    emit!(TokensMerged { vault: ctx.accounts.vault.key(), user: ctx.accounts.user.key(), amount });
    Ok(())
}

// ── finalize_conditional_vault ─────────────────────────────────────────────
// Permissionless. Mirrors the bound market's outcome into the vault once it has
// resolved. NO second oracle — this only copies the existing settlement.

#[derive(Accounts)]
pub struct FinalizeConditionalVault<'info> {
    pub cranker: Signer<'info>,

    #[account(
        mut,
        seeds = [CVAULT_SEED, vault.market.as_ref()],
        bump = vault.bump,
        constraint = !vault.finalized @ IlowaError::MarketAlreadyResolved,
    )]
    pub vault: Account<'info, ConditionalVault>,

    #[account(
        address = vault.market,
        constraint = market.status == MarketStatus::Resolved @ IlowaError::MarketNotResolved,
    )]
    pub market: Account<'info, Market>,
}

pub fn finalize_conditional_vault(ctx: Context<FinalizeConditionalVault>) -> Result<()> {
    let outcome = ctx.accounts.market.outcome.ok_or(IlowaError::MarketNotResolved)?;
    let vault = &mut ctx.accounts.vault;
    vault.winning_outcome = Some(outcome);
    vault.finalized = true;

    emit!(ConditionalVaultFinalized { vault: vault.key(), market: vault.market, winning_outcome: outcome });
    Ok(())
}

// ── redeem ─────────────────────────────────────────────────────────────────
// After finalize, burn `amount` of the WINNING outcome token for `amount`
// collateral. The losing token is worth nothing and is never redeemable.

#[derive(Accounts)]
pub struct RedeemTokens<'info> {
    pub user: Signer<'info>,

    #[account(
        seeds = [CVAULT_SEED, vault.market.as_ref()],
        bump = vault.bump,
        constraint = vault.finalized @ IlowaError::MarketNotResolved,
    )]
    pub vault: Account<'info, ConditionalVault>,

    #[account(mut, address = vault.collateral_vault)]
    pub collateral_vault: Account<'info, TokenAccount>,

    // The winning mint, selected by the resolved outcome. The handler asserts
    // this matches yes_mint/no_mint per vault.winning_outcome.
    #[account(mut)]
    pub winning_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = user_winning.mint == winning_mint.key() @ IlowaError::InvalidCommitment,
        constraint = user_winning.owner == user.key() @ IlowaError::Unauthorized,
    )]
    pub user_winning: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_collateral.mint == vault.collateral_mint @ IlowaError::InvalidCommitment,
        constraint = user_collateral.owner == user.key() @ IlowaError::Unauthorized,
    )]
    pub user_collateral: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

pub fn redeem(ctx: Context<RedeemTokens>, amount: u64) -> Result<()> {
    require!(amount > 0, IlowaError::InsufficientFunds);

    let winning = ctx.accounts.vault.winning_outcome.ok_or(IlowaError::MarketNotResolved)?;
    let expected_mint = if winning { ctx.accounts.vault.yes_mint } else { ctx.accounts.vault.no_mint };
    require_keys_eq!(ctx.accounts.winning_mint.key(), expected_mint, IlowaError::InvalidCommitment);

    // burn the winning token from the user
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Burn {
                mint: ctx.accounts.winning_mint.to_account_info(),
                from: ctx.accounts.user_winning.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    // pay out collateral 1:1, vault PDA signs
    let market_key = ctx.accounts.vault.market;
    let signer_seeds: &[&[&[u8]]] = &[&[CVAULT_SEED, market_key.as_ref(), &[ctx.accounts.vault.bump]]];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.collateral_vault.to_account_info(),
                to: ctx.accounts.user_collateral.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    emit!(TokensRedeemed { vault: ctx.accounts.vault.key(), user: ctx.accounts.user.key(), amount, winning_outcome: winning });
    Ok(())
}

// ── events ─────────────────────────────────────────────────────────────────

#[event]
pub struct ConditionalVaultInitialized {
    pub vault: Pubkey,
    pub market: Pubkey,
    pub collateral_mint: Pubkey,
    pub yes_mint: Pubkey,
    pub no_mint: Pubkey,
}

#[event]
pub struct TokensSplit { pub vault: Pubkey, pub user: Pubkey, pub amount: u64 }

#[event]
pub struct TokensMerged { pub vault: Pubkey, pub user: Pubkey, pub amount: u64 }

#[event]
pub struct ConditionalVaultFinalized { pub vault: Pubkey, pub market: Pubkey, pub winning_outcome: bool }

#[event]
pub struct TokensRedeemed { pub vault: Pubkey, pub user: Pubkey, pub amount: u64, pub winning_outcome: bool }
