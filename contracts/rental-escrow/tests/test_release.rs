mod common;

use soroban_sdk::testutils::Ledger as _;
use soroban_sdk::String;
use rental_escrow::error::RentalError;
use rental_escrow::types::{AgreementStatus, DataKey, RentalAgreement};

use common::{balance, mint, setup, TestEnv};

/// Claim deadline for the standard agreement: end_time + claim_window.
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
fn release_funds_settles_a_clean_rental() {
    let t = setup();
    let id = active_agreement(&t);
    // Claim window has passed with no claim raised.
    t.env.ledger().set_timestamp(CLAIM_DEADLINE + 1);
    t.client().release_funds(&id);

    assert_eq!(balance(&t.env, &t.token, &t.renter), 500);
    assert_eq!(balance(&t.env, &t.token, &t.owner), 1000);
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
    assert_eq!(stored.status, AgreementStatus::Completed);
}

#[test]
fn release_funds_rejected_inside_claim_window() {
    let t = setup();
    let id = active_agreement(&t);
    // Exactly at the deadline the window is still open; release requires
    // strictly after it.
    t.env.ledger().set_timestamp(CLAIM_DEADLINE);
    let res = t.client().try_release_funds(&id);
    assert!(matches!(res, Err(Ok(RentalError::ClaimWindowActive))));
}

#[test]
fn release_funds_rejected_before_rental_starts() {
    let t = setup();
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
    t.env.ledger().set_timestamp(CLAIM_DEADLINE + 1);
    let res = t.client().try_release_funds(&id);
    assert!(matches!(res, Err(Ok(RentalError::InvalidStatus))));
}

#[test]
fn release_funds_rejects_unknown_id() {
    let t = setup();
    let res = t.client().try_release_funds(&42);
    assert!(matches!(res, Err(Ok(RentalError::NotFound))));
}
