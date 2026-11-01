# AI-Powered Smart Kitchen Management, Expiry Monitoring and Recipe Recommendation System

A full-stack + IoT system for reducing household food waste. It tracks a home's
food inventory, sends a WhatsApp alert before items expire, and suggests recipes
built around whatever is about to go bad.

VTU / SECAB Institute of Engineering and Technology — B.E. ECE, Project Work
Phase II (2026–2027).

📋 **Requirements source of truth: [docs/requirements.md](docs/requirements.md)** —
the objectives, methodology, block diagram and constraints extracted from the
client PPT. It also documents an **open hardware conflict** (ESP32-CAM vs
ESP32 + OLED) that must be confirmed with the guide before Phase 10.

## Tech Stack

| Layer | Tech |
|---|---|
| Backend | Node.js + Express 5 (ESM) |
| Database | MySQL 8 (`mysql2/promise` connection pool) |
| Auth | JWT (httpOnly cookie) + bcrypt + rate limiting |
| Frontend | React 19 + Vite (responsive, mobile-first) |
| Alerts | Meta WhatsApp Cloud API |
| Recipes | Spoonacular API *(Phase 9)* |
| Hardware | ESP32-CAM + OCR/AI detection *(Phase 10)* |

## Folder Structure

```
smart-food-inventory/
├── backend/
│   ├── server.js                  # entry point: listen + graceful shutdown
│   ├── .env                       # real secrets (git-ignored)
│   ├── .env.example               # template -- commit this one
│   ├── src/
│   │   ├── app.js                 # express app: middleware + route mounting
│   │   ├── config/
│   │   │   ├── env.js             # all process.env access lives here
│   │   │   └── db.js              # connection pool, query(), transaction()
│   │   ├── routes/                # HTTP layer -- paths only
│   │   ├── controllers/           # request/response handling
│   │   ├── models/                # data access -- the only place SQL is written
│   │   ├── services/              # expirySweep.js -- the Phase 7 business logic
│   │   ├── jobs/                  # scheduler.js (cron) + runSweep.js (one-shot CLI)
│   │   ├── middleware/            # errorHandler, requireAuth
│   │   ├── utils/                 # apiError, jwt, validate
│   │   └── db/
│   │       ├── schema.sql         # all tables + the status view
│   │       └── migrate.js         # migration runner
│   └── tests/
│       ├── phase5-e2e.mjs         # food inventory API tests
│       ├── phase7-e2e.mjs         # expiry sweep + notification tests
│       └── cleanup-test-users.mjs # removes the throwaway accounts the suites make
├── frontend/
│   ├── vite.config.js             # dev server + /api proxy
│   ├── .env.example               # VITE_API_BASE (public -- no secrets!)
│   └── src/
│       ├── main.jsx               # providers: Router > Toast > Auth
│       ├── App.jsx                # route table
│       ├── api/                   # fetch wrapper + endpoint functions
│       ├── context/               # AuthContext, ToastContext
│       ├── components/            # Layout, guards, form, card, modal, ...
│       ├── pages/                 # Login, Signup, Dashboard, Inventory, Alerts, Profile
│       ├── utils/date.js          # date + expiry phrasing helpers
│       └── index.css              # one stylesheet, CSS variables
├── esp32-cam/                     # Arduino sketch     (Phase 10)
└── docs/
    ├── requirements.md            # client PPT -> objectives, methodology, constraints
    ├── client-ppt-extract.md      # raw text dump of the PPT
    └── ppt-images/                # block diagram, flow chart, etc.
```

## Setup

### 1. Requirements

- Node.js 20+ (currently using v24)
- MySQL 8

### 2. Configure

```bash
cd backend
cp .env.example .env
```

Put your own MySQL root password into `DB_PASSWORD` in `.env`.

