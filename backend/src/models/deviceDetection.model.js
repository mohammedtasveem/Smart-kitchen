import { query } from '../config/db.js';

/**
 * Data access for `device_detections` (Phase 10).
 *
 * Same two rules as foodItem.model.js: every statement filters on `user_id`,
 * and the model is the only place SQL is written. The one difference: a
 * device *upload* writes a row for a user it cannot prove it is -- the shared
 * DEVICE_API_KEY does that -- so `createForUser` takes the user id explicitly
 * and the controller is responsible for having validated it.
 */

const SELECT_COLUMNS = `id, user_id, image_url, status, detected_name, category,
  expiry_date, confidence, raw_ocr_text, provider, food_item_id,
  created_at, confirmed_at`;

/** DB row -> API shape. DECIMAL confidence arrives as a string (mysql2). */
export function toPublicDetection(row) {
  if (!row) return null;
  return {
    id: row.id,
    imageUrl: row.image_url,
    status: row.status,
    detectedName: row.detected_name,
    category: row.category,
    expiryDate: row.expiry_date,
    // Empty string in the DB means "the model read nothing worth keeping",
    // which the API reports as null rather than two ways of saying nothing.
    confidence: row.confidence === null ? null : Number(row.confidence),
    rawOcrText: row.raw_ocr_text || null,
    provider: row.provider,
    foodItemId: row.food_item_id,
    createdAt: row.created_at,
    confirmedAt: row.confirmed_at,
  };
}

/**
 * Store a new photo as a pending detection.
 *
 * `recognition` is whatever foodRecognition.js returned. With no AI key it is
 * the all-null NO_DETECTION shape, and the row still exists -- the photo is
 * the valuable part, the proposal is a bonus.
 */
export async function createForUser(userId, { imageUrl, recognition }) {
  const result = await query(
    `INSERT INTO device_detections
       (user_id, image_url, status, detected_name, category, expiry_date,
        confidence, raw_ocr_text, provider)
     VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      imageUrl,
      recognition.name,
      recognition.category,
      recognition.expiryDate,
      recognition.confidence,
      recognition.rawText,
      recognition.provider,
    ]
  );
  return findById(result.insertId, userId);
}

export async function findById(id, userId) {
  const rows = await query(
    `SELECT ${SELECT_COLUMNS} FROM device_detections WHERE id = ? AND user_id = ? LIMIT 1`,
    [id, userId]
  );
  return rows[0] ?? null;
}

/**
 * One user's photos waiting for review, newest first.
 *
 * Bounded at `limit` because the review screen is a queue, not an archive --
 * everything already confirmed or discarded is deliberately elsewhere (it is
 * in the inventory now, or it was rubbish).
 */
export async function listPending(userId, limit = 20) {
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 20;
  const rows = await query(
    `SELECT ${SELECT_COLUMNS} FROM device_detections
      WHERE user_id = ? AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT ${safeLimit}`,
    [userId]
  );
  return rows;
}

/**
 * Link a confirmed detection to the inventory row it became.
 *
 * Conditional on `status = 'pending'` so a double-tap on Confirm cannot create
 * two inventory items: the second UPDATE matches nothing and the caller
 * answers 409 instead. Same trick as the sweep's ON DUPLICATE KEY no-op --
 * make the database the arbiter of the race, not the request handler.
 */
export async function markConfirmed(id, userId, foodItemId) {
  const result = await query(
    `UPDATE device_detections
        SET status = 'confirmed', food_item_id = ?, confirmed_at = NOW()
      WHERE id = ? AND user_id = ? AND status = 'pending'`,
    [foodItemId, id, userId]
  );
  return result.affectedRows > 0;
}

export async function markDiscarded(id, userId) {
  const result = await query(
    `UPDATE device_detections
        SET status = 'discarded'
      WHERE id = ? AND user_id = ? AND status = 'pending'`,
    [id, userId]
  );
  return result.affectedRows > 0;
}
