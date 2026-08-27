/**
 * Database migration runner (Phase 3).
 *
 *   npm run db:migrate     create the database (if needed) and apply schema.sql
 *   npm run db:reset       DROP the database first, then recreate from scratch
 *
 * Connects WITHOUT a database selected, because on a fresh MySQL install the
 * database does not exist yet.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import mysql from 'mysql2/promise';

import { env } from '../config/env.js';
import { explainDbError } from '../config/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(here, 'schema.sql');

const shouldReset = process.argv.includes('--reset');

/**
 * A database name cannot be a bound parameter, so it goes into the SQL
 * string directly -- validate it rather than trusting .env blindly.
 */
function safeDbName(name) {
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(
      `Invalid DB_NAME "${name}". Only letters, numbers and underscores allowed.`
    );
  }
  return name;
}

async function confirmReset(database) {
  // Skip the prompt when piped / run in CI.
  if (!process.stdin.isTTY) return true;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `\n  WARNING: this will DROP the database "${database}" and delete all its data.\n  Type the database name to confirm: `
  );
  rl.close();
  return answer.trim() === database;
}

async function main() {
  const { host, port, user, password } = env.db;
  const database = safeDbName(env.db.database);

  console.log(`[migrate] connecting to ${host}:${port} as "${user}" ...`);

  const connection = await mysql.createConnection({
    host,
    port,
    user,
    password,
    multipleStatements: true, // schema.sql is one script with many statements
    // TiDB Cloud requires SSL/TLS connections
    ssl: host?.includes('tidbcloud.com') ? { rejectUnauthorized: true } : undefined,
  });

  try {
    if (shouldReset) {
      if (!(await confirmReset(database))) {
        console.log('[migrate] aborted -- nothing was changed.');
        return;
      }
      await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
      console.log(`[migrate] dropped database "${database}"`);
    }

    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    console.log(`[migrate] database "${database}" ready`);

    await connection.changeUser({ database });

    const sql = await fs.readFile(SCHEMA_PATH, 'utf8');
    await connection.query(sql);
    console.log('[migrate] schema.sql applied');

    const [tables] = await connection.query(
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_TYPE, TABLE_NAME`,
      [database]
    );

    console.log('\n[migrate] done. Objects in the database:');
    for (const { name, type } of tables) {
      const label = type === 'VIEW' ? 'view ' : 'table';
      console.log(`  ${label}  ${name}`);
    }
    console.log('');
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error(`\n[migrate] FAILED: ${err.message}`);
  const hint = explainDbError(err.code);
  if (hint) console.error(`[migrate] hint: ${hint}`);
  process.exitCode = 1;
});
