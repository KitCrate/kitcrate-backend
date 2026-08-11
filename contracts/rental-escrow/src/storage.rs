use soroban_sdk::{Address, Env};

use crate::error::RentalError;
use crate::types::{DataKey, RentalAgreement};

/// TTL target for agreement entries in persistent storage, in ledgers.
///
/// Stellar closes a ledger roughly every 5 seconds, so a year is about
/// 6.3 million ledgers. Every write extends the entry back out to this
/// TTL so an agreement can never expire mid-rental or during a claim
/// window. The SDK's `extend_ttl` takes `(key, threshold, extend_to)` and
/// only bumps an entry once its remaining TTL has dropped below the
/// threshold.
const AGREEMENT_TTL: u32 = 6_311_520; // 365.25 days of ledgers

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

pub fn read_arbiter(env: &Env) -> Result<Address, RentalError> {
    env.storage()
        .instance()
        .get(&DataKey::Arbiter)
        .ok_or(RentalError::NotFound)
}

pub fn read_token(env: &Env) -> Result<Address, RentalError> {
    env.storage()
        .instance()
        .get(&DataKey::Token)
        .ok_or(RentalError::NotFound)
}

/// One-time initialization of the admin, arbiter and token addresses.
pub fn write_initialized(env: &Env, admin: &Address, arbiter: &Address, token: &Address) {
    let store = env.storage().instance();
    store.set(&DataKey::Admin, admin);
    store.set(&DataKey::Arbiter, arbiter);
    store.set(&DataKey::Token, token);
    store.set(&DataKey::NextId, &1u64);
}

pub fn read_next_id(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::NextId).unwrap_or(1)
}

pub fn write_next_id(env: &Env, id: u64) {
    env.storage().instance().set(&DataKey::NextId, &id);
}

pub fn read_agreement(env: &Env, id: u64) -> Result<RentalAgreement, RentalError> {
    env.storage()
        .persistent()
        .get(&DataKey::Agreement(id))
        .ok_or(RentalError::NotFound)
}

/// Writes an agreement and explicitly extends its TTL so it never expires
/// while a rental or claim window is still live.
pub fn write_agreement(env: &Env, agreement: &RentalAgreement) {
    let key = DataKey::Agreement(agreement.id);
    env.storage().persistent().set(&key, agreement);
    env.storage()
        .persistent()
        .extend_ttl(&key, AGREEMENT_TTL, AGREEMENT_TTL);
}
