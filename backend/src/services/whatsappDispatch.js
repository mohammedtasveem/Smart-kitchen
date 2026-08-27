import { env } from '../config/env.js';
import * as Notification from '../models/notification.model.js';
import { isDryRun, providerStatus, sendWhatsApp } from './whatsapp.js';

/**
 * The WhatsApp dispatch worker -- Phase 8, the back half of methodology step 7.
 *
 * Phase 7's sweep filled the queue and sent nothing. This drains it.
 *
 * ## One message per user, not per item
 *
 * The queue holds one row per *item*, because that is the right unit for dedupe
 * (`uq_notifications_dedupe` is keyed on the food item) and for the alert history
 * on screen. It is the wrong unit for a phone: four items expiring on the same
 * morning must not arrive as four separate WhatsApp messages.
 *
 * So the worker groups the batch by user, sends one grouped message, and stamps
 * the same provider SID on every row it covered. Delivery becomes all-or-nothing
 * per user, which is also the easier thing to reason about -- there is no state
 * where half of someone's alerts went out.
 *
 * ## Failure handling
 *
 * Two kinds of failure, from `WhatsAppError.permanent`:
 *
 *  - **transient** (Meta 5xx, rate limit, no network) -- rows stay `pending`
 *    with the reason recorded, and the next run tries again until
 *    `dispatch.maxAttempts` is used up.
 *  - **permanent** (bad number, opted out, outside WhatsApp's 24-hour window) --
 *    rows go straight to `failed`. Retrying a permanent error just burns the
 *    attempt budget and delays the honest answer on the alerts page.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rows for one user, in the order they should be listed. */
function groupByUser(rows) {
  const byUser = new Map();
  for (const row of rows) {
    const bucket = byUser.get(row.user_id);
    if (bucket) bucket.rows.push(row);
    else byUser.set(row.user_id, { userId: row.user_id, name: row.user_name, phone: row.phone, rows: [row] });
  }
  return [...byUser.values()];
}

/** First name only -- "Hi Noorain" reads better than the full registered name. */
function firstName(name) {
  const first = String(name ?? '').trim().split(/\s+/)[0];
  return first || 'there';
}

/**
 * The WhatsApp message body for one user's batch.
 *
 * `*bold*` is WhatsApp's own markup, not Markdown -- it renders on the phone.
 * Expired items lead, because they are the ones already costing money.
 *
 * The per-item text is reused verbatim from `notifications.message`, which the
 * sweep composed. Re-phrasing it here is how the app and the message would end up
 * describing the same item two different ways.
 */
export function composeBody(group) {
  const expired = group.rows.filter((r) => r.type === 'expired');
  const soon = group.rows.filter((r) => r.type !== 'expired');

  const lines = [`*Smart Kitchen* — expiry alert`, '', `Hi ${firstName(group.name)},`, ''];

  if (expired.length > 0) {
    lines.push(`*Already expired (${expired.length})*`);
    for (const row of expired) lines.push(`• ${row.message}`);
    if (soon.length > 0) lines.push('');
  }

  if (soon.length > 0) {
    lines.push(`*Use soon (${soon.length})*`);
    for (const row of soon) lines.push(`• ${row.message}`);
  }

  lines.push('', 'Open Smart Kitchen to plan a recipe with these before they go to waste.');
  return lines.join('\n');
}

/**
 * Send one user's grouped alert.
 *
 * Claims each row first, and drops any row another worker already took. Claiming
 * before composing means the message never mentions an item that a concurrent run
 * is also about to mention.
 */
