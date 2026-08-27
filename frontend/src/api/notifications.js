import { api, toQuery } from './client.js';

/**
 * Notification endpoints (Phases 7 + 8).
 *
 * Same idea as foodItems.js -- URLs live here, pages don't build paths.
 */

export function listNotifications(filters = {}) {
  return api.get(`/notifications${toQuery(filters)}`);
}

export function getNotificationSummary() {
  return api.get('/notifications/summary');
}

/**
 * Runs the expiry sweep for the signed-in user right now, instead of waiting for
 * the daily job. Safe to press twice: the sweep is idempotent, so the second
 * call reports `created: 0` rather than duplicating alerts.
 */
export function checkNow() {
  return api.post('/notifications/check');
}

/**
 * Flushes the signed-in user's WhatsApp queue (Phase 8).
 *
 * Separate from `checkNow` because the two do genuinely different things: the
 * check writes rows and never touches the network, this one sends them. Never
 * rejects for a *delivery* failure -- a message Meta refused comes back in
 * `result.errors` with 200, because that is a recorded outcome, not a broken
 * request.
 */
export function sendNow() {
  return api.post('/notifications/send');
}

/**
 * Puts one failed WhatsApp alert back in the queue and sends it immediately.
 *
 * For when the user has just fixed the cause -- re-engaged the chat,
 * corrected their number, switched the opt-in back on -- and does not want to
 * wait for tomorrow's job.
 */
export function retryNotification(id) {
  return api.post(`/notifications/${id}/retry`);
}
