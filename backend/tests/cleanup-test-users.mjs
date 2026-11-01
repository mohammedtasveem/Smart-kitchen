/**
 * One-off cleanup: remove throwaway test accounts left behind by the e2e suites.
 *
 * `fk_food_items_user` and `fk_notifications_user` are both ON DELETE CASCADE,
 * so deleting the user takes their items and alert history with it.
 *
 * Camera photos are the exception: `device_detections` cascades but the JPEG
 * on disk does not, so every phase10 run would otherwise leave an orphan in
 * `uploads/detections/` forever. The files are collected first and unlinked
 * afterwards only if no surviving row still points at them.
 *
 *   node tests/cleanup-test-users.mjs
 */
import fs from 'node:fs/promises';

import { query, closePool } from '../src/config/db.js';

const PATTERNS = [
  'phase5-%@test.local',
  'phase7-%@test.local',
  'phase8-%@test.local',
  'phase9-%@test.local',
  'phase10-%@test.local',
];

const photos = (await query(
  "SELECT image_url FROM device_detections WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'phase10-%@test.local')"
)).map((row) => row.image_url);

let removed = 0;
for (const pattern of PATTERNS) {
  const result = await query('DELETE FROM users WHERE email LIKE ?', [pattern]);
  console.log(`${pattern.padEnd(24)} -> ${result.affectedRows} user(s) removed`);
  removed += result.affectedRows;
}

// Every photo above belonged to a user that no longer exists, so a row left
// behind would mean a *different* account still claims the file.
const stillReferenced = new Set(
  (await query('SELECT image_url FROM device_detections')).map((row) => row.image_url)
);

let unlinked = 0;
for (const url of photos) {
  if (stillReferenced.has(url)) continue;
  try {
    // `image_url` is `/uploads/...` and UPLOAD_ROOT is <backend>/uploads, so
    // the URL minus its leading slash, resolved from backend/, is the file.
    await fs.unlink(new URL(`../${url.replace(/^\//, '')}`, import.meta.url));
    unlinked += 1;
  } catch (err) {
    if (err.code !== 'ENOENT') console.log(`  ! ${url}: ${err.message}`);
  }
}
console.log(`${unlinked} orphaned camera photo(s) removed`);

const [{ orphans }] = await query(
  "SELECT COUNT(*) AS orphans FROM users WHERE email LIKE '%@test.local'"
);
console.log(`\n${removed} removed, ${orphans} test account(s) still present`);

await closePool();
