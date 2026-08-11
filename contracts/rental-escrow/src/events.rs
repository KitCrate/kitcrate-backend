// Events are emitted with `env.events().publish` rather than the newer
// `#[contractevent]` macro. The macro only supports static topic lists,
// while every event here carries the agreement id as a dynamic second
// topic segment so off-chain indexers can filter on it directly. That is
// not expressible with `#[contractevent]`, so the deprecated but fully
// supported `publish` API is used deliberately.
#![allow(deprecated)]

use soroban_sdk::{Env, String, Symbol};

use crate::types::RentalAgreement;

// Event emission helpers. Every event uses a short symbol topic with the
// agreement id as the second topic element, so off-chain indexers can
// filter on (contract, topic[0]) and read the id straight from topic[1].
// The data payload follows the layout documented in the README. Two
// deliberate extensions to the spec's event table, both required so the
// indexer can derive a usable current-state table from events alone:
//
// 1. `agreement_created` carries the full RentalAgreement as a named map
//    (the spec's `id, owner, renter` payload would not include the
//    amounts, times or item ref the indexer needs).
// 2. `claim_raised` appends `evidence_ref` to its data, since the
//    off-chain evidence pointer would otherwise have no on-chain trace.

pub fn agreement_created(env: &Env, agreement: &RentalAgreement) {
    let topics = (Symbol::new(env, "agreement_created"), agreement.id);
    env.events().publish(topics, agreement.clone());
}

pub fn agreement_funded(env: &Env, id: u64, amount: i128) {
    let topics = (Symbol::new(env, "agreement_funded"), id);
    env.events().publish(topics, (id, amount));
}

pub fn rental_started(env: &Env, id: u64) {
    let topics = (Symbol::new(env, "rental_started"), id);
    env.events().publish(topics, id);
}

pub fn claim_raised(env: &Env, id: u64, claim_amount: i128, evidence_ref: &String) {
    let topics = (Symbol::new(env, "claim_raised"), id);
    let data = (id, claim_amount, evidence_ref.clone());
    env.events().publish(topics, data);
}

pub fn dispute_resolved(env: &Env, id: u64, amount_to_owner: i128, amount_to_renter: i128) {
    let topics = (Symbol::new(env, "dispute_resolved"), id);
    let data = (id, amount_to_owner, amount_to_renter);
    env.events().publish(topics, data);
}

pub fn funds_released(env: &Env, id: u64) {
    let topics = (Symbol::new(env, "funds_released"), id);
    env.events().publish(topics, id);
}

pub fn agreement_cancelled(env: &Env, id: u64) {
    let topics = (Symbol::new(env, "agreement_cancelled"), id);
    env.events().publish(topics, id);
}
