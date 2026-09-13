.PHONY: all build test contract-build contract-test wasm \
	indexer-install indexer-typecheck indexer-build indexer-dev indexer-start indexer-test \
	db-up db-down db-logs test-db-up test-db-down

all: test

build: contract-build indexer-build

contract-build:
	cargo build

contract-test:
	cargo test

# Build the deployable Soroban wasm artifact. soroban-sdk 27 requires the
# wasm32v1-none target; wasm32-unknown-unknown is unsupported since
# rustc 1.82.
wasm:
	cargo build --target wasm32v1-none --release -p rental-escrow

indexer-install:
	cd indexer && npm install

indexer-typecheck:
	cd indexer && npm run typecheck

indexer-build:
	cd indexer && npm run build

indexer-dev:
	cd indexer && npm run dev

indexer-start:
	cd indexer && npm start

# Requires test-db-up (a disposable Postgres on :5434, see
# docker-compose.test.yml) or any other Postgres reachable at the
# DATABASE_URL in indexer/.env.test.
indexer-test:
	cd indexer && npm test

db-up:
	docker compose -f indexer/docker-compose.yml up -d

db-down:
	docker compose -f indexer/docker-compose.yml down

db-logs:
	docker compose -f indexer/docker-compose.yml logs -f

test-db-up:
	docker compose -f indexer/docker-compose.test.yml up -d --wait

test-db-down:
	docker compose -f indexer/docker-compose.test.yml down
