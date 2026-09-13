import 'dotenv/config';

export interface Config {
  rpcUrl: string;
  contractId: string;
  databaseUrl: string;
  port: number;
  pollIntervalMs: number;
  startLedger: number;
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, got "${raw}"`);
  }
  return parsed;
}

export function loadConfig(): Config {
  return {
    rpcUrl: process.env.RPC_URL ?? 'https://soroban-testnet.stellar.org',
    contractId: process.env.CONTRACT_ID ?? '',
    // Port 5433, matching docker-compose.yml's deliberate host-port
    // mapping (chosen to avoid colliding with a Postgres already running
    // locally on the default 5432) -- not the Postgres default.
    databaseUrl:
      process.env.DATABASE_URL ?? 'postgres://kitcrate:kitcrate@localhost:5433/kitcrate',
    port: numberFromEnv('PORT', 3000),
    pollIntervalMs: numberFromEnv('POLL_INTERVAL_MS', 5000),
    startLedger: numberFromEnv('START_LEDGER', 1),
  };
}

export const config = loadConfig();