async function dispatchGroup(group, { maxAttempts }) {
  const claimed = [];
  for (const row of group.rows) {
    if (await Notification.claimForSend(row.id)) claimed.push(row);
  }

  if (claimed.length === 0) {
    return { userId: group.userId, skipped: group.rows.length, sent: 0, failed: 0, retryLater: 0 };
  }

  const ids = claimed.map((r) => r.id);
  const claimedGroup = { ...group, rows: claimed };

  try {
    const { sid } = await sendWhatsApp({ to: group.phone, body: composeBody(claimedGroup) });
    await Notification.markManySent(ids, sid);
    return {
      userId: group.userId,
      sent: ids.length,
      failed: 0,
      retryLater: 0,
      skipped: group.rows.length - ids.length,
      providerSid: sid,
    };
  } catch (err) {
    // Every row in the group shares the outcome, so the highest attempt count in
    // the batch decides whether the whole group has run out of budget.
    const attemptsUsed = Math.max(...claimed.map((r) => r.attempts)) + 1;
    const giveUp = err.permanent === true || attemptsUsed >= maxAttempts;

    await Notification.markManyFailed(ids, err.message, { giveUp });

    return {
      userId: group.userId,
      sent: 0,
      failed: giveUp ? ids.length : 0,
      retryLater: giveUp ? 0 : ids.length,
      skipped: group.rows.length - ids.length,
      error: err.message,
      permanent: err.permanent === true,
      attemptsUsed,
    };
  }
}

/**
 * Run one dispatch pass.
 *
 * @param {object}  [options]
 * @param {?number} [options.userId] Limit to one user -- used by the "Send now"
 *   button, so a user can flush their own queue without touching anyone else's.
 * @param {?number} [options.limit]  Override the configured batch size.
 * @returns {Promise<object>} What happened -- safe to log or return as JSON.
 */
export async function runWhatsAppDispatch({ userId = null, limit = null } = {}) {
  const startedAt = Date.now();
  const { maxAttempts, staleAfterDays, batchSize, pauseMs } = env.dispatch;

  // Retire anything nothing will ever pick up, first. Otherwise the "Queued"
  // number on the alerts page counts messages that are never going to be sent.
  const expired = await Notification.expireStale({ maxAttempts, staleAfterDays });

  const queue = await Notification.findPendingWhatsApp({
    maxAttempts,
    staleAfterDays,
    limit: Number.isInteger(limit) && limit > 0 ? limit : batchSize,
    userId,
  });

  const groups = groupByUser(queue);
  const outcomes = [];

  for (const [index, group] of groups.entries()) {
    outcomes.push(await dispatchGroup(group, { maxAttempts }));
    // Space the sends out, but do not pause after the last one -- that is pure
    // added latency on the API response behind the "Send now" button.
    if (pauseMs > 0 && index < groups.length - 1) await sleep(pauseMs);
  }

  const total = (key) => outcomes.reduce((sum, o) => sum + (o[key] ?? 0), 0);

  return {
    queued: queue.length,
    recipients: groups.length,
    messagesSent: outcomes.filter((o) => o.sent > 0).length,
    alertsSent: total('sent'),
    alertsFailed: total('failed'),
    alertsRetryLater: total('retryLater'),
    alertsSkipped: total('skipped'),
    staleExpired: expired,
    dryRun: isDryRun(),
    provider: providerStatus(),
    // Only the failures, and only their reasons -- a phone number must not end up
    // in a log file.
    errors: outcomes
      .filter((o) => o.error)
      .map((o) => ({ userId: o.userId, error: o.error, permanent: o.permanent })),
    durationMs: Date.now() - startedAt,
  };
}

/** One-line summary for the server log. */
export function describeDispatch(result) {
  if (result.queued === 0) {
    const tail = result.staleExpired > 0 ? ` (${result.staleExpired} stale expired)` : '';
    return `nothing queued for WhatsApp${tail}`;
  }

  const mode = result.dryRun ? ' [DRY RUN]' : '';
  const parts = [
    `${result.alertsSent} alert(s) in ${result.messagesSent} message(s) to ${result.recipients} user(s)`,
  ];
  if (result.alertsRetryLater > 0) parts.push(`${result.alertsRetryLater} will retry`);
  if (result.alertsFailed > 0) parts.push(`${result.alertsFailed} failed`);
  if (result.staleExpired > 0) parts.push(`${result.staleExpired} stale expired`);

  return `${parts.join(', ')} in ${result.durationMs}ms${mode}`;
}
