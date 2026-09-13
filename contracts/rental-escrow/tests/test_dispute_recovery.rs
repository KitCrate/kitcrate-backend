mod common;

use rental_escrow::error::RentalError;
use rental_escrow::types::{AgreementStatus, DataKey, RentalAgreement};
use soroban_sdk::testutils::{Address as _, Events, Ledger as _};
use soroban_sdk::{Address, IntoVal, String, Symbol};

use common::{balance, mint, setup, TestEnv};

/// Fourteen days, matching `storage::DISPUTE_RESOLUTION_TIMEOUT_SECS`. Kept
/// as an independent literal so these tests would catch an accidental
/// change to that constant's value, not just its name.
const DISPUTE_TIMEOUT_SECS: u64 = 1_209_600;

fn item_ref(env: &soroban_sdk::Env, value: &str) -> String {
    String::from_str(env, value)
}

/// Create, fund, start and dispute a standard agreement (rental 1000,
/// deposit 500), leaving it `Disputed` with no `resolve_dispute` call. The
/// claim is raised at `NOW` (the ledger timestamp `setup()` fixes), so the
/// dispute-resolution deadline is `NOW + DISPUTE_TIMEOUT_SECS`.
fn disputed_agreement(t: &TestEnv) -> u64 {
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
    let evidence = item_ref(&t.env, "ipfs://QmEvidence");
    t.client().raise_claim(&t.owner, &id, &300i128, &evidence);
    id
}

