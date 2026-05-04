import mysql from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';
import type { AppConfig } from '../config.js';

let _pool: Pool | null = null;

export function getDb(config: AppConfig): Pool {
  if (!_pool) {
    _pool = mysql.createPool({
      host: config.dbHost,
      port: config.dbPort,
      user: config.dbUser,
      password: config.dbPassword,
      database: config.dbDatabase,
      waitForConnections: true,
      connectionLimit: 10,
      enableKeepAlive: true,
      timezone: '+00:00',
      multipleStatements: true
    });
  }
  return _pool;
}

export async function closeDb(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

