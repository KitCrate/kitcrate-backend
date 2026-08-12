use soroban_sdk::contracterror;

/// Business-logic error codes returned by the RentalEscrow contract.
///
/// Every fallible public function returns `Result<_, RentalError>`. Panics
/// are reserved for host-level or unreachable conditions; anything a caller
/// can trigger goes through this enum so the indexer and frontend can map
/// failures to user-facing messages.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RentalError {
    /// The requested agreement does not exist.
    NotFound = 1,
    /// The caller is not authorized for this operation.
    Unauthorized = 2,
    /// The agreement is not in the state required by this operation.
    InvalidStatus = 3,
    /// The claim window has already passed; a claim cannot be raised.
    ClaimWindowExpired = 4,
    /// The claim window is still open; funds cannot be released yet.
    ClaimWindowActive = 5,
    /// The agreement is already funded.
    AlreadyFunded = 6,
    /// The amount is not covered by the escrowed deposit.
    InsufficientAmount = 7,
    /// initialize has already been called.
    AlreadyInitialized = 8,
    /// An amount argument is invalid (zero or negative where not allowed).
    InvalidAmount = 9,
    /// The rental time range is invalid (end_time <= start_time).
    InvalidTimeRange = 10,
    /// An arithmetic operation overflowed u64 or i128.
    Overflow = 11,
    /// The owner and renter are the same address; a party cannot rent to itself.
    SameOwnerAndRenter = 12,
}