To generate a fresh `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### 3. Install & migrate

```bash
npm install
npm run db:migrate
```

`db:migrate` creates the database (if it does not exist) and applies
`schema.sql`. Both steps are idempotent — running them again breaks nothing.

To wipe everything and rebuild from scratch: `npm run db:reset` (it asks for
confirmation).

### 4. Run

Two terminals — the backend API and the frontend dev server.

```bash
cd backend && npm run dev
```

```bash
cd frontend && npm install && npm run dev
```

| | URL |
|---|---|
| API | http://localhost:5000 |
| App | http://localhost:5173 |

`npm run dev` in `backend/` uses `node --watch`, so the server restarts on save.
For production the backend runs with `npm start`.

Either way the daily expiry sweep starts with the server — see
[Expiry Monitoring & Alerts](#expiry-monitoring--alerts-phase-7).

## Frontend (Phase 6)

React 19 + Vite. A single responsive web app — no separate mobile app. The
block diagram's "Mobile App (User Access)" box is satisfied by this app being
usable on a phone browser, which is also what the objectives ask for
("accessible via mobile app or web dashboard").

### Pages

| Route | Page | Access |
|---|---|---|
| `/login` | Sign in | Signed-out only |
| `/signup` | Create account | Signed-out only |
| `/` | Dashboard — counts + the items that need attention | Protected |
| `/inventory` | Full list, filters, search, add / edit / use / delete | Protected |
| `/alerts` | Alert history by day, delivery status, "Check now" + "Send queued" + per-row "Retry" | Protected |
| `/profile` | Name, WhatsApp number, alert opt-in, logout | Protected |
| anything else | 404 | Public |

### Design system

One stylesheet, `src/index.css`, driven by CSS custom properties — there is no UI
framework and no CSS-in-JS. Everything below is defined once at `:root`:

| Token group | Notes |
|---|---|
| Type | Plus Jakarta Sans for headings, Inter for UI |
| Colour | Emerald = brand and fresh, amber = near expiry, rose = expired. The same three carry the badges, the stat tiles and the donut, so a colour never means two things |
| Radii / shadow | `--r-xs` … `--r-xl`, two-layer shadows `--sh-xs` … `--sh-lg` |
| Motion | One easing curve, `--ease` |

**Two shells, one nav list.** At `≥ 1024px` a fixed dark sidebar; below that a
sticky top bar plus a bottom tab bar, which is where a thumb actually reaches.
`Layout.jsx` renders the same `NAV` array twice and lets CSS decide which is
visible — so nothing re-renders on resize and the right shell is painted on the
first frame.

Other deliberate choices:

- **Icons are hand-rolled SVG** (`Icon.jsx`, 30 glyphs on a 24×24 grid), not
  emoji. Emoji render as a different picture on every platform and as a box on
  some projectors, and they cannot inherit `currentColor`.
- **The donut is ~40 lines of SVG**, not a charting library — one `stroke-dasharray`
  per segment. Its colours are the CSS tokens, so the ring and the badges move
  together. The SVG is `aria-hidden`; the legend beside it carries the same
  numbers as text, and is what a screen reader reads.
- **Skeletons, not spinners, for first load.** A block in the shape of the
  incoming layout says what is coming and stops the page jumping when it lands.
- **`.notice*` for UI banners, `.alert-*` for the domain object.** "Alert" already
  means an expiry alert in this project, so the banner classes were renamed rather
  than left ambiguous.
- Inputs are exactly `16px` — anything smaller makes iOS Safari zoom on focus.
- `@media (prefers-reduced-motion: reduce)` disables every transition and the
  skeleton shimmer.

### Commands

```bash
npm run dev       # dev server on :5173, hot reload
npm run dev:https # same dev server over a self-signed HTTPS cert
npm run build     # production bundle into dist/
npm run preview   # serve the built bundle locally
npm run lint      # oxlint
```

`dev:https` exists because a phone or tablet on the same Wi-Fi is a
non-localhost origin, which browsers treat as insecure -- use it when you need
to test the camera capture or other secure-context behaviour from another
device. The first visit shows a self-signed-certificate warning; that is
expected for development. Production HTTPS comes from the hosting platform.

### How it talks to the API

In development, Vite proxies `/api` to `http://localhost:5000` (see
`vite.config.js`). The browser therefore stays on **one origin** and CORS cannot
break development — the most common "it worked yesterday" failure in a split
frontend/backend setup.

