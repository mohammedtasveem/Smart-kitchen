import 'dotenv/config';

/**
 * Single source of truth for configuration.
 * Everything the app needs is read here once, so no other file touches
 * `process.env` directly.
 */

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(value, fallback) {
  if (!value) return fallback;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Only the literal strings 'true'/'false' override the default. */
function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: num(process.env.PORT, 5000) || 5000,
  corsOrigin: list(process.env.CORS_ORIGIN, ['http://localhost:5173']),

  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'smart_food_inventory',
  },

  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },

  /**
   * WhatsApp sending, via Meta's WhatsApp Cloud API (Phase 8).
   *
   * Meta's WhatsApp Cloud API: first-party, permanently free test number,
   * no template gate for free-form messages.
   */
  whatsapp: {
    /** Numeric id of the sending number, from the Meta app's WhatsApp panel. */
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
    // Pinned rather than "latest": Meta ships breaking changes per version, and a
    // silent upgrade is not something a daily cron job should discover on its own.
    apiVersion: process.env.WHATSAPP_API_VERSION ?? 'v21.0',
    /**
     * Message template registered in the Meta dashboard.
     *
     * Required for proactive (scheduled) sends: Meta only allows free-form text
     * within 24 hours of the recipient's last message. Outside that window the
     * Cloud API rejects with 131047 and only an approved template lands.
     *
     * The template must have exactly one body parameter ({{1}}) that receives
     * the full composed message. Example template body:
     *   "*Smart Kitchen* — expiry alert\n\n{{1}}"
     */
    templateName: process.env.WHATSAPP_TEMPLATE_NAME ?? '',
    templateLang: process.env.WHATSAPP_TEMPLATE_LANG ?? 'en',
    /**
     * Log the message instead of calling Meta.
     *
     * Forced on whenever the credentials are absent, so the whole Phase 8
     * pipeline -- queue, dispatch, retry, status -- runs and can be demonstrated
     * before anyone has a Meta app. See services/whatsapp.js.
     */
    dryRun: bool(process.env.WHATSAPP_DRY_RUN, false),
  },

  /**
   * The daily expiry sweep (Phase 7).
   *
   * There is no "near expiry days" setting here on purpose. That threshold is
   * defined once, in the CASE inside `v_food_items_status`, and the sweep reads
   * the view's verdict rather than re-deciding it. A second copy here is exactly
   * how the dashboard badge and the WhatsApp alert would drift apart.
   */
  sweep: {
    enabled: bool(process.env.EXPIRY_SWEEP_ENABLED, true),
    cron: process.env.EXPIRY_SWEEP_CRON ?? '0 8 * * *',
    // Must match the timezone MySQL is using, or the cron fires on a different
    // calendar day than the one CURDATE() reports.
    timezone: process.env.EXPIRY_SWEEP_TZ ?? 'Asia/Kolkata',
    // Covers "the server was switched off at 08:00". The sweep is idempotent,
    // so a boot run that duplicates the scheduled one costs nothing.
    runOnBoot: bool(process.env.EXPIRY_SWEEP_ON_BOOT, true),
    // How many days past expiry to keep reminding. Unbounded, an expired item
    // the user never deleted would raise a fresh alert every day forever.
    expiredGraceDays: num(process.env.EXPIRY_ALERT_GRACE_DAYS, 7),
  },

  /**
   * The WhatsApp dispatch worker (Phase 8).
   *
   * Runs a few minutes after the sweep rather than as part of it: the sweep must
   * stay network-free so a WhatsApp outage cannot cost an alert, and a separate
   * worker can be retried without re-running the classification.
   */
  dispatch: {
    enabled: bool(process.env.WHATSAPP_DISPATCH_ENABLED, true),
    // Default 08:05 -- five minutes after the sweep, so the queue it drains is
    // the one the sweep just filled.
    cron: process.env.WHATSAPP_DISPATCH_CRON ?? '5 8 * * *',
    timezone: process.env.WHATSAPP_DISPATCH_TZ ?? 'Asia/Kolkata',
    // Meta rate limits the Cloud API, and the free test number more so. One
    // batch per run keeps a big kitchen from tripping it.
    batchSize: num(process.env.WHATSAPP_BATCH_SIZE, 20),
    // Pause between sends, so a batch does not arrive as a burst.
    pauseMs: num(process.env.WHATSAPP_PAUSE_MS, 400),
    // A transient failure is retried on the next run; this bounds how many times
    // before the row is given up on as `failed`.
    maxAttempts: num(process.env.WHATSAPP_MAX_ATTEMPTS, 3),
    /**
     * How long an undelivered alert stays worth sending.
     *
     * Alerts are perishable: "expires tomorrow" delivered four days late is
     * worse than never sending it, because it is now wrong. Anything still
     * pending past this is failed with a reason rather than delivered.
     */
    staleAfterDays: num(process.env.WHATSAPP_STALE_AFTER_DAYS, 2),
  },

  recipes: {
    spoonacularKey: process.env.SPOONACULAR_API_KEY ?? '',
  },

  device: {
    /**
     * Shared secret the ESP32-CAM sends in `x-device-key`. The device has no
     * user account and no token -- one physical kitchen owns it -- so a single
     * long random string is the whole authentication story (Phase 10).
     */
    apiKey: process.env.DEVICE_API_KEY ?? '',
    /**
     * Whose kitchen the camera photographs. The key proves "a device", not
     * "which user", so this one id maps the camera to an account once in .env
     * instead of trusting an id the device sends.
     */
    userId: num(process.env.DEVICE_USER_ID, 0) || null,
    /**
     * Where uploaded photos land on disk.
     *
     * Deliberately local: a college demo has one camera and a handful of
     * images a day, and object storage would add an account, a bill and an
     * expiry policy for no gain. Serving them from `/uploads` keeps the whole
     * Phase 10 path dependency-free.
     */
    uploadDir: process.env.DEVICE_UPLOAD_DIR ?? 'uploads/detections',
    /**
     * Reject photos larger than this once decoded. The ESP32-CAM sends a VGA
     * JPEG (~60-150 KB); anything near the cap is a misconfigured client, not
     * a real capture.
     */
    maxImageBytes: num(process.env.DEVICE_MAX_IMAGE_BYTES, 2 * 1024 * 1024),
  },

  /**
   * Food recognition from the camera image (Phase 10, methodology step 2).
   *
   * Google Gemini's free tier covers a demo's photo volume comfortably, and
   * the key is optional: with no GEMINI_API_KEY the upload still works and
   * just proposes nothing, so the review screen becomes a plain manual form
   * over a photo. The feature degrades instead of disappearing.
   */
  vision: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
    // "gemini-2.5-flash" is no longer provisionable for new Google accounts
    // (the API answers 404 with a pointer at newer models), so the fallback
    // is the rolling "flash-latest" alias: it tracks Google's current flash
    // model and stayed reachable when the pinned name was rejected.
    model: process.env.GEMINI_MODEL ?? 'gemini-flash-latest',
    timeoutMs: num(process.env.GEMINI_TIMEOUT_MS, 20000),
  },
};

/**
 * Warn loudly about missing config instead of failing at a random later point.
 * Only JWT_SECRET is fatal in production -- the rest belong to phases that
 * are not wired up yet.
 */
export function checkEnv() {
  const warnings = [];

  if (!env.db.password) {
    warnings.push('DB_PASSWORD is empty -- set it in backend/.env after installing MySQL.');
  }
  if (!env.jwt.secret) {
    warnings.push('JWT_SECRET is empty -- login/signup (Phase 4) will not work.');
  }

  if (env.isProduction && !env.jwt.secret) {
    throw new Error('JWT_SECRET must be set in production.');
  }

  for (const warning of warnings) {
    console.warn(`[config] ${warning}`);
  }
}
