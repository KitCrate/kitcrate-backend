mod common;

use soroban_sdk::testutils::{Events, Ledger as _};
use soroban_sdk::{IntoVal, String, Symbol};
use rental_escrow::error::RentalError;
use rental_escrow::types::{AgreementStatus, DataKey, RentalAgreement};

use common::{balance, mint, setup, setup_no_auth, TestEnv};

/// Agreement window used by the helpers: rental ends at NOW + 86400 and
/// the claim window is 86400 seconds, so the claim deadline is
/// NOW + 172800.
const CLAIM_DEADLINE: u64 = 1_700_172_800;

fn item_ref(env: &soroban_sdk::Env, value: &str) -> String {
    String::from_str(env, value)
}

/// Create, fund and start a rental so it is in `Active` status.
fn active_agreement(t: &TestEnv) -> u64 {
    let item = item_ref(&t.env, "listing-1");
    let id = t.client().create_agreement(
        &t.owner,
        &t.renter,
        &item,
        &1000i128,
        &500i128,
        &1_700_000_000u64,
        &1_700_086_400u64,
        &86_400u64,
    );
    mint(&t.env, &t.token, &t.renter, 1500);
    t.client().fund_agreement(&t.renter, &id);
    t.client().start_rental(&t.owner, &id);
    id
}

#[test]
fn raise_claim_marks_agreement_disputed() {
    let t = setup();
    let id = active_agreement(&t);
    let evidence = item_ref(&t.env, "ipfs://QmEvidence");
    t.client().raise_claim(&t.owner, &id, &300i128, &evidence);

    let stored: RentalAgreement = t
        .env
        .as_contract(&t.contract_id, || {
            t.env
                .storage()
                .persistent()
                .get(&DataKey::Agreement(id))
                .unwrap()
        });
    assert_eq!(stored.status, AgreementStatus::Disputed);
}

#[test]
fn raise_claim_rejects_claim_over_deposit() {
    let t = setup();
    let id = active_agreement(&t);
    let evidence = item_ref(&t.env, "ipfs://QmEvidence");
    let res = t
        .client()
        .try_raise_claim(&t.owner, &id, &501i128, &evidence);
    assert!(matches!(res, Err(Ok(RentalError::InsufficientAmount))));
}

#[test]
fn raise_claim_rejects_zero_claim() {
    let t = setup();
    let id = active_agreement(&t);
    let evidence = item_ref(&t.env, "ipfs://QmEvidence");
    let res = t
        .client()
        .try_raise_claim(&t.owner, &id, &0i128, &evidence);
    assert!(matches!(res, Err(Ok(RentalError::InvalidAmount))));
}

#[test]
fn raise_claim_rejects_non_active_agreement() {
    let t = setup();
    let item = item_ref(&t.env, "listing-1");
    // Created but never funded or started.
    let id = t.client().create_agreement(
        &t.owner,
        &t.renter,
        &item,
        &1000i128,
        &500i128,
        &1_700_000_000u64,
        &1_700_086_400u64,
        &86_400u64,
    );
    let evidence = item_ref(&t.env, "ipfs://QmEvidence");
    let res = t
        .client()
        .try_raise_claim(&t.owner, &id, &100i128, &evidence);
    assert!(matches!(res, Err(Ok(RentalError::InvalidStatus))));
}

#[test]
fn raise_claim_rejects_non_owner() {
    let t = setup();
    let id = active_agreement(&t);
    let evidence = item_ref(&t.env, "ipfs://QmEvidence");
    let res = t
        .client()
        .try_raise_claim(&t.renter, &id, &100i128, &evidence);
    assert!(matches!(res, Err(Ok(RentalError::Unauthorized))));
}

#[test]
fn raise_claim_requires_owner_auth() {
    let t = setup_no_auth();
    let evidence = item_ref(&t.env, "ipfs://QmEvidence");
    let res = t
        .client()
        .try_raise_claim(&t.owner, &999, &100i128, &evidence);
    assert!(matches!(res, Err(Err(_))));
}

#[test]
fn raise_claim_at_window_deadline_succeeds() {
    let t = setup();
    t.env.ledger().set_timestamp(CLAIM_DEADLINE);
    let id = active_agreement(&t);
    let evidence = item_ref(&t.env, "ipfs://QmEvidence");
    // now == end_time + claim_window_secs is still inside the window.
    t.client().raise_claim(&t.owner, &id, &100i128, &evidence);
}

#[test]
fn raise_claim_after_window_expires() {
    let t = setup();
    t.env.ledger().set_timestamp(CLAIM_DEADLINE + 1);
    let id = active_agreement(&t);
    let evidence = item_ref(&t.env, "ipfs://QmEvidence");
    let res = t
        .client()
        .try_raise_claim(&t.owner, &id, &100i128, &evidence);
    assert!(matches!(res, Err(Ok(RentalError::ClaimWindowExpired))));
}