#[test]
fn disputed_agreement_is_not_permanently_stuck_after_timeout() {
    let t = setup();
    let id = disputed_agreement(&t);
    t.env
        .ledger()
        .set_timestamp(common::NOW + DISPUTE_TIMEOUT_SECS + 1);
    t.client().resolve_expired_dispute(&id);

    // Claim-skeptical default: full deposit to renter, full rental fee to
    // owner, exactly as an arbiter awarding amount_to_owner=0 would.
    assert_eq!(balance(&t.env, &t.token, &t.renter), 500);
    assert_eq!(balance(&t.env, &t.token, &t.owner), 1000);
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

#[test]
fn resolve_expired_dispute_rejected_immediately_after_claim() {
    let t = setup();
    let id = disputed_agreement(&t);
    let res = t.client().try_resolve_expired_dispute(&id);
    assert!(matches!(
        res,
        Err(Ok(RentalError::DisputeResolutionWindowActive))
    ));
    assert_eq!(balance(&t.env, &t.token, &t.contract_id), 1500);
}

#[test]
fn resolve_expired_dispute_rejected_exactly_at_deadline() {
    let t = setup();
    let id = disputed_agreement(&t);
    t.env
        .ledger()
        .set_timestamp(common::NOW + DISPUTE_TIMEOUT_SECS);
    let res = t.client().try_resolve_expired_dispute(&id);
    assert!(matches!(
        res,
        Err(Ok(RentalError::DisputeResolutionWindowActive))
    ));
}

#[test]
fn resolve_expired_dispute_succeeds_one_second_after_deadline() {
    let t = setup();
    let id = disputed_agreement(&t);
    t.env
        .ledger()
        .set_timestamp(common::NOW + DISPUTE_TIMEOUT_SECS + 1);
    let res = t.client().try_resolve_expired_dispute(&id);
    assert!(res.is_ok());
}

#[test]
fn resolve_expired_dispute_rejects_non_disputed_agreement() {
    let t = setup();
    let item = item_ref(&t.env, "listing-1");
    // Active, never disputed.
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
    t.env
        .ledger()
        .set_timestamp(common::NOW + DISPUTE_TIMEOUT_SECS + 1);
    let res = t.client().try_resolve_expired_dispute(&id);
    assert!(matches!(res, Err(Ok(RentalError::InvalidStatus))));
}

#[test]
fn resolve_expired_dispute_rejects_unknown_id() {
    let t = setup();
    let res = t.client().try_resolve_expired_dispute(&42);
    assert!(matches!(res, Err(Ok(RentalError::NotFound))));
}

#[test]
fn arbiter_can_still_resolve_normally_after_the_timeout_if_nobody_has_triggered_expiry() {
    let t = setup();
    let id = disputed_agreement(&t);
    // Well past the auto-resolution deadline, but the arbiter shows up and
    // does their job before anyone calls resolve_expired_dispute. The
    // fallback must never preempt an arbiter who is still willing to act.
    t.env
        .ledger()
        .set_timestamp(common::NOW + DISPUTE_TIMEOUT_SECS + 100);
    t.client().resolve_dispute(&t.arbiter, &id, &300i128);

    assert_eq!(balance(&t.env, &t.token, &t.owner), 1300); // 300 deposit share + 1000 rental
    assert_eq!(balance(&t.env, &t.token, &t.renter), 200);
    assert_eq!(balance(&t.env, &t.token, &t.contract_id), 0);

    // The now-Resolved agreement can no longer be auto-resolved either.
    let res = t.client().try_resolve_expired_dispute(&id);
    assert!(matches!(res, Err(Ok(RentalError::InvalidStatus))));
}

#[test]
fn once_auto_resolved_the_arbiter_can_no_longer_resolve_it() {
    let t = setup();
    let id = disputed_agreement(&t);
    t.env
        .ledger()
        .set_timestamp(common::NOW + DISPUTE_TIMEOUT_SECS + 1);
    t.client().resolve_expired_dispute(&id);

    let res = t.client().try_resolve_dispute(&t.arbiter, &id, &300i128);
    assert!(matches!(res, Err(Ok(RentalError::InvalidStatus))));
    // No double payment: balances remain exactly what the auto-resolution
    // produced.
    assert_eq!(balance(&t.env, &t.token, &t.renter), 500);
    assert_eq!(balance(&t.env, &t.token, &t.owner), 1000);
    assert_eq!(balance(&t.env, &t.token, &t.contract_id), 0);
}

#[test]
fn resolve_expired_dispute_is_permissionless_but_never_pays_the_caller() {
    let t = setup();
    let id = disputed_agreement(&t);
    t.env
        .ledger()
        .set_timestamp(common::NOW + DISPUTE_TIMEOUT_SECS + 1);
    let stranger = Address::generate(&t.env);
    t.client().resolve_expired_dispute(&id);

    assert_eq!(balance(&t.env, &t.token, &stranger), 0);
    assert_eq!(balance(&t.env, &t.token, &t.renter), 500);
    assert_eq!(balance(&t.env, &t.token, &t.owner), 1000);
}

#[test]
fn repeated_resolve_expired_dispute_attempts_fail_cleanly_after_the_first() {
    let t = setup();
    let id = disputed_agreement(&t);
    t.env
        .ledger()
        .set_timestamp(common::NOW + DISPUTE_TIMEOUT_SECS + 1);
    t.client().resolve_expired_dispute(&id);

    let res = t.client().try_resolve_expired_dispute(&id);
    assert!(matches!(res, Err(Ok(RentalError::InvalidStatus))));
    assert_eq!(balance(&t.env, &t.token, &t.renter), 500);
    assert_eq!(balance(&t.env, &t.token, &t.contract_id), 0);

    t.env
        .ledger()
        .set_timestamp(common::NOW + DISPUTE_TIMEOUT_SECS * 3);
    let res = t.client().try_resolve_expired_dispute(&id);
    assert!(matches!(res, Err(Ok(RentalError::InvalidStatus))));
    assert_eq!(balance(&t.env, &t.token, &t.renter), 500);
}

#[test]
fn resolve_expired_dispute_refunds_exact_amounts_no_more_no_less() {
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
    t.client().start_rental(&t.owner, &id);
    let evidence = item_ref(&t.env, "ipfs://QmEvidence");
    t.client().raise_claim(&t.owner, &id, &6_789i128, &evidence);

    t.env
        .ledger()
        .set_timestamp(common::NOW + DISPUTE_TIMEOUT_SECS + 1);
    t.client().resolve_expired_dispute(&id);

    assert_eq!(balance(&t.env, &t.token, &t.renter), 6_789);
    assert_eq!(balance(&t.env, &t.token, &t.owner), 12_345);
    assert_eq!(balance(&t.env, &t.token, &t.contract_id), 0);
}

#[test]
fn resolve_expired_dispute_emits_dispute_auto_resolved() {
    let t = setup();
    let id = disputed_agreement(&t);
    t.env
        .ledger()
        .set_timestamp(common::NOW + DISPUTE_TIMEOUT_SECS + 1);
    t.client().resolve_expired_dispute(&id);
    assert_eq!(
        t.env.events().all().filter_by_contract(&t.contract_id),
        soroban_sdk::vec![
            &t.env,
            (
                t.contract_id.clone(),
                (Symbol::new(&t.env, "dispute_auto_resolved"), 1u64).into_val(&t.env),
                (1u64, 0i128, 500i128).into_val(&t.env),
            )
        ]
    );
}

#[test]
fn normal_dispute_resolution_flow_is_unaffected_by_the_recovery_path() {
    let t = setup();
    let id = disputed_agreement(&t);
    // Arbiter resolves promptly, well within the timeout — exactly the
    // pre-existing behavior, unaffected by the new fallback existing.
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

#[test]
fn normal_undisputed_release_flow_is_unaffected_by_the_recovery_path() {
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
    mint(&t.env, &t.token, &t.renter, 1500);
    t.client().fund_agreement(&t.renter, &id);
    t.client().start_rental(&t.owner, &id);
    t.env.ledger().set_timestamp(1_700_172_801);
    t.client().release_funds(&id);

    assert_eq!(balance(&t.env, &t.token, &t.renter), 500);
    assert_eq!(balance(&t.env, &t.token, &t.owner), 1000);
    assert_eq!(balance(&t.env, &t.token, &t.contract_id), 0);
}
