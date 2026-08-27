import mysql from 'mysql2/promise';
import { env } from './env.js';

/**
 * A single connection pool shared by the whole app.
 * Never create connections ad-hoc -- import `query` or `pool` from here.
 */
export const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
  // TiDB Cloud requires SSL/TLS connections
  ssl: env.db.host?.includes('tidbcloud.com') ? { rejectUnauthorized: true } : undefined,
  // Keep DATE columns as plain 'YYYY-MM-DD' strings. Without this, mysql2
  // converts them to JS Date objects in the server's local timezone, which
  // shifts expiry dates by a day -- exactly the bug Phase 7 cannot afford.
  dateStrings: ['DATE'],
});

/** Run a parameterised query and return just the rows. */
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** Run several statements atomically. `fn` receives the connection. */
export async function transaction(fn) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await fn(connection);
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

/** Health check -- never throws, so callers can report status cleanly. */
export async function pingDatabase() {
  try {
    const connection = await pool.getConnection();
    try {
      await connection.ping();
      return { ok: true };
    } finally {
      connection.release();
    }
  } catch (err) {
    return { ok: false, error: err.message, code: err.code ?? null };
  }
}

export async function closePool() {
  await pool.end();
}

/** Turn a raw mysql2 error code into something a human can act on. */
export function explainDbError(code) {
  switch (code) {
    case 'ECONNREFUSED':
      return 'MySQL server is not running. Start the "MySQL80" service in Windows Services.';
    case 'ER_ACCESS_DENIED_ERROR':
      return 'DB_USER / DB_PASSWORD is wrong. Check backend/.env.';
    case 'ER_BAD_DB_ERROR':
      return `Database "${env.db.database}" does not exist. Run: npm run db:migrate`;
    case 'ER_NO_SUCH_TABLE':
      return 'Tables are missing. Run: npm run db:migrate';
    case 'ETIMEDOUT':
      return 'Connection to MySQL timed out. Check DB_HOST / DB_PORT.';
    default:
      return null;
  }
}
