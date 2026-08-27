import { query } from '../config/db.js';

/**
 * Data access for `notifications` -- the alert outbox / audit log.
 *
 * Two rules, same spirit as foodItem.model.js:
 *
 *  1. **"Today" always comes from MySQL, never from Node.** Every query that
 *     needs the current date uses `CURDATE()`, and the sweep reads it back out
 *     of the row. The expiry classification in `v_food_items_status` is already
 *     built on `CURDATE()`, so taking the date from the same clock is what
 *     guarantees `notify_date` and `expiry_status` can never disagree -- even if
 *     the Node process and MySQL are on different timezones.
 *
 *  2. **Every read filters on `user_id`.** A notification names what is in
 *     someone's kitchen, so the isolation rules that apply to `food_items`
 *     apply here too.
 */

const TYPES = ['near_expiry', 'expired', 'recipe_suggestion'];
const STATUSES = ['pending', 'sent', 'failed'];
const CHANNELS = ['whatsapp', 'in_app', 'email'];

export { TYPES as NOTIFICATION_TYPES, STATUSES as NOTIFICATION_STATUSES, CHANNELS };

/** DB row -> API shape. */
export function toPublicNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    foodItemId: row.food_item_id,
    // Present only on the joined list query; null once the item is deleted.
    foodItemName: row.food_item_name ?? null,
    channel: row.channel,
    type: row.type,
    message: row.message,
    status: row.status,
    attempts: row.attempts ?? 0,
    lastAttemptAt: row.last_attempt_at ?? null,
    providerSid: row.provider_sid,
    errorMessage: row.error_message,
    notifyDate: row.notify_date,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

/**
 * MySQL's idea of today, as 'YYYY-MM-DD'.
 *
 * Asked of the database rather than computed in Node so it cannot disagree with
 * the `CURDATE()` that `v_food_items_status` classifies against -- see rule 1
 * at the top of this file.
 */
export async function today() {
  const rows = await query('SELECT CURDATE() AS today');
  return rows[0].today;
}

/**
 * Items that should be alerted on today, and have not been alerted on yet.
 *
 * The `NOT EXISTS` clause is the dedupe: it does in the SELECT what the
 * `uq_notifications_dedupe` UNIQUE key enforces at write time. Doing it here as
 * well means the caller gets an accurate "how many are new" count instead of
 * discovering it from a swallowed insert error.
 *
 * `expiredGraceDays` bounds the nagging. Without it, an expired item the user
 * never deleted would generate a fresh alert every single day, forever.
 *
 * NOTE: there is deliberately no "near expiry" threshold in this query. That
 * number lives in exactly one place -- the CASE in `v_food_items_status` -- and
 * this reads its verdict (`expiry_status`) rather than re-deciding it.
 */
export async function findItemsNeedingAlert({ userId = null, expiredGraceDays = 7 } = {}) {
  const conditions = [
    'v.is_consumed = 0',
    "v.expiry_status IN ('NEAR_EXPIRY', 'EXPIRED')",
    // days_left is negative once expired, so this is the "stop nagging" bound.
    'v.days_left >= ?',
  ];
  const values = [-Math.abs(expiredGraceDays)];

  if (userId !== null) {
    conditions.push('v.user_id = ?');
    values.push(userId);
  }

  return query(
    `SELECT
       v.id, v.user_id, v.name, v.quantity, v.unit, v.expiry_date,
       v.days_left, v.expiry_status,
       u.name AS user_name, u.phone, u.whatsapp_opt_in,
       CURDATE() AS today
     FROM v_food_items_status v
     JOIN users u ON u.id = v.user_id
    WHERE ${conditions.join('\n      AND ')}
      AND NOT EXISTS (
            SELECT 1
              FROM notifications n
             WHERE n.food_item_id = v.id
               AND n.notify_date  = CURDATE()
               AND n.type = CASE WHEN v.expiry_status = 'EXPIRED'
                                 THEN 'expired' ELSE 'near_expiry' END
          )
    ORDER BY v.user_id, v.expiry_date, v.name`,
    values
  );
}

/**
 * Insert a batch of alerts.
 *
 * `ON DUPLICATE KEY UPDATE id = id` is a deliberate no-op: it makes a
 * duplicate-key collision harmless without the blanket
 * error-suppression of `INSERT IGNORE`, which would also hide a bad foreign key
 * or a truncated column. Because the update changes nothing, MySQL counts it as
 * 0 affected rows -- so `affectedRows` is exactly the number of alerts actually
 * created, even if two sweeps race.
 */
