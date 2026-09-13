import express, { type Express } from 'express';
import cors from 'cors';

import { agreementsRouter } from './api/agreements.js';
import { authRouter } from './api/auth.js';
import { listingsRouter } from './api/listings.js';

/// Builds the Express app (routes + middleware) without binding a port or
/// touching the database/RPC listener. Split out from index.ts's main()
/// so route-level integration tests can exercise the real HTTP surface
/// (via app.listen(0) + fetch) against a real request/response pipeline,
/// not a hand-rolled call into a route handler function.
export function createApp(): Express {
  const app = express();
  // Allowed browser origins for the REST API. Configurable via CORS_ORIGIN
  // (comma-separated list) so the deployed frontend's URL can be added
  // without a code change; falls back to the local dev frontend. Set
  // CORS_ORIGIN to the Vercel URL (e.g. https://kitcrate.vercel.app) in
  // production.
  const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3001')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/agreements', agreementsRouter);
  app.use('/auth', authRouter);
  app.use('/listings', listingsRouter);

  return app;
}
