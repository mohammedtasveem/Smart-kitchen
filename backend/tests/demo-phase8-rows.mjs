/**
 * Demo helper: puts one queued and one failed WhatsApp alert on the demo account
 * so the Phase 8 controls have something to act on.
 *
 * Without it the alerts page is in its steady state -- everything already sent --
 * and the "Send queued" and per-row "Retry" buttons correctly hide themselves,
 * which makes them impossible to show to anyone.
 *
 *   node tests/demo-phase8-rows.mjs          add the two rows
 *   node tests/demo-phase8-rows.mjs --undo   remove them again
 *
 * Not imported by the app. Safe to run twice: `--undo` matches on the marker
 * below, so it only ever removes rows this script created.
 */
import { pool } from '../src/config/db.js';

const EMAIL = 'demo@smartkitchen.test';
const MARK = '[demo]';

const undo = process.argv.includes('--undo');

const [[user]] = await pool.query('SELECT id FROM users WHERE email = ?', [EMAIL]);
if (!user) throw new Error(`No such user: ${EMAIL}`);

if (undo) {
  const [res] = await pool.query('DELETE FROM notifications WHERE user_id = ? AND message LIKE ?', [
    user.id,
    `${MARK}%`,
  ]);
  console.log(`removed ${res.affectedRows} row(s)`);
} else {
  // `food_item_id` is left NULL on purpose. The dedupe unique key is
  // (food_item_id, type, notify_date) and today's real combinations are already
  // taken by the seeded alerts; MySQL treats NULLs in a unique index as distinct,
  // so these two slot in without colliding.
  await pool.query(
    `INSERT INTO notifications
       (user_id, food_item_id, channel, type, message, status, attempts, error_message, notify_date)
     VALUES
       (?, NULL, 'whatsapp', 'near_expiry', ?, 'pending', 0, NULL, CURDATE()),
       (?, NULL, 'whatsapp', 'expired',     ?, 'failed',  2, ?,    CURDATE())`,
    [
      user.id,
      `${MARK} Paneer expires tomorrow — use it soon.`,
      user.id,
      `${MARK} Tomatoes expired 3 days ago — please discard.`,
      'Meta Cloud API rejected: recipient has not joined WhatsApp (WhatsApp 131026)',
    ]
  );
  console.log('inserted 1 queued + 1 failed alert on the demo account');
}

await pool.end();
