use soroban_sdk::{contracttype, Address, String};

/// Keys for the contract's instance and persistent storage.
///
/// Admin, Arbiter, Token and NextId live in instance storage. Each
/// RentalAgreement lives in persistent storage keyed by its id so that it
/// can carry an independent TTL.
#[contracttype]
pub enum DataKey {
    Admin,
    Arbiter,
    Token,
    NextId,
    Agreement(u64),
}

/// A rental agreement between an owner and a renter.
///
/// `item_ref` is an opaque pointer to the app-side listing (for example a
/// listing UUID); no listing metadata is stored on-chain.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RentalAgreement {
    pub id: u64,
    pub owner: Address,
    pub renter: Address,
    pub item_ref: String,
    pub rental_amount: i128,
    pub deposit_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub claim_window_secs: u64,
    pub status: AgreementStatus,
    pub created_at: u64,
    /// Ledger timestamp `fund_agreement` transitioned this agreement to
    /// `Funded`. `0` (its default) while the agreement is still `Created`.
    /// Anchors the `Funded` recovery timeout in `reclaim_funded_agreement`
    /// so recovery availability doesn't depend on `start_time`, which is
    /// negotiated separately and can already be in the past when funding
    /// happens.
    pub funded_at: u64,
}

/// Lifecycle of an agreement. Transitions are enforced per function; see
/// the individual function doc comments.
///
/// New variants must be appended at the end, never inserted: the indexer
/// (`indexer/src/listener.ts`) decodes this enum by its on-chain variant
/// index (`STATUS_NAMES`), so reordering existing variants would silently
/// relabel every already-indexed agreement's status.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AgreementStatus {
    Created,
    Funded,
    Active,
    Disputed,
    Resolved,
    Completed,
    Cancelled,
    /// Reached only via `reclaim_funded_agreement`: the owner never called
    /// `start_rental` within the recovery timeout, so the full escrowed
    /// amount (rental fee + deposit) was refunded to the renter. Distinct
    /// from `Cancelled`, which only ever occurs pre-funding with no token
    /// movement at all.
    Expired,
}