For a deployed build, set `VITE_API_BASE` to the real API URL. Note that every
`VITE_*` variable is inlined into the JavaScript bundle and is therefore
**public** — never put a secret in `frontend/.env`.

### Frontend design notes

- **Validation is not duplicated.** There are no client-side rules. The form
  submits, and if the server answers 400 the `details` map is dropped straight
  onto the fields — so every field error appears at once, and the rules live in
  exactly one place, where they cannot be bypassed.
- **A refresh never flashes the login page.** `AuthContext` starts in a
  `bootstrapping` state and calls `GET /auth/me` on mount. Route guards render a
  spinner until that finishes, so reloading `/inventory` while signed in shows
  `/inventory`.
- **The JWT lives in an httpOnly cookie** (`sfi_token`). This prevents XSS
  attacks from reading the token, as JavaScript cannot access httpOnly cookies.
  The cookie is automatically sent with every request via `credentials: 'include'`.
- **A 401 means "session expired" — except at the entry points.** The API client
  clears the token on any 401, but skips that for `/auth/login` and
  `/auth/signup`. Otherwise a wrong password would be reported to the user as a
  lost session.
- **Guards are layout routes**, not per-page wrappers — the same shape as the
  backend's `router.use(requireAuth)`. A new page added inside the protected
  group is protected by default; nobody has to remember to wrap it.
- **Search is debounced (300 ms) and guarded by a request id.** Typing "milk"
  fires one request, not four, and a slow earlier response cannot overwrite a
  newer one.
- **Two date formatters, on purpose.** `formatDate` works on the plain
  `'YYYY-MM-DD'` strings the API sends using pure string operations, never a
  `Date` round trip — that round trip is what shifts an expiry date by a day in
  some timezones. `formatTimestamp` (and `formatClockTime`, used on the alerts
  page) are for `created_at` / `sent_at`, which *are* real instants, so
  converting them to the reader's local clock is correct there.
- **Status is never computed in the browser.** `expiryStatus` and `daysLeft`
  come from the API; the frontend only phrases them ("Expires tomorrow",
  "2 days left"). One source of truth for the 3-day threshold.

## API

### Health

| Endpoint | What it tells you |
|---|---|
| `GET /api/health` | Is the server alive? (does not touch MySQL) |
| `GET /api/health/db` | Is MySQL reachable? Which tables exist? |

When `/api/health/db` fails it returns a `hint` alongside the error — e.g. the
service is stopped, the password is wrong, or the migration has not been run
yet.

### Auth (Phase 4 + Phase 11 hardening)

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/auth/signup` | — | `{ name, email, password, phone? }` → `{ user }` + httpOnly cookie |
| `POST` | `/api/auth/login` | — | `{ email, password }` → `{ user }` + httpOnly cookie |
| `POST` | `/api/auth/logout` | Cookie | Clear the JWT cookie |
| `GET` | `/api/auth/me` | Cookie | Current user |
| `PATCH` | `/api/auth/me` | Cookie | `{ name?, phone?, whatsappOptIn? }` — for the Phase 8 WhatsApp number |

**Rate limiting:** Auth endpoints are rate-limited to 10 requests per 15 minutes
per IP to prevent brute-force attacks.

**JWT storage:** Token is stored in an httpOnly cookie (`sfi_token`), not in
`localStorage`. This prevents XSS attacks from stealing the token. The cookie
is automatically sent with every request via `credentials: 'include'`.

When validation fails, the 400 carries **all** field errors at once, so the
React form can highlight every bad field in one pass:

```json
{
  "ok": false,
  "error": "Validation failed",
  "details": {
    "email": "Enter a valid email address",
    "password": "Password must be at least 8 characters"
  }
}
```

**Auth design notes:**

- Passwords are hashed with bcrypt cost **12**. Anything longer than 72
  characters is rejected — bcrypt silently ignores the rest, which amounts to
  truncating the password without telling anyone.
- Login returns the **same message for a wrong email and a wrong password**
  (`Invalid email or password`), and runs the bcrypt compare in both cases.
  Otherwise the endpoint would reveal which addresses are registered.
- The JWT payload holds only the user id. Name / email / phone are kept out of
  the token because they can change, and a 7-day-old copy would be wrong. Every
  request loads the user **fresh from the database**, which also means a deleted
  account is blocked immediately.
- **httpOnly cookie** instead of localStorage: The JWT is stored in an httpOnly
  cookie (`sfi_token`) which JavaScript cannot read, preventing XSS attacks
  from stealing the token. The cookie has `SameSite=Lax` for CSRF protection
  and `Secure=true` in production.
- **Rate limiting**: Auth endpoints (login, signup) are limited to 10 requests
  per 15 minutes per IP address to prevent brute-force attacks.

### Food Inventory (Phase 5)

All routes require login. Bodies and query strings are **camelCase**, the
database is snake_case — the translation happens in the model layer.

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/food-items` | Add a new item |
| `GET` | `/api/food-items` | List — sorted by expiry, with status |
| `GET` | `/api/food-items/summary` | Dashboard counts |
| `GET` | `/api/food-items/:id` | One item |
| `PATCH` | `/api/food-items/:id` | Edit |
| `POST` | `/api/food-items/:id/consume` | Mark as used |
| `DELETE` | `/api/food-items/:id` | Delete |

