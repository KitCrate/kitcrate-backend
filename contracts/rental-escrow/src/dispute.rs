use soroban_sdk::{contractimpl, Address, Env, String};

use crate::error::RentalError;
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
        Ok(())
    }
}
