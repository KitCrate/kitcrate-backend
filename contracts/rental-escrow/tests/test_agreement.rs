mod common;

use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, String};
use rental_escrow::error::RentalError;
use rental_escrow::types::{AgreementStatus, DataKey, RentalAgreement};

use common::{balance, mint, setup, setup_no_auth, TestEnv};

fn item_ref(env: &soroban_sdk::Env, value: &str) -> String {
    String::from_str(env, value)
}

/// Create a standard agreement (rental 1000, deposit 500, one-day window).
fn create_agreement(t: &TestEnv, item: &String) -> u64 {
    t.client().create_agreement(
        &t.owner,
        &t.renter,
        item,
        &1000i128,
        &500i128,
        &1_700_000_000u64,
        &1_700_086_400u64,
        &86_400u64,
    )
}

#[test]
fn initialize_stores_admin_arbiter_and_token() {
    let t = setup();
    let admin: Address = t
        .env
        .as_contract(&t.contract_id, || {
            t.env.storage().instance().get(&DataKey::Admin).unwrap()
        });
    let arbiter: Address = t
        .env
        .as_contract(&t.contract_id, || {
            t.env.storage().instance().get(&DataKey::Arbiter).unwrap()
        });
    let token: Address = t
        .env
        .as_contract(&t.contract_id, || {
            t.env.storage().instance().get(&DataKey::Token).unwrap()
        });
    assert_eq!(admin, t.admin);
    assert_eq!(arbiter, t.arbiter);
    assert_eq!(token, t.token);
}

#[test]
fn initialize_fails_when_already_initialized() {
    let t = setup();
    let client = t.client();
    let another_admin = Address::generate(&t.env);
    let res = client.try_initialize(&another_admin, &t.arbiter, &t.token);
    assert!(matches!(res, Err(Ok(RentalError::AlreadyInitialized))));
}

#[test]
fn initialize_requires_admin_auth() {
    let t = setup_no_auth();
    let client = t.client();
    // The caller is not the admin; require_auth must fail at the host level.
    let res = client.try_initialize(&t.renter, &t.arbiter, &t.token);
    assert!(matches!(res, Err(Err(_))));
}

#[test]
fn create_agreement_stores_a_created_agreement() {
    let t = setup();
    let item = item_ref(&t.env, "listing-abc-123");
    let id = create_agreement(&t, &item);
    assert_eq!(id, 1);

    let stored: RentalAgreement = t
        .env
        .as_contract(&t.contract_id, || {
            t.env
                .storage()
                .persistent()
                .get(&DataKey::Agreement(1))
                .unwrap()
        });
    assert_eq!(stored.id, 1);
    assert_eq!(stored.owner, t.owner);
    assert_eq!(stored.renter, t.renter);
    assert_eq!(stored.item_ref, item);
    assert_eq!(stored.rental_amount, 1000);
    assert_eq!(stored.deposit_amount, 500);
    assert_eq!(stored.start_time, 1_700_000_000);
    assert_eq!(stored.end_time, 1_700_086_400);
    assert_eq!(stored.claim_window_secs, 86_400);
    assert_eq!(stored.status, AgreementStatus::Created);
    assert_eq!(stored.created_at, common::NOW);
}

#[test]
fn create_agreement_increments_ids() {
    let t = setup();
    let client = t.client();
    let item = item_ref(&t.env, "listing-1");
    let id1 = client.create_agreement(
        &t.owner,
        &t.renter,
        &item,
        &1000i128,
        &500i128,
        &1,
        &2,
        &86_400u64,
    );
    let id2 = client.create_agreement(
        &t.owner,
        &t.renter,
        &item,
        &2000i128,
        &500i128,
        &1,
        &2,
        &86_400u64,
    );
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
}

#[test]
fn create_agreement_rejects_zero_rental_amount() {
    let t = setup();
    let client = t.client();
    let item = item_ref(&t.env, "listing-1");
    let res = client.try_create_agreement(
        &t.owner,
        &t.renter,
        &item,
        &0i128,
        &500i128,
        &1,
        &2,
        &86_400u64,
    );
    assert!(matches!(res, Err(Ok(RentalError::InvalidAmount))));
}

#[test]
fn create_agreement_rejects_zero_deposit() {
    let t = setup();
    let client = t.client();
    let item = item_ref(&t.env, "listing-1");
    let res = client.try_create_agreement(
        &t.owner,
        &t.renter,
        &item,
        &1000i128,
        &0i128,
        &1,
        &2,
        &86_400u64,
    );
    assert!(matches!(res, Err(Ok(RentalError::InvalidAmount))));
}

#[test]
fn create_agreement_rejects_inverted_time_range() {
    let t = setup();
    let client = t.client();
    let item = item_ref(&t.env, "listing-1");
    let res = client.try_create_agreement(
        &t.owner,
        &t.renter,
        &item,
        &1000i128,
        &500i128,
        &2,
        &2,
        &86_400u64,
    );
    assert!(matches!(res, Err(Ok(RentalError::InvalidTimeRange))));
}

