import { validateId, validateNotificationQuery } from '../utils/validate.js';
import * as Notification from '../models/notification.model.js';
import { runExpirySweep } from '../services/expirySweep.js';
import { runWhatsAppDispatch } from '../services/whatsappDispatch.js';
import { providerStatus } from '../services/whatsapp.js';
import { ApiError } from '../utils/apiError.js';
import { env } from '../config/env.js';

/**
 * Alert history + a manual sweep trigger (Phase 7).
 *
 * As with food items, the owner comes from `req.user.id` and never from the
 * request. That is also what makes the manual trigger safe to expose: it can
 * only ever sweep the caller's own kitchen, so no admin role is needed and one
 * user cannot cause alerts to be raised for another.
 *
 * `req.user` is the raw database row (see requireAuth), so it is snake_case
 * here -- `whatsapp_opt_in`, not `whatsappOptIn`.
 */

/** GET /api/notifications */
export async function listNotifications(req, res) {
  const filters = validateNotificationQuery(req.query);

  const [rows, total] = await Promise.all([
    Notification.listByUser(req.user.id, filters),
    Notification.countByUser(req.user.id, filters),
  ]);

  res.json({
    ok: true,
    count: rows.length,
    total,
    limit: filters.limit,
    offset: filters.offset,
    notifications: rows.map(Notification.toPublicNotification),
  });
}

/** GET /api/notifications/summary */
export async function summary(req, res) {
  const rows = await Notification.statusCounts(req.user.id);

  // Seed every status at 0 so the frontend can render a badge without first
  // checking whether the key exists.
  const counts = { pending: 0, sent: 0, failed: 0 };
  for (const row of rows) counts[row.status] = Number(row.count);

  res.json({
    ok: true,
    summary: {
      ...counts,
      total: counts.pending + counts.sent + counts.failed,
      // Surfaced so the UI can explain *why* nothing is queued for WhatsApp.
      whatsappReady: Boolean(req.user.phone) && Boolean(req.user.whatsapp_opt_in),
      // Phase 8: whether sends are real or simulated. The alerts page says so
      // out loud, because "sent" would otherwise be misleading in dry run.
      delivery: providerStatus(),
      schedule: {
        enabled: env.sweep.enabled,
        cron: env.sweep.cron,
        timezone: env.sweep.timezone,
        expiredGraceDays: env.sweep.expiredGraceDays,
        dispatchEnabled: env.dispatch.enabled,
        dispatchCron: env.dispatch.cron,
      },
    },
  });
}

/**
 * POST /api/notifications/check
 *
 * Runs the expiry sweep for the signed-in user only. The daily cron job does the
 * same thing for everyone; this exists so the check can be demonstrated on
 * demand without waiting for 08:00, and so the tests have a deterministic hook.
 *
 * Safe to call repeatedly: the sweep is idempotent, so a second call on the same
 * day reports `created: 0` rather than raising duplicate alerts.
 */
export async function checkNow(req, res) {
  const result = await runExpirySweep({ userId: req.user.id });

  // Return the refreshed list too, so the client does not need a second round
  // trip just to show what the sweep produced.
  const rows = await Notification.listByUser(req.user.id, { limit: 50, offset: 0 });

  res.json({
    ok: true,
    result,
    notifications: rows.map(Notification.toPublicNotification),
  });
}

/**
 * POST /api/notifications/send
 *
 * Flushes the caller's own WhatsApp queue (Phase 8). The daily cron does the same
 * for everyone at 08:05; this exists so the send can be demonstrated on demand.
 *
 * Deliberately separate from `/check` rather than folded into it. The sweep must
 * stay network-free -- that is what makes a WhatsApp outage cost nothing -- and
 * keeping the two endpoints apart is what keeps that split visible instead of
 * being an implementation detail one refactor away from disappearing.
 *
 * Never returns an error for a *delivery* failure: a message Meta refused is a
 * recorded outcome, not a broken request. The reason is in `result.errors` and on
 * the row itself.
 */
export async function sendNow(req, res) {
  const result = await runWhatsAppDispatch({ userId: req.user.id });

  const rows = await Notification.listByUser(req.user.id, { limit: 50, offset: 0 });

  res.json({
    ok: true,
    result,
    notifications: rows.map(Notification.toPublicNotification),
  });
}

/**
 * POST /api/notifications/:id/retry
 *
 * Puts one failed WhatsApp alert back in the queue and immediately tries it
 * again. For the common case where the user has just fixed the cause -- joined
 * re-engaged the chat, corrected their number, turned the opt-in back on -- and
 * does not want to wait until tomorrow morning.
 *
 * `requeue` is scoped by `user_id`, so the 404 below covers "no such alert" and
 * "not yours" with the same response: an id that belongs to someone else must not
 * be distinguishable from one that does not exist.
 */
export async function retryNotification(req, res) {
  const id = validateId(req.params.id, 'id');

  const requeued = await Notification.requeue(id, req.user.id, {
    staleAfterDays: env.dispatch.staleAfterDays,
  });

  if (!requeued) {
    // Look up why, so the message can be specific rather than a bare 404.
    const row = await Notification.findByIdForUser(id, req.user.id);
    if (!row) throw ApiError.notFound('Alert not found');
    if (row.channel !== 'whatsapp') {
      throw ApiError.badRequest('Only WhatsApp alerts can be retried', {
        channel: 'This alert was recorded in the app, so there is nothing to resend',
      });
    }
    if (row.status !== 'failed') {
      throw ApiError.badRequest(`This alert is already ${row.status}`, {
        status: row.status === 'sent' ? 'It has already been delivered' : 'It is still queued',
      });
    }
    // Left over: too old to be worth sending.
    throw ApiError.badRequest('This alert is too old to resend', {
      notifyDate: `Alerts are only resent within ${env.dispatch.staleAfterDays} day(s); ` +
        'run a fresh check instead',
    });
  }

  // Send straight away rather than leaving it for the cron -- the point of the
  // button is not waiting.
  const result = await runWhatsAppDispatch({ userId: req.user.id });
  const row = await Notification.findByIdForUser(id, req.user.id);

  res.json({
    ok: true,
    result,
    notification: Notification.toPublicNotification(row),
  });
}
