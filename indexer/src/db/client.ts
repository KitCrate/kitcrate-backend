import { Pool } from 'pg';

import { config } from '../config.js';
import { SCHEMA_SQL } from './schema.js';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

/// Applies the schema (CREATE TABLE IF NOT EXISTS) on startup.
export async function initDb(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}
