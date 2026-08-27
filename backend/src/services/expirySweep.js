import { env } from '../config/env.js';
import * as Notification from '../models/notification.model.js';

/**
 * The expiry sweep -- Phase 7, methodology step 6 ("Expiry Monitoring") and the
 * front half of step 7 ("WhatsApp Alert").
 *
 * What it does: find every non-consumed item that is near expiry or recently
 * expired, and write one `notifications` row per item for today. What it does
 * NOT do: send anything. Phase 8's dispatch worker reads the `pending` rows and
 * owns delivery. Splitting it this way means a WhatsApp outage loses no alerts and
 * the sweep has no network dependency at all.
 *
 * The sweep is **idempotent**. Running it twice in one day creates nothing the
 * second time (see the dedupe in `findItemsNeedingAlert`), which is what makes
 * it safe to trigger from cron, from boot, and from the API all at once.
 */

/** '2.50' -> '2.5', '1.00' -> '1'. DECIMAL arrives from mysql2 as a string. */
function formatQuantity(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return String(Number(n.toFixed(2)));
}

/**
 * Lower-case phrasing for one item, to be dropped mid-sentence.
 *
 * Mirrors `expiryText` in the frontend on purpose: the wording a user sees on
 * the dashboard and the wording that arrives on WhatsApp should not disagree.
 */
function phrase(daysLeft) {
  if (daysLeft < -1) return `expired ${Math.abs(daysLeft)} days ago`;
  if (daysLeft === -1) return 'expired yesterday';
  if (daysLeft === 0) return 'expires today';
  if (daysLeft === 1) return 'expires tomorrow';
  return `expires in ${daysLeft} days`;
}

/** "Amul Milk (2 litre) expires tomorrow" */
export function buildMessage(item) {
  const qty = formatQuantity(item.quantity);
  const amount = qty ? ` (${qty} ${item.unit})` : '';
  return `${item.name}${amount} ${phrase(Number(item.days_left))}`;
}

/**
 * Which channel this alert is destined for.
 *
 * A user with no number, or who has opted out, still gets the row -- the alert
 * history is worth having in the app either way -- but it is marked `in_app` so
 * the Phase 8 worker, which selects `pending` + `whatsapp`, skips it without
 * needing to know anything about user preferences.
 *
 * `in_app` rows are written as already `sent`: "it is in your list" is true the
 * moment the row exists, and leaving them `pending` forever would make the
 * pending queue useless as a measure of what is actually waiting on Meta's Cloud API.
 */
function routeFor(item) {
  const canWhatsApp = Boolean(item.phone) && Boolean(item.whatsapp_opt_in);
  return canWhatsApp
    ? { channel: 'whatsapp', status: 'pending', sentAt: null }
    : { channel: 'in_app', status: 'sent', sentAt: new Date() };
}

/**
 * Run one sweep.
 *
 * @param {object}  [options]
 * @param {?number} [options.userId] Limit to one user. Used by
 *   `POST /api/notifications/check`, so a user can trigger their own sweep
 *   without being able to touch anyone else's kitchen.
 * @returns {Promise<object>} What happened -- safe to log or return as JSON.
 */
export async function runExpirySweep({ userId = null } = {}) {
  const startedAt = Date.now();

  // Asked for up front, not read off a result row: with nothing due there is no
  // row to read it from, and a report that cannot name its own date is useless
  // in a log.
  const [today, due] = await Promise.all([
    Notification.today(),
    Notification.findItemsNeedingAlert({
      userId,
      expiredGraceDays: env.sweep.expiredGraceDays,
    }),
  ]);

  const rows = due.map((item) => {
    const route = routeFor(item);
    return {
      userId: item.user_id,
      foodItemId: item.id,
      channel: route.channel,
      type: item.expiry_status === 'EXPIRED' ? 'expired' : 'near_expiry',
      message: buildMessage(item),
      status: route.status,
      // item.today, not the value above: it comes from the same statement that
      // decided expiry_status, so the two can never straddle a midnight.
      notifyDate: item.today,
      sentAt: route.sentAt,
    };
  });

  const created = await Notification.insertMany(rows);

  // Counted from `rows`, not from a second query: these describe the batch that
  // was just written, and a re-query could pick up a concurrent sweep's rows.
  const queuedForWhatsApp = rows.filter((r) => r.channel === 'whatsapp').length;

  return {
    today,
    scanned: due.length,
    created,
    // Non-zero only when two sweeps overlap -- the dedupe SELECT normally
    // filters duplicates out before the insert is even attempted.
    duplicatesSkipped: rows.length - created,
    queuedForWhatsApp,
    recordedInApp: rows.length - queuedForWhatsApp,
    nearExpiry: rows.filter((r) => r.type === 'near_expiry').length,
    expired: rows.filter((r) => r.type === 'expired').length,
    users: new Set(rows.map((r) => r.userId)).size,
    durationMs: Date.now() - startedAt,
  };
}

/** One-line summary for the server log. */
export function describeSweep(result) {
  if (result.created === 0) {
    return `${result.today}: nothing new to alert (${result.scanned} scanned)`;
  }
  return (
    `${result.today}: ${result.created} alert(s) for ${result.users} user(s) ` +
    `-- ${result.nearExpiry} near expiry, ${result.expired} expired ` +
    `(${result.queuedForWhatsApp} queued for WhatsApp, ${result.recordedInApp} in-app only) ` +
    `in ${result.durationMs}ms`
  );
}
