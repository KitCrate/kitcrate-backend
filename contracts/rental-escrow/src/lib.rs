#![no_std]

mod agreement;
mod dispute;
pub mod error;
mod events;
mod storage;
pub mod types;

use soroban_sdk::contract;

/// The KitCrate RentalEscrow contract.
///
/// A non-custodial escrow for peer-to-peer equipment rentals. Renting
/// parties lock a rental fee plus a security deposit; the deposit is
/// released back to the renter when the rental completes without a claim,
/// or split by a designated arbiter when a claim is raised.
///
/// Contract functions are split across `agreement` and `dispute` modules;
/// the `#[contract]` macro collects every `#[contractimpl]` block for this
/// type in the crate.
#[contract]
pub struct RentalEscrow;
