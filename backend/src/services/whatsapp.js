import { env } from '../config/env.js';

/**
 * WhatsApp adapter -- the only file in the project that talks to a messaging
 * provider.
 *
 * Everything above it (the dispatch worker, the retry endpoint) deals in
 * "send this text to this number" and knows nothing about the provider, which is
 * what made the swap below a one-file change.
 *
 * ## Why Meta's Cloud API and not Twilio
 *
 * Meta's WhatsApp Cloud API is the first-party route: it gives a permanently
 * free test number and has no equivalent gate on free-form messages, so it was
 * the natural choice over third-party wrappers.
 *
 * ## Why `fetch` and not an SDK
 *
 * Sending is one JSON POST with a bearer token. The provider's error code is the
 * only part of the response this file needs, and an SDK's job is to hide exactly
 * that behind its own error class. Node 24 ships `fetch`, so the honest version
 * is shorter than the wrapper.
 *
 * ## Template vs free-form
 *
 * Meta only allows free-form text within 24 hours of the recipient's last
 * message. Outside that window (error 131047) only an approved template lands.
 * When `WHATSAPP_TEMPLATE_NAME` is configured the adapter tries the template
 * first and falls back to free-form text on a permanent template error -- so
 * during the demo window both paths are exercised, and once the template is
 * approved scheduled sends work too.
 *
 * ## Dry run
 *
 * With no credentials configured the module does not throw and does not disable
 * the feature -- it logs the message and returns a fake id. That is deliberate:
 * the whole Phase 8 pipeline (queue -> dispatch -> retry -> status in the UI) can
 * be built, tested and demonstrated before anyone has a Meta app, and the day the
 * credentials arrive nothing else has to change.
 */

const API_ROOT = 'https://graph.facebook.com';
const TIMEOUT_MS = 15_000;

/**
 * Failures that will still fail if tried again, so the row should be marked
 * `failed` immediately instead of occupying the queue for three more days.
 *
 * The one to understand is **131047**. WhatsApp only allows a free-form message
 * within 24 hours of the recipient's own last message; outside that window Meta
 * refuses it and only an approved template will land. Retrying cannot help --
 * the user has to write to the number again. See the note on templates below.
 *
 * Codes: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
const PERMANENT_CODES = new Set([
  100, // Invalid parameter -- a malformed request will not fix itself
  131047, // Re-engagement required: outside the 24-hour customer service window
  131026, // Undeliverable -- not a WhatsApp user, or not an allowed test recipient
  131051, // Unsupported message type
  132000, // Template param count mismatch
  132001, // Template does not exist in this language
  133010, // Sending number is not registered
  190, // Access token expired, revoked, or malformed
]);

/** Retrying these is the correct response, not marking the alert failed. */
const TRANSIENT_CODES = new Set([
  131000, // Generic provider error -- Meta's own advice is to retry
  131048, // Spam rate limit hit
  131056, // Pair rate limit: too many messages to this one recipient
  130429, // Account-level rate limit
  80007, // Rate limit
]);

export class WhatsAppError extends Error {
  /**
   * @param {string}  message
   * @param {object}  [meta]
   * @param {?number} [meta.code]      Provider error code, when it sent one
   * @param {?number} [meta.status]    HTTP status
   * @param {boolean} [meta.permanent] Retrying is pointless
   */
  constructor(message, { code = null, status = null, permanent = false } = {}) {
    super(message);
    this.name = 'WhatsAppError';
    this.code = code;
    this.status = status;
    this.permanent = permanent;
  }
}

/** True once both Cloud API settings are present in `.env`. */
export function isConfigured() {
  const { phoneNumberId, accessToken } = env.whatsapp;
  return Boolean(phoneNumberId && accessToken);
}

/**
 * Whether sends are being simulated.
 *
 * Missing credentials imply dry run -- an unconfigured install should log and
 * carry on, not crash the daily job.
 */
export function isDryRun() {
  return env.whatsapp.dryRun || !isConfigured();
}

/** How the adapter is currently set up, for /api/notifications/summary. */
export function providerStatus() {
  return {
    provider: 'meta-cloud-api',
    configured: isConfigured(),
    dryRun: isDryRun(),
    // The sender is identified by an opaque numeric id, not a phone number, so
    // this is safe to expose -- it is not a credential and not anyone's number.
    from: env.whatsapp.phoneNumberId || null,
    template: env.whatsapp.templateName || null,
  };
}

/**
 * '+91 98765 43210' -> '919876543210'.
 *
 * The Cloud API wants a bare E.164 number: country code, no '+', no separators.
 * Normalising here rather than in `users.phone` keeps the column a display-ready
 * phone number that the profile screen can show as the user typed it.
 */
export function toWhatsAppNumber(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits || null;
}

/**
 * Turn Meta's JSON error, or a thrown fetch error, into a WhatsAppError.
 *
 * Meta nests the useful part two levels down and repeats itself, so the most
 * specific human-readable string wins: `error_data.details` says "this template
 * has 3 params, you sent 2", where `message` only says "invalid parameter".
 */
