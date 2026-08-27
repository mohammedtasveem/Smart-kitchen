/**
 * Demo helper: fills the demo account's kitchen with a realistic spread of
 * expiry dates, so the Phase 9 recommender has something to rank.
 *
 * Without it the demo account holds a handful of items left over from earlier
 * phase testing, most of them long expired -- and since the recommender
 * deliberately ignores expired stock, every recipe scores 0 and the page looks
 * broken rather than empty.
 *
 *   node tests/demo-phase9-items.mjs          add the items
 *   node tests/demo-phase9-items.mjs --undo   remove them again
 *
 * Not imported by the app. Dates are relative to today, so the same script keeps
 * working next week. `--undo` matches on the marker in `notes`, so it only ever
 * removes rows this script created.
 */
import { pool } from '../src/config/db.js';

const EMAIL = 'demo@smartkitchen.test';
const MARK = '[demo]';

/**
 * `days` is days from today until expiry. The spread is chosen to exercise every
 * urgency band the matcher scores against: 0-1 day, 2-3 days (the NEAR_EXPIRY
 * threshold), within a week, and comfortably fresh.
 */
const ITEMS = [
  { name: 'Spinach', category: 'Vegetables', qty: 1, unit: 'bunch', days: 0 },
  { name: 'Tomatoes', category: 'Vegetables', qty: 500, unit: 'g', days: 1 },
  { name: 'Paneer', category: 'Dairy', qty: 200, unit: 'g', days: 2 },
  { name: 'Curd', category: 'Dairy', qty: 500, unit: 'g', days: 3 },
  { name: 'Milk', category: 'Dairy', qty: 1, unit: 'litre', days: 3 },
  { name: 'Coriander', category: 'Vegetables', qty: 1, unit: 'bunch', days: 2 },
  { name: 'Onion', category: 'Vegetables', qty: 1, unit: 'kg', days: 21 },
  { name: 'Potato', category: 'Vegetables', qty: 1, unit: 'kg', days: 25 },
  { name: 'Carrot', category: 'Vegetables', qty: 400, unit: 'g', days: 8 },
  { name: 'Amul Butter 500g', category: 'Dairy', qty: 1, unit: 'packet', days: 45 },
  { name: 'Toor Dal', category: 'Pulses', qty: 1, unit: 'kg', days: 150 },
  { name: 'Eggs', category: 'Dairy', qty: 6, unit: 'pcs', days: 12 },
];

const undo = process.argv.includes('--undo');

const [[user]] = await pool.query('SELECT id FROM users WHERE email = ?', [EMAIL]);
if (!user) throw new Error(`No such user: ${EMAIL}`);

if (undo) {
  const [res] = await pool.query('DELETE FROM food_items WHERE user_id = ? AND notes LIKE ?', [
    user.id,
    `${MARK}%`,
  ]);
  console.log(`removed ${res.affectedRows} item(s)`);
} else {
  // Clear a previous run first, otherwise re-running builds up duplicates that
  // all match the same ingredient and the "have" lists get noisy.
  const [cleared] = await pool.query(
    'DELETE FROM food_items WHERE user_id = ? AND notes LIKE ?',
    [user.id, `${MARK}%`]
  );
  if (cleared.affectedRows > 0) console.log(`cleared ${cleared.affectedRows} previous demo item(s)`);

  for (const item of ITEMS) {
    await pool.query(
      `INSERT INTO food_items
         (user_id, name, category, quantity, unit, purchase_date, expiry_date, source, notes)
       VALUES (?, ?, ?, ?, ?, CURDATE(), DATE_ADD(CURDATE(), INTERVAL ? DAY), 'manual', ?)`,
      [user.id, item.name, item.category, item.qty, item.unit, item.days, `${MARK} demo stock`]
    );
  }
  console.log(`inserted ${ITEMS.length} demo item(s) on the demo account`);
}

await pool.end();
