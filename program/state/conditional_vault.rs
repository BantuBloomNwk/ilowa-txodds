use anchor_lang::prelude::*;

/// A conditional-token vault bound to one prediction `Market`.
///
/// It mints a matched pair of SPL outcome tokens (YES / NO) against deposited
/// collateral, 1:1. `split` locks N collateral and mints N YES + N NO; `merge`
/// burns N YES + N NO and returns N collateral. After the bound market resolves,
/// `finalize` mirrors the market's outcome here and `redeem` lets holders of the
/// winning token burn it 1:1 for collateral (the losing token is worth nothing).
///
/// The point of real SPL outcome tokens (rather than an internal ledger) is that
/// they are tradable on an external spot CLOB (Manifest): a resting YES book
/// priced in collateral IS the live, arbitraged probability of the event.
///
/// Settlement reuses the EXISTING market resolution — `finalize` only copies
/// `Market.outcome` once `Market.status == Resolved`. The vault introduces NO
/// second oracle path. See docs/specs/clob-outcome-token.md.
#[account]
#[derive(InitSpace)]
pub struct ConditionalVault {
    /// The prediction market this vault settles against (the oracle of record).
    pub market: Pubkey,
    /// Collateral SPL mint (e.g. wrapped SOL).
    pub collateral_mint: Pubkey,
    /// PDA-owned token account holding all deposited collateral.
    pub collateral_vault: Pubkey,
    /// YES outcome-token mint (mint authority = this vault PDA).
    pub yes_mint: Pubkey,
    /// NO outcome-token mint (mint authority = this vault PDA).
    pub no_mint: Pubkey,
    /// Whoever initialized the vault (record-keeping; `finalize` is permissionless).
    pub authority: Pubkey,
    /// Set true once the bound market has resolved and the outcome is mirrored.
    pub finalized: bool,
    /// The winning side, mirrored from `Market.outcome` at finalize.
    pub winning_outcome: Option<bool>,
    /// Decimals of the outcome mints (kept equal to the collateral mint so
    /// amounts map 1:1 and integer math stays exact).
    pub decimals: u8,
    pub bump: u8,
}
