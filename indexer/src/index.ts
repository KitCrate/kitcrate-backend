import { pathToFileURL } from 'node:url';
import dns from 'node:dns';

import express from 'express';
import cors from 'cors';

import { agreementsRouter } from './api/agreements.js';
import { listingsRouter } from './api/listings.js';
import { config } from './config.js';
import { initDb } from './db/client.js';
import { startListener } from './listener.js';

export async function main(): Promise<void> {
  // soroban-testnet.stellar.org resolves to Cloudflare IPv4 and IPv6
  // addresses, and this environment cannot reach the IPv6 addresses
  // (connections time out). Node's fetch (used by the SDK through
  // feaxios) tries both address families and intermittently fails with
  // "AxiosError: fetch failed" (an ETIMEDOUT AggregateError) when the
  // IPv6 attempt stalls, so prefer IPv4 to keep RPC polling reliable.
  dns.setDefaultResultOrder('ipv4first');

  await initDb();

  const app = express();
  app.use(cors({ origin: 'http://localhost:3001' }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/agreements', agreementsRouter);
  app.use('/listings', listingsRouter);

  const server = app.listen(config.port, () => {
    console.log(`[api] KitCrate indexer API listening on http://localhost:${config.port}`);
  });

  const listener = startListener();

  const shutdown = (): void => {
    listener.stop();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('[index] fatal startup error', err);
    process.exit(1);
  });
}
