-- ===========================================================================
--  Smart Food Inventory & Expiry Alert System -- schema
--  Phase 3
--
--  Applied by `npm run db:migrate`, which creates the database first and
--  then runs this file. Every statement is idempotent (IF NOT EXISTS /
--  CREATE OR REPLACE), so re-running the migration is safe.
-- ===========================================================================


-- ---------------------------------------------------------------------------
--  users  --  accounts (Phase 4: auth, Phase 8: WhatsApp destination)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  name            VARCHAR(100)    NOT NULL,
  -- 191 chars so the UNIQUE index fits in utf8mb4 on older MySQL versions.
  email           VARCHAR(191)    NOT NULL,
  password_hash   VARCHAR(255)    NOT NULL,
  -- E.164 format, e.g. +919876543210 -- Meta Cloud API needs it this way.
  phone           VARCHAR(20)             DEFAULT NULL,
  whatsapp_opt_in TINYINT(1)      NOT NULL DEFAULT 1,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
--  food_items  --  the inventory (Phase 5 CRUD, Phase 7 expiry, Phase 10 cam)
--
--  NOTE: expiry status (Fresh / Near Expiry / Expired) is deliberately NOT
--  stored as a column. A stored status goes stale the moment the clock rolls
--  past midnight. It is computed instead -- see v_food_items_status below.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS food_items (
  id            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  user_id       INT UNSIGNED    NOT NULL,
  name          VARCHAR(150)    NOT NULL,
  category      VARCHAR(60)             DEFAULT NULL,
  quantity      DECIMAL(10, 2)  NOT NULL DEFAULT 1.00,
  unit          VARCHAR(20)     NOT NULL DEFAULT 'pcs',
  purchase_date DATE                    DEFAULT NULL,
  expiry_date   DATE            NOT NULL,
  -- Where the row came from: typed by hand, or detected by the ESP32-CAM.
  source        ENUM('manual', 'esp32cam') NOT NULL DEFAULT 'manual',
  image_url     VARCHAR(500)            DEFAULT NULL,
  notes         VARCHAR(500)            DEFAULT NULL,
  -- Soft "used up" flag: keeps history without deleting the row.
  is_consumed   TINYINT(1)      NOT NULL DEFAULT 0,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
                                ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_food_items_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  -- Covers the two hot queries: "my inventory sorted by expiry" (Phase 5)
  -- and "everything expiring soon, all users" (Phase 8 daily job).
  KEY idx_food_items_user_expiry (user_id, expiry_date),
  KEY idx_food_items_expiry (expiry_date, is_consumed)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
--  recipes  --  local cache of external recipe API results (Phase 9)
--
--  Cached so the same Spoonacular call isn't repeated -- the free tier allows
--  only ~150 requests/day.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recipes (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  source            VARCHAR(40)   NOT NULL DEFAULT 'spoonacular',
  -- The provider's own id, used to detect duplicates on refetch.
  external_id       VARCHAR(80)           DEFAULT NULL,
  title             VARCHAR(255)  NOT NULL,
  image_url         VARCHAR(500)          DEFAULT NULL,
  ready_in_minutes  INT UNSIGNED          DEFAULT NULL,
  servings          INT UNSIGNED          DEFAULT NULL,
  source_url        VARCHAR(500)          DEFAULT NULL,
  instructions      TEXT                  DEFAULT NULL,
  -- JSON array of ingredient names, lowercased -- what Phase 9 matches
  -- expiring food_items against.
  ingredients       JSON                  DEFAULT NULL,
  fetched_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recipes_source_external (source, external_id),
  KEY idx_recipes_title (title)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
--  notifications  --  outbox / audit log for alerts (Phase 8)
--
--  Rows are written as 'pending' and updated to 'sent' or 'failed' by the
--  WhatsApp dispatch worker, so a crash mid-send is recoverable and retryable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id       INT UNSIGNED  NOT NULL,
  food_item_id  INT UNSIGNED          DEFAULT NULL,
  channel       ENUM('whatsapp', 'in_app', 'email')                 NOT NULL DEFAULT 'whatsapp',
  type          ENUM('near_expiry', 'expired', 'recipe_suggestion') NOT NULL,
  message       TEXT          NOT NULL,
  status        ENUM('pending', 'sent', 'failed')                   NOT NULL DEFAULT 'pending',
  -- Delivery bookkeeping (Phase 8). A send can fail for a reason that will fix
  -- itself (Meta 5xx, no network) so `attempts` is what stops an unfixable one
  -- from being retried forever.
  attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_attempt_at DATETIME            DEFAULT NULL,
  -- Meta Cloud API message id, for looking up delivery status later.
  provider_sid  VARCHAR(100)          DEFAULT NULL,
  error_message TEXT                  DEFAULT NULL,
  -- The calendar day this alert is *for*. Together with the UNIQUE key below
  -- it stops the daily job from spamming the same item twice in one day
  -- (e.g. if the cron runs again after a restart).
  notify_date   DATE          NOT NULL,
  sent_at       DATETIME              DEFAULT NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_notifications_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  -- Keep the notification history even if the food item is deleted.
  CONSTRAINT fk_notifications_food_item
    FOREIGN KEY (food_item_id) REFERENCES food_items (id) ON DELETE SET NULL,
  UNIQUE KEY uq_notifications_dedupe (food_item_id, type, notify_date),
  KEY idx_notifications_user_created (user_id, created_at),
  KEY idx_notifications_status (status),
  -- Serves the Phase 8 dispatch queue lookup:
  --   WHERE status='pending' AND channel='whatsapp' AND notify_date >= ?
  KEY idx_notifications_queue (status, channel, notify_date)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;


-- ---------------------------------------------------------------------------
--  v_food_items_status  --  computed expiry classification (Phase 7)
--
--  The ONE place the "near expiry" threshold is defined. Change the 3 below
--  and every query, dashboard badge and WhatsApp alert follows.
--
--  Usage:
--    SELECT * FROM v_food_items_status
--     WHERE user_id = ? AND is_consumed = 0
--     ORDER BY expiry_date;
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_food_items_status AS
SELECT
  fi.*,
  DATEDIFF(fi.expiry_date, CURDATE()) AS days_left,
  CASE
    WHEN fi.expiry_date <  CURDATE()                     THEN 'EXPIRED'
    WHEN DATEDIFF(fi.expiry_date, CURDATE()) <= 3        THEN 'NEAR_EXPIRY'
    ELSE                                                      'FRESH'
  END AS expiry_status
FROM food_items fi;


-- ---------------------------------------------------------------------------
--  In-place upgrades
--
--  Every CREATE above is `IF NOT EXISTS`, which is what makes `npm run db:migrate`
--  safe to re-run -- but it also means a table that already exists is left
--  exactly as it was. So anything added to a table after its first release has to
--  be applied here as well, or only brand-new databases would get it and
--  `npm run db:reset` (which destroys the demo data) would be the only upgrade
--  path.
--
--  MySQL 8 has no `ADD COLUMN IF NOT EXISTS`, hence the PREPARE dance: build the
--  ALTER only when information_schema says it is missing, otherwise run `DO 0`,
--  which is a valid statement that does nothing.
-- ---------------------------------------------------------------------------

-- Phase 8: delivery bookkeeping on `notifications`.
SET @needs_attempts := (
  SELECT COUNT(*) = 0
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'notifications'
     AND COLUMN_NAME  = 'attempts'
);
SET @sql := IF(@needs_attempts,
  'ALTER TABLE notifications
     ADD COLUMN attempts        TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER status,
     ADD COLUMN last_attempt_at DATETIME                  DEFAULT NULL AFTER attempts',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Phase 8: index for the dispatch queue lookup.
SET @needs_queue_idx := (
  SELECT COUNT(*) = 0
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'notifications'
     AND INDEX_NAME   = 'idx_notifications_queue'
);
SET @sql := IF(@needs_queue_idx,
  'ALTER TABLE notifications
     ADD INDEX idx_notifications_queue (status, channel, notify_date)',
  'DO 0');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
