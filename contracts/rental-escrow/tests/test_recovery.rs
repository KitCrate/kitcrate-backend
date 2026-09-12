mod common;

use rental_escrow::error::RentalError;
use rental_escrow::types::{AgreementStatus, DataKey, RentalAgreement};
use soroban_sdk::testutils::{Address as _, Events, Ledger as _};
use soroban_sdk::{Address, IntoVal, String, Symbol};

use common::{balance, mint, setup, TestEnv};

/// Seven days, matching `storage::FUNDED_RECOVERY_TIMEOUT_SECS`. Kept as an
/// independent literal (not imported from the crate) so these tests would
/// catch an accidental change to that constant's value, not just its name.
const RECOVERY_TIMEOUT_SECS: u64 = 604_800;

fn item_ref(env: &soroban_sdk::Env, value: &str) -> String {
    String::from_str(env, value)
}

/// Create and fund a standard agreement (rental 1000, deposit 500), leaving
/// it in `Funded` with no `start_rental` call. Funding happens at `NOW`
/// (the ledger timestamp `setup()` fixes), so the recovery deadline is
/// `NOW + RECOVERY_TIMEOUT_SECS`.
fn funded_agreement(t: &TestEnv) -> u64 {
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
    id
}

#[test]
fn funded_agreement_is_not_permanently_stuck_after_timeout() {
    let t = setup();
    let id = funded_agreement(&t);
    t.env
        .ledger()
        .set_timestamp(common::NOW + RECOVERY_TIMEOUT_SECS + 1);
    // Permissionless: no auth is mocked away for this call because none is
    // required at all.
    t.client().reclaim_funded_agreement(&id);

    assert_eq!(balance(&t.env, &t.token, &t.renter), 1500);
    assert_eq!(balance(&t.env, &t.token, &t.owner), 0);
    assert_eq!(balance(&t.env, &t.token, &t.contract_id), 0);
    let stored: RentalAgreement = t.env.as_contract(&t.contract_id, || {
        t.env
            .storage()
            .persistent()
            .get(&DataKey::Agreement(id))
            .unwrap()
    });
    assert_eq!(stored.status, AgreementStatus::Expired);
}

#[test]
fn reclaim_rejected_immediately_after_funding() {
    let t = setup();
    let id = funded_agreement(&t);
    // No time has passed at all: an ordinary, momentary gap between funding
    // and start_rental must never look like abandonment.
    let res = t.client().try_reclaim_funded_agreement(&id);
    assert!(matches!(res, Err(Ok(RentalError::RecoveryWindowActive))));
    assert_eq!(balance(&t.env, &t.token, &t.contract_id), 1500);
}

#[test]
fn reclaim_rejected_exactly_at_deadline() {
    let t = setup();
    let id = funded_agreement(&t);
    // now == funded_at + timeout is still inside the window; release_funds
    // uses the same strictly-after convention for its own deadline.
    t.env
        .ledger()
        .set_timestamp(common::NOW + RECOVERY_TIMEOUT_SECS);
    let res = t.client().try_reclaim_funded_agreement(&id);
    assert!(matches!(res, Err(Ok(RentalError::RecoveryWindowActive))));
}

#[test]
fn reclaim_succeeds_one_second_after_deadline() {
    let t = setup();
    let id = funded_agreement(&t);
    t.env
        .ledger()
        .set_timestamp(common::NOW + RECOVERY_TIMEOUT_SECS + 1);
    let res = t.client().try_reclaim_funded_agreement(&id);
    assert!(res.is_ok());
}

#[test]
fn reclaim_rejects_unfunded_agreement() {
    let t = setup();
    let item = item_ref(&t.env, "listing-1");
    // Created but never funded: there is nothing to recover.
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
    t.env
        .ledger()
        .set_timestamp(common::NOW + RECOVERY_TIMEOUT_SECS + 1);
    let res = t.client().try_reclaim_funded_agreement(&id);
    assert!(matches!(res, Err(Ok(RentalError::InvalidStatus))));
}

#[test]
fn reclaim_rejects_active_agreement() {
    let t = setup();
    let id = funded_agreement(&t);
    t.client().start_rental(&t.owner, &id);
    t.env
        .ledger()
        .set_timestamp(common::NOW + RECOVERY_TIMEOUT_SECS + 1);
    // The owner did act in time; there is no liveness problem left to fix.
    let res = t.client().try_reclaim_funded_agreement(&id);
    assert!(matches!(res, Err(Ok(RentalError::InvalidStatus))));
    // Funds stay escrowed for the normal Active lifecycle, not refunded.
    assert_eq!(balance(&t.env, &t.token, &t.contract_id), 1500);
}

#[test]
fn reclaim_rejects_unknown_id() {
    let t = setup();
    let res = t.client().try_reclaim_funded_agreement(&42);
    assert!(matches!(res, Err(Ok(RentalError::NotFound))));
}

#[test]
fn reclaim_is_permissionless_but_never_pays_the_caller() {
    let t = setup();
    let id = funded_agreement(&t);
    t.env
        .ledger()
        .set_timestamp(common::NOW + RECOVERY_TIMEOUT_SECS + 1);
    // A third party with no relationship to the agreement triggers recovery.
    // No require_auth is on this function, so no mock_auths call is needed
    // for the stranger; the important assertion is where the money lands.
    let stranger = Address::generate(&t.env);
    t.client().reclaim_funded_agreement(&id);

    assert_eq!(balance(&t.env, &t.token, &stranger), 0);
    assert_eq!(balance(&t.env, &t.token, &t.owner), 0);
    assert_eq!(balance(&t.env, &t.token, &t.renter), 1500);
}