**Fields when adding** — only `name` and `expiryDate` are required:

```json
{
  "name": "Milk",
  "category": "Dairy",
  "quantity": 1.5,
  "unit": "litre",
  "purchaseDate": "2026-08-22",
  "expiryDate": "2026-08-25",
  "notes": "kept in the fridge door"
}
```

Every item comes back with a **live calculated** status:

```json
{
  "ok": true,
  "item": {
    "id": 1, "name": "Milk", "quantity": 1.5, "unit": "litre",
    "expiryDate": "2026-08-25",
    "daysLeft": 3,
    "expiryStatus": "NEAR_EXPIRY",
    "isConsumed": false
  }
}
```

**List filters** (all optional, and combinable):

| Query | Purpose |
|---|---|
| `?status=FRESH\|NEAR_EXPIRY\|EXPIRED` | Filter by status |
| `?category=Dairy` | Filter by category |
| `?q=mil` | Search the name |
| `?includeConsumed=true` | Also show used items (default: no) |
| `?limit=50&offset=0` | Pagination (limit max 500) |

**`GET /api/food-items/summary`** feeds the dashboard badges:

```json
{
  "ok": true,
  "summary": {
    "fresh": 8, "nearExpiry": 3, "expired": 1,
    "totalActive": 12, "consumed": 5,
    "needsAttention": 4,
    "categories": ["Bakery", "Dairy", "Grains"]
  }
}
```

All three status keys are **always** present (as `0` if empty), so React never
has to check whether `summary.expired` exists before reading it.

**Inventory design notes:**

- Marking an item as used **does not delete the row** — it sets
  `is_consumed = 1`. The item drops out of expiry alerts while the consumption
  history is preserved (Methodology step 11). An accidental tap is undone by
  sending `{ "consumed": false }`.
- Asking for another user's item returns **404, not 403**. A 403 would mean
  "this id exists, it just isn't yours" — that is a leak too.
- **Every** query in the model filters on `user_id`, including `findById` and
  `DELETE`. And `requireAuth` is applied to the whole router with
  `router.use()` rather than per route, so forgetting a line while adding an
  endpoint cannot leave it open.
- `PATCH` takes its column names from a **fixed map**, never from the request
  body — the client cannot choose which column to set. Sending
  `{ "userId": 999 }` therefore does not change an item's owner.
- Date validation goes through `Date.UTC`. `new Date('2026-08-25')` can shift in
  the local timezone — and an expiry date off by one day is precisely the bug
  that would make the whole project wrong.

### Expiry Monitoring & Alerts (Phase 7)

Every day the server sweeps the inventory, works out what is near expiry or
recently expired, and writes one row per item into `notifications`.

