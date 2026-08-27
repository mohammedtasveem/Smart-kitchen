import { query } from '../config/db.js';

/**
 * Data access for `users`. Everything that touches the users table lives here,
 * so controllers never write SQL.
 *
 * The DB uses snake_case; the API speaks camelCase. `toPublicUser` is the only
 * place that translation happens -- and it is also what guarantees
 * `password_hash` never leaves the server.
 */

const PUBLIC_COLUMNS = 'id, name, email, phone, whatsapp_opt_in, created_at';

export function toPublicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    whatsappOptIn: Boolean(row.whatsapp_opt_in),
    createdAt: row.created_at,
  };
}

/** Full row INCLUDING password_hash -- only for the login check. */
export async function findByEmailWithHash(email) {
  const rows = await query(
    `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE email = ? LIMIT 1`,
    [email]
  );
  return rows[0] ?? null;
}

export async function findById(id) {
  const rows = await query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ?? null;
}

export async function emailExists(email) {
  const rows = await query('SELECT 1 FROM users WHERE email = ? LIMIT 1', [email]);
  return rows.length > 0;
}

export async function createUser({ name, email, passwordHash, phone = null }) {
  const result = await query(
    `INSERT INTO users (name, email, password_hash, phone) VALUES (?, ?, ?, ?)`,
    [name, email, passwordHash, phone]
  );
  return findById(result.insertId);
}

/**
 * Patch only the keys present in `patch`. Builds the SET clause dynamically --
 * column names come from this fixed map, never from user input.
 */
export async function updateUser(id, patch) {
  const columns = {
    name: 'name',
    phone: 'phone',
    whatsappOptIn: 'whatsapp_opt_in',
  };

  const assignments = [];
  const values = [];

  for (const [key, column] of Object.entries(columns)) {
    if (patch[key] !== undefined) {
      assignments.push(`${column} = ?`);
      values.push(key === 'whatsappOptIn' ? (patch[key] ? 1 : 0) : patch[key]);
    }
  }

  if (assignments.length === 0) return findById(id);

  values.push(id);
  await query(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`, values);
  return findById(id);
}