function classify(status, payload) {
  const error = payload?.error ?? null;
  const code = Number.isFinite(error?.code) ? error.code : null;
  const detail =
    error?.error_data?.details || error?.message || `WhatsApp API returned HTTP ${status}`;

  let permanent;
  if (code !== null && PERMANENT_CODES.has(code)) permanent = true;
  else if (code !== null && TRANSIENT_CODES.has(code)) permanent = false;
  // No code to go on: 429 and 5xx are worth another try, other 4xx are not.
  else permanent = status !== 429 && status < 500;

  const label = code === null ? detail : `${detail} (WhatsApp ${code})`;
  return new WhatsAppError(label, { code, status, permanent });
}

/** Build the POST URL for the Cloud API messages endpoint. */
function messagesUrl(phoneNumberId) {
  const { apiVersion } = env.whatsapp;
  return `${API_ROOT}/${apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`;
}

/**
 * Fetch wrapper with timeout and error handling, shared by both send paths.
 */
async function apiPost(url, accessToken, body) {
  let response;
  let payload;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    payload = await response.json().catch(() => null);
  } catch (err) {
    // DNS failure, connection reset, timeout -- the message may well go through
    // on the next attempt, so never permanent.
    const what = err.name === 'TimeoutError' ? `timed out after ${TIMEOUT_MS}ms` : err.message;
    throw new WhatsAppError(`Could not reach the WhatsApp API: ${what}`, { permanent: false });
  }

  if (!response.ok) throw classify(response.status, payload);

  return {
    sid: payload?.messages?.[0]?.id ?? null,
    // Meta acknowledges receipt only; delivery is asynchronous and reported by
    // webhook, which this project does not consume.
    status: 'accepted',
    dryRun: false,
  };
}

/**
 * Send one WhatsApp message.
 *
 * When a message template is configured, tries the template first (works
 * outside the 24-hour window). If the template itself fails with a permanent
 * error (e.g. not yet approved), falls back to free-form text so the user
 * still gets something during the demo window.
 *
 * @param {object} params
 * @param {string} params.to    Recipient phone number, any human format
 * @param {string} params.body  Message text
 * @returns {Promise<{sid: string, status: string, dryRun: boolean}>}
 * @throws {WhatsAppError} `.permanent` says whether a retry could ever succeed
 */
export async function sendWhatsApp({ to, body }) {
  const number = toWhatsAppNumber(to);
  if (!number) {
    // Not a provider failure -- the row should never have been queued. Permanent
    // so the worker fails it instead of retrying a request it cannot build.
    throw new WhatsAppError('No recipient phone number', { permanent: true });
  }
  if (!body?.trim()) {
    throw new WhatsAppError('Refusing to send an empty message', { permanent: true });
  }

  if (isDryRun()) {
    const reason = isConfigured() ? 'WHATSAPP_DRY_RUN=true' : 'no WhatsApp credentials';
    console.log(`[whatsapp] DRY RUN (${reason}) -> +${number}: ${body}`);
    // Prefixed so a simulated send is never mistaken for a real one when the
    // id shows up in the database or the UI.
    return { sid: `dryrun-${crypto.randomUUID()}`, status: 'dry-run', dryRun: true };
  }

  const { phoneNumberId, accessToken, templateName } = env.whatsapp;
  const url = messagesUrl(phoneNumberId);

  // When a message template is configured, use it first. Meta only allows
  // free-form text within 24 hours of the recipient's last message; outside
  // that window a template is required (error 131047). If the template itself
  // fails (e.g. not yet approved), fall back to free-form text so the user
  // still gets something during the demo window.
  if (templateName) {
    console.log(`[whatsapp] Trying template '${templateName}' (lang: ${env.whatsapp.templateLang}) for +${number}`);
    try {
      const result = await apiPost(url, accessToken, {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: number,
        type: 'template',
        template: {
          name: templateName,
          language: { code: env.whatsapp.templateLang },
          components: [
            {
              type: 'body',
              parameters: [{ type: 'text', text: body }],
            },
          ],
        },
      });
      console.log(`[whatsapp] ✅ Template sent successfully (sid: ${result.sid})`);
      return result;
    } catch (err) {
      if (err.permanent) {
        // Template might not exist or not be approved yet -- fall through to
        // free-form text as a best-effort fallback.
        console.error(`[whatsapp] ⚠️ TEMPLATE FAILED — code: ${err.code}, status: ${err.status}, message: ${err.message}`);
        console.error(`[whatsapp] Falling back to free-form text for +${number}`);
      } else {
        throw err;
      }
    }
  }

  // Free-form text: requires the recipient to have messaged the number within
  // the last 24 hours.
  return apiPost(url, accessToken, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: number,
    type: 'text',
    // Link previews turn a plain reminder into a card with someone else's
    // thumbnail on it. Off.
    text: { preview_url: false, body },
  });
}