export async function insertMany(rows) {
  if (rows.length === 0) return 0;

  const placeholders = rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
  const values = rows.flatMap((r) => [
    r.userId,
    r.foodItemId,
    r.channel,
    r.type,
    r.message,
    r.status,
    r.notifyDate,
    r.sentAt,
  ]);

  const result = await query(
    `INSERT INTO notifications
       (user_id, food_item_id, channel, type, message, status, notify_date, sent_at)
     VALUES ${placeholders}
     ON DUPLICATE KEY UPDATE id = id`,
    values
  );
  return result.affectedRows;
}

function listConditions(userId, filters) {
  const conditions = ['n.user_id = ?'];
  const values = [userId];

  if (filters.status) {
    conditions.push('n.status = ?');
    values.push(filters.status);
  }
  if (filters.type) {
    conditions.push('n.type = ?');
    values.push(filters.type);
  }
  if (filters.date) {
    conditions.push('n.notify_date = ?');
    values.push(filters.date);
  }
  return { where: conditions.join(' AND '), values };
}

/**
 * One user's alert history, newest first.
 *
 * LEFT JOIN, not JOIN: `fk_notifications_food_item` is ON DELETE SET NULL, so
 * the history survives the item being deleted. An inner join would make those
 * rows silently vanish from the list.
 */
