/**
 * One-off cleanup: remove throwaway test accounts left behind by the e2e suites.
 *
 * `fk_food_items_user` and `fk_notifications_user` are both ON DELETE CASCADE,
 * so deleting the user takes their items and alert history with it.
 *
 *   node tests/cleanup-test-users.mjs
 */
import { query, closePool } from '../src/config/db.js';

const PATTERNS = ['phase5-%@test.local', 'phase7-%@test.local', 'phase8-%@test.local'];

let removed = 0;
for (const pattern of PATTERNS) {
  const result = await query('DELETE FROM users WHERE email LIKE ?', [pattern]);
  console.log(`${pattern.padEnd(24)} -> ${result.affectedRows} user(s) removed`);
  removed += result.affectedRows;
}

const [{ orphans }] = await query(
  "SELECT COUNT(*) AS orphans FROM users WHERE email LIKE '%@test.local'"
);
console.log(`\n${removed} removed, ${orphans} test account(s) still present`);

await closePool();
