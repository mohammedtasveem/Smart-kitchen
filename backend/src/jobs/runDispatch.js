/**
 * One-shot WhatsApp dispatch, for an OS scheduler.
 *
 * Sends whatever the expiry sweep has left queued, prints a summary, and exits
 * non-zero on failure so cron / Task Scheduler can report it.
 *
 *   npm run dispatch
 *
 * Pair it with `npm run sweep` a few minutes earlier. In production (Phase 11)
 * this is the form to use: one process per run, no long-lived timer to keep alive,
 * and the OS handles retries and logging.
 *
 * With no WhatsApp credentials in `.env` this still runs end to end and prints each
 * message it *would* have sent -- see services/whatsapp.js.
 */

import { closePool } from '../config/db.js';
import { runWhatsAppDispatch, describeDispatch } from '../services/whatsappDispatch.js';

try {
  const result = await runWhatsAppDispatch();
  console.log(`[dispatch] ${describeDispatch(result)}`);
  console.log(JSON.stringify(result, null, 2));
  await closePool();
  // A permanent failure is a real result, not a crash: the run did its job by
  // recording why. Only an exception exits non-zero, so the OS scheduler does not
  // start alerting on "this number never joined the sandbox".
  process.exit(0);
} catch (err) {
  console.error(`[dispatch] FAILED: ${err.message}`);
  await closePool().catch(() => {});
  process.exit(1);
}