#[test]
fn repeated_reclaim_attempts_fail_cleanly_after_the_first() {
    let t = setup();
    let id = funded_agreement(&t);
    t.env
        .ledger()
        .set_timestamp(common::NOW + RECOVERY_TIMEOUT_SECS + 1);
    t.client().reclaim_funded_agreement(&id);

    // A second attempt must not double-pay the renter or move the contract
    // balance further; the agreement is now Expired, not Funded.
    let res = t.client().try_reclaim_funded_agreement(&id);
    assert!(matches!(res, Err(Ok(RentalError::InvalidStatus))));
    assert_eq!(balance(&t.env, &t.token, &t.renter), 1500);
    assert_eq!(balance(&t.env, &t.token, &t.contract_id), 0);

    // A third attempt, well after the first, behaves identically.
    t.env
        .ledger()
        .set_timestamp(common::NOW + RECOVERY_TIMEOUT_SECS * 3);
    let res = t.client().try_reclaim_funded_agreement(&id);
    assert!(matches!(res, Err(Ok(RentalError::InvalidStatus))));
    assert_eq!(balance(&t.env, &t.token, &t.renter), 1500);
}

#[test]
fn reclaim_refunds_exactly_rental_plus_deposit_no_more_no_less() {
    let t = setup();
    let item = item_ref(&t.env, "listing-1");
    let id = t.client().create_agreement(
        &t.owner,
        &t.renter,
        &item,
        &12_345i128,
        &6_789i128,
        &1_700_000_000u64,
        &1_700_086_400u64,
        &86_400u64,
    );
    mint(&t.env, &t.token, &t.renter, 19_134);
    t.client().fund_agreement(&t.renter, &id);
    t.env
        .ledger()
        .set_timestamp(common::NOW + RECOVERY_TIMEOUT_SECS + 1);
    t.client().reclaim_funded_agreement(&id);

    assert_eq!(balance(&t.env, &t.token, &t.renter), 19_134);
    assert_eq!(balance(&t.env, &t.token, &t.owner), 0);
    assert_eq!(balance(&t.env, &t.token, &t.contract_id), 0);
}

#[test]
fn reclaim_funded_agreement_emits_funded_agreement_expired() {
    let t = setup();
    let id = funded_agreement(&t);
    t.env
        .ledger()
        .set_timestamp(common::NOW + RECOVERY_TIMEOUT_SECS + 1);
    t.client().reclaim_funded_agreement(&id);
    assert_eq!(
        t.env.events().all().filter_by_contract(&t.contract_id),
        soroban_sdk::vec![
            &t.env,
            (
                t.contract_id.clone(),
                (Symbol::new(&t.env, "funded_agreement_expired"), 1u64).into_val(&t.env),
                (1u64, 1500i128).into_val(&t.env),
            )
        ]
    );
}

#[test]
fn normal_funded_to_active_flow_is_unaffected_by_the_recovery_path() {
    let t = setup();
    let id = funded_agreement(&t);
    // The owner acts well within the recovery window.
    t.env.ledger().set_timestamp(common::NOW + 3600);
    t.client().start_rental(&t.owner, &id);
    let stored: RentalAgreement = t.env.as_contract(&t.contract_id, || {
        t.env
            .storage()
            .persistent()
            .get(&DataKey::Agreement(id))
            .unwrap()
    });
    assert_eq!(stored.status, AgreementStatus::Active);
}

#[test]
fn normal_active_to_completed_flow_is_unaffected_by_the_recovery_path() {
    let t = setup();
    let id = funded_agreement(&t);
    t.client().start_rental(&t.owner, &id);
    // Well past both the funded-recovery timeout and the claim window;
    // release_funds must still settle normally since the agreement is
    // Active, not Funded.
    t.env
        .ledger()
        .set_timestamp(1_700_172_801 + RECOVERY_TIMEOUT_SECS);
    t.client().release_funds(&id);

    assert_eq!(balance(&t.env, &t.token, &t.renter), 500);
    assert_eq!(balance(&t.env, &t.token, &t.owner), 1000);
    assert_eq!(balance(&t.env, &t.token, &t.contract_id), 0);
}

#[test]
fn cancellation_before_funding_is_unaffected_by_the_recovery_path() {
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
    t.client().cancel_agreement(&t.renter, &id);
    let stored: RentalAgreement = t.env.as_contract(&t.contract_id, || {
        t.env
            .storage()
            .persistent()
            .get(&DataKey::Agreement(id))
            .unwrap()
    });
    assert_eq!(stored.status, AgreementStatus::Cancelled);
}

#[test]
fn dispute_flow_is_unaffected_by_the_recovery_path() {
    let t = setup();
    let id = funded_agreement(&t);
    t.client().start_rental(&t.owner, &id);
    let evidence = item_ref(&t.env, "ipfs://QmEvidence");
    // Raising a claim on an already Active agreement must still work
    // exactly as before, regardless of the new recovery path existing.
    t.client().raise_claim(&t.owner, &id, &300i128, &evidence);
    t.client().resolve_dispute(&t.arbiter, &id, &300i128);

    assert_eq!(balance(&t.env, &t.token, &t.owner), 1300);
    assert_eq!(balance(&t.env, &t.token, &t.renter), 200);
    assert_eq!(balance(&t.env, &t.token, &t.contract_id), 0);
    let stored: RentalAgreement = t.env.as_contract(&t.contract_id, || {
        t.env
            .storage()
            .persistent()
            .get(&DataKey::Agreement(id))
            .unwrap()
    });
    assert_eq!(stored.status, AgreementStatus::Resolved);
}