**The sweep writes rows; it does not send anything.** Delivery is Phase 8's
WhatsApp dispatch worker, which picks up the rows sitting at `status = 'pending'` and
`channel = 'whatsapp'`. Splitting it this way means the sweep needs no network
access at all, and a Meta Cloud API outage loses no alerts — they stay queued.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/notifications` | Alert history, newest first |
| `GET` | `/api/notifications/summary` | Counts by delivery status + the schedule |
| `POST` | `/api/notifications/check` | Run the sweep for **your own** kitchen now |
| `POST` | `/api/notifications/send` | Flush **your own** WhatsApp queue now *(Phase 8)* |
| `POST` | `/api/notifications/:id/retry` | Requeue one failed alert and send it *(Phase 8)* |

**List filters:**

| Query | Purpose |
|---|---|
| `?type=near_expiry\|expired` | Filter by alert type |
| `?status=pending\|sent\|failed` | Filter by delivery status |
| `?date=2026-08-22` | Only the alerts raised on that day |
| `?limit=50&offset=0` | Pagination (limit max 200) |

A notification looks like this:

```json
{
  "id": 12,
  "foodItemId": 4,
  "foodItemName": "Amul Milk",
  "channel": "whatsapp",
  "type": "near_expiry",
  "message": "Amul Milk (2 litre) expires tomorrow",
  "status": "pending",
  "notifyDate": "2026-08-22",
  "sentAt": null
}
```

**Running the sweep.** Three ways in, all doing the same thing:

| How | When to use it |
|---|---|
| In-process cron | Default. Runs inside `npm run dev` / `npm start` at 08:00 |
| `npm run sweep` | One-shot CLI, for Windows Task Scheduler or `cron` |
| `POST /api/notifications/check` | On demand, one user — what the "Check now" button calls |

Configured in `backend/.env` (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `EXPIRY_SWEEP_ENABLED` | `true` | Set `false` when the OS scheduler runs `npm run sweep` instead |
| `EXPIRY_SWEEP_CRON` | `0 8 * * *` | Standard 5-field cron |
| `EXPIRY_SWEEP_TZ` | `Asia/Kolkata` | **Must match MySQL's timezone** |
| `EXPIRY_SWEEP_ON_BOOT` | `true` | Also sweep ~2 s after start, covering "the server was off at 08:00" |
| `EXPIRY_ALERT_GRACE_DAYS` | `7` | How long to keep reminding about an already-expired item |

**Alert design notes:**

- **The sweep is idempotent.** Running it three times in one day produces the
  alerts once. `notifications` carries `UNIQUE (food_item_id, type, notify_date)`,
  and the selection query filters out anything already alerted today with a
  `NOT EXISTS` — so the reported `created` count is honest instead of being a
  swallowed insert error. This is what makes it safe to have cron, the boot
  sweep, and the button all pointing at the same code.
- **No second source of truth for the 3-day threshold.** The sweep reads
  `expiry_status` from `v_food_items_status` rather than re-deciding what "near
  expiry" means. `EXPIRY_ALERT_GRACE_DAYS` is genuinely new — the view has no
  opinion on how many days to keep nagging about food that already expired.
- **"Today" always comes from MySQL, never from Node.** Every date in the sweep
  is `CURDATE()`, read back out of the same statement that classified the item.
  If the Node process and MySQL disagreed about the timezone, a `notify_date` and
  an `expiry_status` from separate clocks could straddle midnight.
- **Users with no number still get a row**, marked `channel = 'in_app'` and
  written as already `sent`. Being in the list *is* the delivery for those, and
  leaving them `pending` forever would make the pending queue useless as a
  measure of what is actually waiting on Meta's Cloud API.
- **The manual trigger only sweeps the caller.** `runExpirySweep({ userId })`
  takes the id from `req.user`, never the request body, so no admin role is
  needed and one user cannot raise alerts in someone else's kitchen.
- **A crashed sweep never takes the API down.** The scheduler wraps each run in
  its own try/catch, and it is only started after a confirmed database ping.
- **History outlives the food item.** `fk_notifications_food_item` is
  `ON DELETE SET NULL` and the list query uses a `LEFT JOIN`, so deleting an item
  leaves its past alerts readable (`foodItemName` becomes `null`).

### WhatsApp Delivery (Phase 8)

The sweep queues; this sends. A second daily job wakes at 08:05, five minutes
after the sweep, picks up every row at `status = 'pending'` and
`channel = 'whatsapp'`, and hands it to Meta's Cloud API.

**One message per user, not per item.** The queue holds a row per item — that is
what makes `UNIQUE (food_item_id, type, notify_date)` able to stop duplicates —
but the worker groups a batch by user and sends a single WhatsApp message
listing everything, then stamps the same provider SID on every row it covered.
Four expiring items produce one notification on the phone, not four.

| How | When to use it |
|---|---|
| In-process cron | Default. Runs inside `npm run dev` / `npm start` at 08:05 |
| `npm run dispatch` | One-shot CLI, for Windows Task Scheduler or `cron` |
| `POST /api/notifications/send` | On demand, one user — what the "Send queued" button calls |

Configured in `backend/.env` (see `.env.example`). **Every variable has a
working default, so the app runs untouched** — see dry run below:

| Variable | Default | Purpose |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | *(empty)* | From the Meta developer app's WhatsApp panel |
| `WHATSAPP_ACCESS_TOKEN` | *(empty)* | From the Meta developer app — **never commit this** |
| `WHATSAPP_API_VERSION` | `v21.0` | Pinned Cloud API version |
| `WHATSAPP_DISPATCH_ENABLED` | `true` | Set `false` when the OS scheduler runs `npm run dispatch` instead |
| `WHATSAPP_DISPATCH_CRON` | `5 8 * * *` | Five minutes after the sweep |
| `WHATSAPP_MAX_ATTEMPTS` | `3` | Tries before a transient failure is given up on |
| `WHATSAPP_STALE_AFTER_DAYS` | `2` | Older than this and the alert is failed rather than delivered late |
| `WHATSAPP_BATCH_SIZE` | `50` | Rows per run |
| `WHATSAPP_PAUSE_MS` | `250` | Gap between sends, to stay under the provider's rate limit |

**Delivery design notes:**

- **No credentials means dry run, not a crash.** With `WHATSAPP_ACCESS_TOKEN` empty
  the worker runs end to end and records the outcome with a fake SID prefixed
  `dryrun-`. Every code path except the HTTP call is exercised, so the feature is
  demonstrable and testable without a Meta app. `GET /summary` returns
  `delivery.dryRun: true`, and the alerts page says so on screen — otherwise
  "sent" would read as a message that reached a phone when none left the server.
- **Permanent failures are not retried.** Meta's error code decides:
  `131047` (outside WhatsApp's 24-hour window), `131026` (bad number) and friends
  are permanent, so the row goes straight to `failed`. A timeout or a 5xx is
  transient and stays `pending` until `WHATSAPP_MAX_ATTEMPTS`. Retrying a
  permanent failure 3 times only delays the honest answer.
- **Native `fetch`, not an SDK.** The Cloud API is one JSON POST with a bearer token, so the honest version is shorter than any wrapper. Meta's error code is exactly what the permanent /
  transient decision above needs.
- **Phone numbers never reach a log file.** The dispatch result's `errors` array
  carries `{ userId, error, permanent }` and nothing else.
- **A stale alert is failed, not delivered late.** Anything older than
  `WHATSAPP_STALE_AFTER_DAYS` is retired at the start of each run, so the
  "Queued" figure on screen counts messages that are genuinely still going out.
- **The `whatsapp:` prefix is added at send time**, not stored. `users.phone`
  stays a plain number the profile screen can display as-is.
- **Manual retry gets a fresh budget.** `requeue` resets `attempts` to 0, because
  the user pressing Retry has usually just fixed the cause — re-engaged the chat,
  corrected the number — and the old attempt count is no longer evidence of
  anything.
- **`/retry` cannot be used to probe for other people's alerts.** The requeue is
  scoped by `user_id`, so an id belonging to someone else returns the same 404 as
  an id that does not exist.

### Tests

With the server running, in a second terminal:

```bash
npm run test:e2e
```

**223 checks across three suites:**

| Suite | Checks | Covers |
|---|---|---|
| `test:e2e:phase5` | 67 | CRUD, validation, filters, summary, consume / un-consume, cross-user isolation |
| `test:e2e:phase7` | 71 | Which items alert, message wording, idempotency, channel routing, filters, isolation, history after deletion |
| `test:e2e:phase8` | 85 | Grouping one message per user, opt-in / opt-out / no-phone routing, dry-run SIDs, permanent vs transient failure, retry, stale expiry, cross-user isolation on `/retry` |

Both create their own throwaway users and delete their own items, so they are
safe to run repeatedly. The accounts themselves stay behind (there is no
delete-account endpoint) — clear them out with `npm run test:cleanup`.

**Showing the Phase 8 buttons.** Once everything has been sent, "Send queued" and
the per-row "Retry" correctly hide themselves — which makes them impossible to
demonstrate. `npm run demo:phase8` puts one queued and one failed alert on the
demo account so both appear; `npm run demo:phase8:undo` removes them again.

## Database Notes

### Expiry status is not stored

There is **deliberately no `status` column** on `food_items`. A stored status
becomes wrong at midnight. The `v_food_items_status` view is used instead, which
calculates `days_left` and `expiry_status` (`FRESH` / `NEAR_EXPIRY` / `EXPIRED`)
live:

```sql
SELECT * FROM v_food_items_status
 WHERE user_id = ? AND is_consumed = 0
 ORDER BY expiry_date;
