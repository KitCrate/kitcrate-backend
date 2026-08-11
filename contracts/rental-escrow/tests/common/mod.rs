use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{Address, Env};
use rental_escrow::{RentalEscrow, RentalEscrowClient};

/// Fixed ledger timestamp used by every test so time-dependent behavior
/// (claim windows, release deadlines) is deterministic.
pub const NOW: u64 = 1_700_000_000;

/// Shared environment for RentalEscrow integration tests.
pub struct TestEnv {
    pub env: Env,
    pub contract_id: Address,
    pub admin: Address,
    pub arbiter: Address,
    pub owner: Address,
    pub renter: Address,
    pub token: Address,
}

impl TestEnv {
    /// Fresh client bound to the deployed contract.
    pub fn client(&self) -> RentalEscrowClient {
        RentalEscrowClient::new(&self.env, &self.contract_id)
    }
}

/// Deploy the contract, register a Stellar Asset Contract and initialize.
/// All auth checks are mocked so tests exercise business logic directly.
pub fn setup() -> TestEnv {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(NOW);
    let admin = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let owner = Address::generate(&env);
    let renter = Address::generate(&env);
    let contract_id = env.register(RentalEscrow, ());
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let client = RentalEscrowClient::new(&env, &contract_id);
    client.initialize(&admin, &arbiter, &token);
    TestEnv {
        env,
        contract_id,
        admin,
        arbiter,
        owner,
        renter,
        token,
    }
}

/// Like `setup` but without mocked auth, for authorization-failure tests.
/// The contract is deployed but not initialized; initialization itself
/// requires admin auth and is exercised through `try_` calls.
pub fn setup_no_auth() -> TestEnv {
    let env = Env::default();
    env.ledger().set_timestamp(NOW);
    let admin = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let owner = Address::generate(&env);
    let renter = Address::generate(&env);
    let contract_id = env.register(RentalEscrow, ());
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    TestEnv {
        env,
        contract_id,
        admin,
        arbiter,
        owner,
        renter,
        token,
    }
}

/// Mint `amount` of the escrow token to `to` (requires token admin).
pub fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
}

/// Current token balance of `who`.
pub fn balance(env: &Env, token: &Address, who: &Address) -> i128 {
    TokenClient::new(env, token).balance(who)
}
