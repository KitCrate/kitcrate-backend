use soroban_sdk::token::TokenClient;
use soroban_sdk::{contractimpl, Address, Env, String};

use crate::error::RentalError;
use crate::events;
use crate::storage;
use crate::types::AgreementStatus;
use crate::{RentalEscrow, RentalEscrowArgs, RentalEscrowClient};

#[contractimpl]
impl RentalEscrow {
    /// Raises a damage claim against the security deposit. Auth: `owner`.
    /// Requires the rental to be `Active` and the claim window to still be
    /// open (`now <= end_time + claim_window_secs`). The claim amount must
    /// not exceed the deposit. Sets status `Disputed`. Real-world action:
    /// the owner reporting damage after the item is returned.
    ///
    /// `evidence_ref` is an opaque off-chain pointer (for example an IPFS
    /// hash or an app-side URL). It is never interpreted on-chain; it only
    /// travels in the emitted `claim_raised` event.
    pub fn raise_claim(
        env: &Env,
        owner: Address,
        id: u64,
        claim_amount: i128,
        evidence_ref: String,
    ) -> Result<(), RentalError> {
        owner.require_auth();
        let mut agreement = storage::read_agreement(env, id)?;
        if agreement.owner != owner {
            return Err(RentalError::Unauthorized);
        }
        if agreement.status != AgreementStatus::Active {
            return Err(RentalError::InvalidStatus);
        }
        if claim_amount <= 0 {
            return Err(RentalError::InvalidAmount);
        }
        if claim_amount > agreement.deposit_amount {
            return Err(RentalError::InsufficientAmount);
        }
        let claim_deadline = agreement
            .end_time
            .checked_add(agreement.claim_window_secs)
            .ok_or(RentalError::Overflow)?;
        if env.ledger().timestamp() > claim_deadline {
            return Err(RentalError::ClaimWindowExpired);
        }
        agreement.status = AgreementStatus::Disputed;
        storage::write_agreement(env, &agreement);
        events::claim_raised(env, id, claim_amount, &evidence_ref);
        Ok(())
    }

    /// Resolves a disputed agreement. Auth: `arbiter` (the account set at
    /// `initialize`; contract addresses are not supported as arbiters).
    /// Requires status `Disputed`. Splits the deposit between owner and
    /// renter and pays the full rental fee to the owner, then sets status
    /// `Resolved`. Real-world action: the platform arbiter adjudicating a
    /// damage claim after reviewing the evidence off-chain.
    pub fn resolve_dispute(
        env: &Env,
        arbiter: Address,
        id: u64,
        amount_to_owner: i128,
    ) -> Result<(), RentalError> {
        arbiter.require_auth();
        let mut agreement = storage::read_agreement(env, id)?;
        if arbiter != storage::read_arbiter(env)? {
            return Err(RentalError::Unauthorized);
        }
        if agreement.status != AgreementStatus::Disputed {
            return Err(RentalError::InvalidStatus);
        }
        if amount_to_owner < 0 {
            return Err(RentalError::InvalidAmount);
        }
        if amount_to_owner > agreement.deposit_amount {
            return Err(RentalError::InsufficientAmount);
        }
        let amount_to_renter = agreement.deposit_amount - amount_to_owner;
        let token = TokenClient::new(env, &storage::read_token(env)?);
        let contract = env.current_contract_address();
        token.transfer(&contract, &agreement.owner, &amount_to_owner);
        token.transfer(&contract, &agreement.renter, &amount_to_renter);
        token.transfer(&contract, &agreement.owner, &agreement.rental_amount);
        agreement.status = AgreementStatus::Resolved;
        storage::write_agreement(env, &agreement);
        events::dispute_resolved(env, id, amount_to_owner, amount_to_renter);
        Ok(())
    }
}
