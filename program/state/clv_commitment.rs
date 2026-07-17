use anchor_lang::prelude::*;

/// Provable-CLV Elder — phase 2 (docs/specs/provable-clv-elder.md §9). Phase 1 stored the
/// Elder's pre-close probability commitment in our own database with a slot number attached;
/// that proves the arithmetic is checkable, not that the commitment itself couldn't have been
/// written or backdated by us. This account moves the commitment itself on-chain: init-only, so
/// once written it can never be mutated, and Clock::get() at write time is Solana's own
/// consensus-derived slot, not a value we hand it. A skeptic reads this account directly and
/// needs to trust nothing but the chain.
///
/// PDA seeds: ["clv_commit", market, elder_version_hash, kind_hash]. One commitment per
/// (market, elder build, market kind) — a second attempt at the same seeds fails at `init`,
/// which is the actual anti-backdating property: nobody, including us, can overwrite a
/// commitment once it lands.
#[account]
pub struct ClvCommitment {
    pub market: Pubkey,
    /// SHA-256 of the elder_version string (e.g. "elder-odds-v1" or
    /// "elder-independent-model-v1"). Fixed-width so this account never needs a resize
    /// migration when a version string's length changes.
    pub elder_version_hash: [u8; 32],
    /// SHA-256 of the market kind string (e.g. "corners_over_8_5").
    pub kind_hash: [u8; 32],
    /// Implied probability in basis points, 0..=10_000.
    pub p_implied_bps: u16,
    /// Solana's own slot at write time — the "before close" anchor. This is what
    /// `committed_slot < close_slot` (the eligibility rule) actually compares against.
    pub committed_slot: u64,
    pub committed_unix: i64,
    pub bump: u8,
}

impl ClvCommitment {
    /// Data size, excluding the 8-byte Anchor discriminator.
    ///   market              32
    ///   elder_version_hash  32
    ///   kind_hash           32
    ///   p_implied_bps        2
    ///   committed_slot       8
    ///   committed_unix       8
    ///   bump                 1
    pub const SPACE: usize = 32 + 32 + 32 + 2 + 8 + 8 + 1;
}