#[test]
fn create_agreement_requires_owner_auth() {
    let t = setup_no_auth();
    let client = t.client();
    let item = item_ref(&t.env, "listing-1");
    // The caller authorizes only as the renter, never as the owner.
    let res = client.try_create_agreement(
        &t.renter,
        &t.renter,
        &item,
        &1000i128,
        &500i128,
        &1,
        &2,
        &86_400u64,
    );
    assert!(matches!(res, Err(Err(_))));
}

#[test]
fn fund_agreement_transfers_rental_plus_deposit() {
    let t = setup();
    let item = item_ref(&t.env, "listing-1");
    let id = create_agreement(&t, &item);
    mint(&t.env, &t.token, &t.renter, 1500);
    t.client().fund_agreement(&t.renter, &id);

    assert_eq!(balance(&t.env, &t.token, &t.renter), 0);
    assert_eq!(balance(&t.env, &t.token, &t.contract_id), 1500);
    let stored: RentalAgreement = t
        .env
        .as_contract(&t.contract_id, || {
            t.env
                .storage()
                .persistent()
                .get(&DataKey::Agreement(id))
                .unwrap()
        });
    assert_eq!(stored.status, AgreementStatus::Funded);
}

#[test]
fn fund_agreement_twice_fails() {
    let t = setup();
    let item = item_ref(&t.env, "listing-1");
    let id = create_agreement(&t, &item);
    mint(&t.env, &t.token, &t.renter, 3000);
    t.client().fund_agreement(&t.renter, &id);
    let res = t.client().try_fund_agreement(&t.renter, &id);
    assert!(matches!(res, Err(Ok(RentalError::AlreadyFunded))));
}

#[test]
fn fund_agreement_rejects_third_party() {
    let t = setup();
    let item = item_ref(&t.env, "listing-1");
    let id = create_agreement(&t, &item);
    let stranger = Address::generate(&t.env);
    let res = t.client().try_fund_agreement(&stranger, &id);
    assert!(matches!(res, Err(Ok(RentalError::Unauthorized))));
}

#[test]
fn fund_agreement_rejects_unknown_id() {
    let t = setup();
    let res = t.client().try_fund_agreement(&t.renter, &42);
    assert!(matches!(res, Err(Ok(RentalError::NotFound))));
}

#[test]
fn fund_agreement_requires_renter_auth() {
    let t = setup_no_auth();
    let client = t.client();
    // Auth is checked before business logic, so even an unknown id fails
    // at the host level when the renter has not authorized the call.
    let res = client.try_fund_agreement(&t.renter, &999);
    assert!(matches!(res, Err(Err(_))));
}

#[test]
fn start_rental_activates_a_funded_agreement() {
    let t = setup();
    let item = item_ref(&t.env, "listing-1");
    let id = create_agreement(&t, &item);
    mint(&t.env, &t.token, &t.renter, 1500);
    t.client().fund_agreement(&t.renter, &id);
    t.client().start_rental(&t.owner, &id);

    let stored: RentalAgreement = t
        .env
        .as_contract(&t.contract_id, || {
            t.env
                .storage()
                .persistent()
                .get(&DataKey::Agreement(id))
                .unwrap()
        });
    assert_eq!(stored.status, AgreementStatus::Active);
}

#[test]
fn start_rental_rejects_unfunded_agreement() {
    let t = setup();
    let item = item_ref(&t.env, "listing-1");
    // Created but never funded.
    let id = create_agreement(&t, &item);
    let res = t.client().try_start_rental(&t.owner, &id);
    assert!(matches!(res, Err(Ok(RentalError::InvalidStatus))));
}

#[test]
fn start_rental_rejects_non_owner() {
    let t = setup();
    let item = item_ref(&t.env, "listing-1");
    let id = create_agreement(&t, &item);
    mint(&t.env, &t.token, &t.renter, 1500);
    t.client().fund_agreement(&t.renter, &id);
    let res = t.client().try_start_rental(&t.renter, &id);
    assert!(matches!(res, Err(Ok(RentalError::Unauthorized))));
}

#[test]
fn start_rental_requires_owner_auth() {
    let t = setup_no_auth();
    let res = t.client().try_start_rental(&t.owner, &999);
    assert!(matches!(res, Err(Err(_))));
}

#[test]
fn full_happy_path_fund_to_release() {
    let t = setup();
    let item = item_ref(&t.env, "listing-1");
    let id = create_agreement(&t, &item);
    mint(&t.env, &t.token, &t.renter, 1500);
    t.client().fund_agreement(&t.renter, &id);
    t.client().start_rental(&t.owner, &id);

    // Rental period ends and the claim window passes without a claim.
    t.env.ledger().set_timestamp(1_700_172_801);
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
