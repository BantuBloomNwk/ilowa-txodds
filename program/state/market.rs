use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub creator: Pubkey,
    #[max_len(280)]
    pub question: String,
    #[max_len(32)]
    pub category: String,
    #[max_len(32)]
    pub region: String,
    pub is_private: bool,
    pub status: MarketStatus,
    pub outcome: Option<bool>,
    pub yes_pool: u64,
    pub no_pool: u64,
    pub total_bets: u32,
    pub created_at: i64,
    pub expires_at: i64,
    pub resolved_at: Option<i64>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum MarketStatus {
    Active,
    Resolved,
    Expired,
    Disputed,
    Paused,
}

#[account]
#[derive(InitSpace)]
pub struct Bet {
    pub market: Pubkey,
    pub user: Pubkey,
    pub outcome: bool,
    pub amount: u64,
    pub is_shielded: bool,
    pub timestamp: i64,
    pub claimed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Subscription {
    pub subscriber: Pubkey,
    pub creator: Pubkey,
    pub tier: u8,
    pub expires_at: i64,
    pub auto_renew: bool,
    pub bump: u8,
}
