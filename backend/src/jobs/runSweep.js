/**
 * One-shot expiry sweep, for an OS scheduler.
 *
 * Runs the same sweep the in-process cron job runs, prints a summary, and exits
 * with a non-zero code on failure so cron / Task Scheduler can report it.
 *
 *   npm run sweep
 *
 * This is the form to use in production (Phase 11): one process per run, no
 * long-lived timer to keep alive, and the OS handles retries and logging.
 * Because the sweep is idempotent, having both this and the in-process job
 * enabled at once is harmless.
 */

import { closePool } from '../config/db.js';
import { runExpirySweep, describeSweep } from '../services/expirySweep.js';

try {
  const result = await runExpirySweep();
  console.log(`[sweep] ${describeSweep(result)}`);
  console.log(JSON.stringify(result, null, 2));
  await closePool();
  process.exit(0);
} catch (err) {
  console.error(`[sweep] FAILED: ${err.message}`);
  await closePool().catch(() => {});
  process.exit(1);
}
