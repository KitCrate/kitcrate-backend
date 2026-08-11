.PHONY: all build test contract-build contract-test wasm \
	indexer-install indexer-typecheck indexer-build indexer-dev indexer-start \
	db-up db-down db-logs

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

db-up:
	docker compose -f indexer/docker-compose.yml up -d

db-down:
	docker compose -f indexer/docker-compose.yml down

db-logs:
	docker compose -f indexer/docker-compose.yml logs -f
