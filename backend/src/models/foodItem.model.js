import { query } from '../config/db.js';

/**
 * Data access for `food_items`.
 *
 * Two rules hold everywhere in this file:
 *
 *  1. **Reads go through `v_food_items_status`, writes go to `food_items`.**
 *     The view adds `days_left` and `expiry_status` computed against today's
 *     date, so every response carries a status that is correct at read time
 *     rather than at insert time.
 *
 *  2. **Every statement filters on `user_id`.** Not "most" -- every one,
 *     including the by-id lookups, updates and deletes. That single WHERE
 *     clause is what stops one user from touching another user's kitchen.
 */

const VIEW = 'v_food_items_status';

/** Columns the API exposes, in a stable order. */
const SELECT_COLUMNS = `id, user_id, name, category, quantity, unit,
  purchase_date, expiry_date, source, image_url, notes, is_consumed,
  days_left, expiry_status, created_at, updated_at`;

/**
 * DB row -> API shape.
 *
 * `quantity` needs the explicit Number(): mysql2 returns DECIMAL as a *string*
 * to avoid float precision loss, so without this the client would get "2.00"
 * where it expects 2.
 */
export function toPublicFoodItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    quantity: row.quantity === null ? null : Number(row.quantity),
    unit: row.unit,
    purchaseDate: row.purchase_date,
    expiryDate: row.expiry_date,
    source: row.source,
    imageUrl: row.image_url,
    notes: row.notes,
    isConsumed: Boolean(row.is_consumed),
    daysLeft: row.days_left === null ? null : Number(row.days_left),
    expiryStatus: row.expiry_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * One item, scoped to its owner.
 *
 * `userId` is a required argument rather than an optional filter on purpose --
 * there is no way to call this and accidentally fetch someone else's row.
 */
export async function findById(id, userId) {
  const rows = await query(
    `SELECT ${SELECT_COLUMNS} FROM ${VIEW} WHERE id = ? AND user_id = ? LIMIT 1`,
    [id, userId]
  );
  return rows[0] ?? null;
}

/**
 * Filtered list for one user.
 *
 * Ordering is the whole point of this endpoint: soonest expiry first, so the
 * dashboard and the Phase 8 alert job both naturally look at what matters.
 * Expired items sort to the very top since their `expiry_date` is smallest.
 */
export async function listByUser(userId, filters = {}) {
  const { status, category, search, includeConsumed = false, limit = 200, offset = 0 } = filters;

  const conditions = ['user_id = ?'];
  const values = [userId];

  if (!includeConsumed) {
    conditions.push('is_consumed = 0');
  }
  if (status) {
    conditions.push('expiry_status = ?');
    values.push(status);
  }
  if (category) {
    conditions.push('category = ?');
    values.push(category);
  }
  if (search) {
    conditions.push('name LIKE ?');
    // Escape the LIKE wildcards so a search for "50%" is a literal search.
    values.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }

  // limit/offset are interpolated, not bound. They have already been validated
  // as integers in range by validateFoodItemQuery, and MySQL's prepared-
  // statement protocol is unreliable about typing LIMIT placeholders.
  const safeLimit = Number.isInteger(limit) ? limit : 200;
  const safeOffset = Number.isInteger(offset) ? offset : 0;

  const rows = await query(
    `SELECT ${SELECT_COLUMNS}
       FROM ${VIEW}
      WHERE ${conditions.join(' AND ')}
      ORDER BY is_consumed ASC, expiry_date ASC, name ASC
      LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    values
  );
  return rows;
}

/** How many rows the same filters match, ignoring limit/offset. */
export async function countByUser(userId, filters = {}) {
  const { status, category, search, includeConsumed = false } = filters;

  const conditions = ['user_id = ?'];
  const values = [userId];

  if (!includeConsumed) conditions.push('is_consumed = 0');
  if (status) {
    conditions.push('expiry_status = ?');
    values.push(status);
  }
  if (category) {
    conditions.push('category = ?');
    values.push(category);
  }
  if (search) {
    conditions.push('name LIKE ?');
    values.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }

  const rows = await query(
    `SELECT COUNT(*) AS total FROM ${VIEW} WHERE ${conditions.join(' AND ')}`,
    values
  );
  return Number(rows[0].total);
}

export async function createFoodItem(userId, data) {
  const result = await query(
    `INSERT INTO food_items
       (user_id, name, category, quantity, unit, purchase_date, expiry_date,
        source, image_url, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      data.name,
      data.category,
      data.quantity,
      data.unit,
      data.purchaseDate,
      data.expiryDate,
      data.source,
      data.imageUrl,
      data.notes,
    ]
  );
  return findById(result.insertId, userId);
}

/**
 * Patch the keys present in `patch`.
 *
 * Column names come from this fixed map, never from the request body -- a
 * client cannot inject a column name it wasn't offered.
 *
 * Returns null if no row matched, which means "not yours or not there".
 */
export async function updateFoodItem(id, userId, patch) {
  const columns = {
    name: 'name',
    category: 'category',
    quantity: 'quantity',
    unit: 'unit',
    purchaseDate: 'purchase_date',
    expiryDate: 'expiry_date',
    notes: 'notes',
    imageUrl: 'image_url',
  };

  const assignments = [];
  const values = [];

  for (const [key, column] of Object.entries(columns)) {
    if (patch[key] !== undefined) {
      assignments.push(`${column} = ?`);
      values.push(patch[key]);
    }
  }

  if (assignments.length === 0) return findById(id, userId);

  values.push(id, userId);
  const result = await query(
    `UPDATE food_items SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?`,
    values
  );

  if (result.affectedRows === 0) return null;
  return findById(id, userId);
}

/**
 * Mark an item eaten / used up (Methodology step 11: inventory update after
 * consumption). The row is kept rather than deleted so the item leaves the
 * expiry alert pipeline while staying available as consumption history.
 */
export async function setConsumed(id, userId, consumed) {
  const result = await query(
    'UPDATE food_items SET is_consumed = ? WHERE id = ? AND user_id = ?',
    [consumed ? 1 : 0, id, userId]
  );
  if (result.affectedRows === 0) return null;
  return findById(id, userId);
}

export async function deleteFoodItem(id, userId) {
  const result = await query('DELETE FROM food_items WHERE id = ? AND user_id = ?', [
    id,
    userId,
  ]);
  return result.affectedRows > 0;
}

/**
 * Dashboard counts.
 *
 * GROUP BY only returns rows for statuses that exist, so the controller fills
 * the missing ones with 0 -- the frontend should never have to check whether a
 * key is present before rendering a badge.
 */
export async function statusCounts(userId) {
  const rows = await query(
    `SELECT expiry_status, COUNT(*) AS count
       FROM ${VIEW}
      WHERE user_id = ? AND is_consumed = 0
      GROUP BY expiry_status`,
    [userId]
  );
  return rows;
}

export async function consumedCount(userId) {
  const rows = await query(
    `SELECT COUNT(*) AS total FROM food_items WHERE user_id = ? AND is_consumed = 1`,
    [userId]
  );
  return Number(rows[0].total);
}

/** Distinct categories this user has actually used -- powers a filter dropdown. */
export async function listCategories(userId) {
  const rows = await query(
    `SELECT DISTINCT category
       FROM food_items
      WHERE user_id = ? AND category IS NOT NULL AND category <> ''
      ORDER BY category`,
    [userId]
  );
  return rows.map((row) => row.category);
}
