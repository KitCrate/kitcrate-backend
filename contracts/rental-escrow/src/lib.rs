#![no_std]

mod error;
mod storage;
mod types;

/// The KitCrate RentalEscrow contract.
///
/// A non-custodial escrow for peer-to-peer equipment rentals. Renting
/// parties lock a rental fee plus a security deposit; the deposit is
/// released back to the renter when the rental completes without a claim,
/// or split by a designated arbiter when a claim is raised.
pub struct RentalEscrow;