```

The "near expiry" threshold (**3 days**) is defined in exactly one place — the
view in `schema.sql`. Change it there and the dashboard badge, the frontend
wording and the WhatsApp alert all follow automatically.

### Guarding against duplicate alerts

`notifications` carries `UNIQUE (food_item_id, type, notify_date)`. That stops
the daily sweep from raising two alerts for the same item on the same day, even
if the server restarts and sweeps again on boot. The insert uses
`ON DUPLICATE KEY UPDATE id = id` — a deliberate no-op, rather than
`INSERT IGNORE`, which would also hide a bad foreign key or a truncated column.
Because the update changes nothing, MySQL reports 0 affected rows for a
collision, so `affectedRows` is exactly the number of alerts actually created.

## Roadmap

- [x] **Phase 1** -- Setup (Node, MySQL, VS Code, Git)
- [x] **Phase 2** -- Express server + MySQL connection
- [x] **Phase 3** -- Database tables
- [x] **Phase 4** -- Auth (signup/login, JWT)
- [x] **Phase 5** -- Food inventory CRUD API
- [x] **Phase 6** -- React frontend (login, dashboard, inventory, profile) — responsive, mobile-friendly
- [x] **Phase 7** -- Expiry classification + daily sweep + alert history
- [x] **Phase 8** -- WhatsApp alerts (Meta Cloud API) — grouped daily message, retry, dry-run mode
- [x] **Phase 9** -- Recipe recommendation (expiry-priority matching)
- [x] **Phase 10** -- Image capture + backend AI/OCR detection (ESP32-CAM or browser webcam)
- [x] **Phase 11** -- Security hardening (rate limiting + httpOnly cookie JWT)

**Phase 10 completed:** Photo upload (shared-key `x-device-key` gate for the
ESP32-CAM, login session for the browser's own webcam -- the shared key is
deliberately never handed to JavaScript), Gemini free-tier recognition with
graceful no-key fallback, a `device_detections` queue, and a human **review
step** on the Inventory page -- a photo never becomes an inventory row until
someone approves it through the same `validateFoodItem` rules a typed entry
goes through. Both entrances converge on one `fileCapture`, so a photo cannot
be told apart afterwards by where it came from. Sketch + wiring guide live in
[esp32-cam/README.md](esp32-cam/README.md); without hardware, use the
**Scan with camera** button on Inventory.

**Phase 11 completed:** Rate limiting on auth endpoints (`express-rate-limit`),
and JWT moved from `localStorage` to httpOnly cookie for XSS protection.

The app ships Dashboard, Inventory (including the camera review queue), Alerts,
Recipes and Profile.

See [docs/requirements.md](docs/requirements.md) for the phase-by-phase
requirements and how each maps onto a PPT objective.