#[test]
fn resolve_dispute_splits_deposit_and_pays_rental() {
    let t = setup();
    let id = active_agreement(&t);
    let evidence = item_ref(&t.env, "ipfs://QmEvidence");
    t.client().raise_claim(&t.owner, &id, &300i128, &evidence);
    t.client().resolve_dispute(&t.arbiter, &id, &300i128);

    // Owner: 300 from the deposit plus the 1000 rental fee.
    assert_eq!(balance(&t.env, &t.token, &t.owner), 1300);
    // Renter: the remaining 200 of the deposit.
    assert_eq!(balance(&t.env, &t.token, &t.renter), 200);
    assert_eq!(balance(&t.env, &t.token, &t.contract_id), 0);
    let stored: RentalAgreement = t
        .env
        .as_contract(&t.contract_id, || {
            t.env
                .storage()
                .persistent()
                .get(&DataKey::Agreement(id))
                .unwrap()
        });
    assert_eq!(stored.status, AgreementStatus::Resolved);
}

#[test]
fn resolve_dispute_can_return_full_deposit_to_renter() {
    let t = setup();
    let id = active_agreement(&t);
    let evidence = item_ref(&t.env, "ipfs://QmEvidence");
    t.client().raise_claim(&t.owner, &id, &100i128, &evidence);
    // Arbiter finds no fault: zero to the owner, full deposit back.
    t.client().resolve_dispute(&t.arbiter, &id, &0i128);

    assert_eq!(balance(&t.env, &t.token, &t.owner), 1000);
    assert_eq!(balance(&t.env, &t.token, &t.renter), 500);
    assert_eq!(balance(&t.env, &t.token, &t.contract_id), 0);
}

#[test]
fn resolve_dispute_rejects_award_over_deposit() {
    let t = setup();
    let id = active_agreement(&t);
    let evidence = item_ref(&t.env, "ipfs://QmEvidence");
    t.client().raise_claim(&t.owner, &id, &300i128, &evidence);
    let res = t.client().try_resolve_dispute(&t.arbiter, &id, &501i128);
    assert!(matches!(res, Err(Ok(RentalError::InsufficientAmount))));
}

#[test]
fn resolve_dispute_rejects_negative_award() {
    let t = setup();
    let id = active_agreement(&t);
    let evidence = item_ref(&t.env, "ipfs://QmEvidence");
    t.client().raise_claim(&t.owner, &id, &300i128, &evidence);
    let res = t.client().try_resolve_dispute(&t.arbiter, &id, &-1i128);
    assert!(matches!(res, Err(Ok(RentalError::InvalidAmount))));
}

#[test]
fn resolve_dispute_rejects_non_disputed_agreement() {
    let t = setup();
    let id = active_agreement(&t);
    // Still Active: no claim has been raised.
    let res = t.client().try_resolve_dispute(&t.arbiter, &id, &100i128);
    assert!(matches!(res, Err(Ok(RentalError::InvalidStatus))));
}

#[test]
fn resolve_dispute_rejects_non_arbiter() {
    let t = setup();
    let id = active_agreement(&t);
    let evidence = item_ref(&t.env, "ipfs://QmEvidence");
    t.client().raise_claim(&t.owner, &id, &300i128, &evidence);
    let res = t.client().try_resolve_dispute(&t.owner, &id, &100i128);
    assert!(matches!(res, Err(Ok(RentalError::Unauthorized))));
}

#[test]
fn resolve_dispute_requires_arbiter_auth() {
    let t = setup_no_auth();
    let res = t.client().try_resolve_dispute(&t.arbiter, &999, &100i128);
    assert!(matches!(res, Err(Err(_))));
}

#[test]
fn claim_raised_emits_evidence_ref() {
    let t = setup();
    let id = active_agreement(&t);
    let evidence = item_ref(&t.env, "ipfs://QmEvidence");
    t.client().raise_claim(&t.owner, &id, &300i128, &evidence);
    assert_eq!(
        t.env.events().all().filter_by_contract(&t.contract_id),
        soroban_sdk::vec![
            &t.env,
            (
                t.contract_id.clone(),
                (Symbol::new(&t.env, "claim_raised"), 1u64).into_val(&t.env),
                (1u64, 300i128, evidence.clone()).into_val(&t.env),
            )
        ]
    );
}

#[test]
fn dispute_resolved_emits_split() {
    let t = setup();
    let id = active_agreement(&t);
    let evidence = item_ref(&t.env, "ipfs://QmEvidence");
    t.client().raise_claim(&t.owner, &id, &300i128, &evidence);
    t.client().resolve_dispute(&t.arbiter, &id, &300i128);
    assert_eq!(
        t.env.events().all().filter_by_contract(&t.contract_id),
        soroban_sdk::vec![
            &t.env,
            (
                t.contract_id.clone(),
                (Symbol::new(&t.env, "dispute_resolved"), 1u64).into_val(&t.env),
                (1u64, 300i128, 200i128).into_val(&t.env),
            )
        ]
    );
}