export async function listByUser(userId, filters = {}) {
  const { where, values } = listConditions(userId, filters);

  const limit = Number.isInteger(filters.limit) ? filters.limit : 50;
  const offset = Number.isInteger(filters.offset) ? filters.offset : 0;

  return query(
    `SELECT n.*, f.name AS food_item_name
       FROM notifications n
       LEFT JOIN food_items f ON f.id = n.food_item_id
      WHERE ${where}
      ORDER BY n.notify_date DESC, n.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    values
  );
}

export async function countByUser(userId, filters = {}) {
  const { where, values } = listConditions(userId, filters);
  const rows = await query(
    `SELECT COUNT(*) AS total FROM notifications n WHERE ${where}`,
    values
  );
  return Number(rows[0].total);
}

/** Counts by status, for the alerts page header. */
export async function statusCounts(userId) {
  const rows = await query(
    `SELECT status, COUNT(*) AS count
       FROM notifications
      WHERE user_id = ?
      GROUP BY status`,
    [userId]
  );
  return rows;
}

/** Removes a user's whole alert history. Used by the tests to clean up. */
export async function deleteAllForUser(userId) {
  const result = await query('DELETE FROM notifications WHERE user_id = ?', [userId]);
  return result.affectedRows;
}

/* ------------------------------------------------------------------ Phase 8 */

/**
 * The WhatsApp send queue: rows the dispatch worker should try now.
 *
 * Three filters beyond the obvious `pending` + `whatsapp`:
 *
 *  - **`attempts < maxAttempts`** -- a row that has already failed transiently
 *    three times is left alone rather than retried forever. The worker fails it
 *    explicitly (see `expireStale`) instead of it silently lingering.
 *  - **`notify_date >= CURDATE() - staleAfterDays`** -- alerts are perishable.
 *    "expires tomorrow" delivered four days late is not late, it is wrong.
 *  - **`u.whatsapp_opt_in = 1`** -- checked again at send time, not just at
 *    queue time. Someone who opts out in the evening must not receive the alert
 *    that was queued for them that morning.
 *
 * The join also supplies the phone number, which is deliberately NOT copied into
 * the notification row: the number can change between queueing and sending, and
 * the current one is the correct one.
 */
export async function findPendingWhatsApp({
  maxAttempts = 3,
  staleAfterDays = 2,
  limit = 20,
  userId = null,
} = {}) {
  const conditions = [
    "n.status = 'pending'",
    "n.channel = 'whatsapp'",
    'n.attempts < ?',
    'n.notify_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)',
    'u.whatsapp_opt_in = 1',
    "u.phone IS NOT NULL AND u.phone <> ''",
  ];
  const values = [maxAttempts, Math.abs(staleAfterDays)];

  if (userId !== null) {
    conditions.push('n.user_id = ?');
    values.push(userId);
  }

  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 20;

  return query(
    `SELECT n.id, n.user_id, n.message, n.type, n.attempts, n.notify_date,
            u.name AS user_name, u.phone
       FROM notifications n
       JOIN users u ON u.id = n.user_id
      WHERE ${conditions.join('\n        AND ')}
      ORDER BY n.notify_date ASC, n.id ASC
      LIMIT ${safeLimit}`,
    values
  );
}

/**
 * Claim a row for sending.
 *
 * Bumps `attempts` and stamps `last_attempt_at` *before* the network call, and
 * only if the row is still `pending`. Two effects:
 *
 *  - A worker that is killed mid-send leaves the attempt counted, so a message
 *    that may already have gone out is not retried indefinitely.
 *  - `affectedRows === 0` means another worker got there first, so the caller
 *    skips the row. That is the whole concurrency control -- no lock table.
 */
export async function claimForSend(id) {
  const result = await query(
    `UPDATE notifications
        SET attempts = attempts + 1,
            last_attempt_at = NOW()
      WHERE id = ? AND status = 'pending'`,
    [id]
  );
  return result.affectedRows === 1;
}

/** Delivered. `sent_at` is when Meta's Cloud API accepted it, not when the phone showed it. */
export async function markManySent(ids, providerSid) {
  if (ids.length === 0) return 0;
  const result = await query(
    `UPDATE notifications
        SET status = 'sent',
            provider_sid = ?,
            error_message = NULL,
            sent_at = NOW()
      WHERE id IN (${ids.map(() => '?').join(', ')})`,
    [providerSid ?? null, ...ids]
  );
  return result.affectedRows;
}

/**
 * Record a failed send.
 *
 * `giveUp` decides between the two very different outcomes:
 *  - `false` -> stays `pending`, so the next run tries again. The reason is still
 *    written, so a queued row can explain why it has not gone yet.
 *  - `true`  -> `failed`, final. Either the error was permanent or the attempt
 *    budget is gone.
 */
export async function markManyFailed(ids, reason, { giveUp = false } = {}) {
  if (ids.length === 0) return 0;
  const result = await query(
    `UPDATE notifications
        SET status = ?,
            error_message = ?
      WHERE id IN (${ids.map(() => '?').join(', ')})`,
    [
      giveUp ? 'failed' : 'pending',
      String(reason ?? 'Unknown error').slice(0, 500),
      ...ids,
    ]
  );
  return result.affectedRows;
}

/**
 * Fail every pending WhatsApp row that is now too old to be worth sending.
 *
 * Without this, rows excluded by the `findPendingWhatsApp` staleness bound would
 * sit at `pending` forever and the "Queued" count on the alerts page would be a
 * lie -- it would include messages nothing will ever pick up.
 */
export async function expireStale({ maxAttempts = 3, staleAfterDays = 2 } = {}) {
  const result = await query(
    `UPDATE notifications
        SET status = 'failed',
            error_message = COALESCE(
              error_message,
              CONCAT('Not delivered within ', ?, ' day(s) -- alert is no longer current')
            )
      WHERE status = 'pending'
        AND channel = 'whatsapp'
        AND (notify_date < DATE_SUB(CURDATE(), INTERVAL ? DAY) OR attempts >= ?)`,
    [Math.abs(staleAfterDays), Math.abs(staleAfterDays), maxAttempts]
  );
  return result.affectedRows;
}

/**
 * Put a failed alert back in the queue, if it is still current.
 *
 * Resets `attempts` so the row gets a full budget again -- a user pressing
 * "Retry" has usually just fixed the cause (joined the sandbox, corrected their
 * number), which makes the previous attempts irrelevant.
 *
 * Scoped by `user_id` so one user cannot resurrect another's alerts.
 */
export async function requeue(id, userId, { staleAfterDays = 2 } = {}) {
  const result = await query(
    `UPDATE notifications
        SET status = 'pending',
            attempts = 0,
            error_message = NULL
      WHERE id = ?
        AND user_id = ?
        AND status = 'failed'
        AND channel = 'whatsapp'
        AND notify_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
    [id, userId, Math.abs(staleAfterDays)]
  );
  return result.affectedRows === 1;
}

/** One row by id, scoped to its owner. Used to explain a failed requeue. */
export async function findByIdForUser(id, userId) {
  const rows = await query(
    `SELECT n.*, f.name AS food_item_name
       FROM notifications n
       LEFT JOIN food_items f ON f.id = n.food_item_id
      WHERE n.id = ? AND n.user_id = ?`,
    [id, userId]
  );
  return rows[0] ?? null;
}
