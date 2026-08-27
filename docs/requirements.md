# Requirements — from the client PPT

Source: `Abstract (1).pptx` (15 slides). Raw text dump: [client-ppt-extract.md](client-ppt-extract.md).
Diagram slides (10–14 are images, not text): [ppt-images/](ppt-images/).

## Project identity

| | |
|---|---|
| **Official title** | AI-Powered Smart Kitchen Management, Expiry Monitoring and Recipe Recommendation System |
| University | Visvesvaraya Technological University, Belagavi-590018 |
| College | SECAB Institute of Engineering and Technology, Vijayapur-586109 |
| Branch | **B.E. Electronics and Communication Engineering** |
| Stage | Project Work — **Phase II**, Progress Review |
| Academic year | 2026–2027 |
| Guide | Mrs. Uzma Satteekar |
| Team | Noorain Kaladgi (2SA23EC038) · Aimanpari Kaladgi (2SA23EC004) · Nimra Fatima Hattarhikal (2SA23EC036) · Bibi Khuteja Mulla (2SA23EC014) |

This is an **ECE** project, not CSE — the hardware component carries evaluation
weight, so it cannot be quietly dropped.

---

## ⚠️ Resolved conflict: ESP32-CAM vs ESP32 + OLED

**DECISION (2026-08-22): Branch A — ESP32-CAM as image INPUT.** Phase 10 builds
camera capture → backend AI/OCR → validation. No OLED display.

> **⚠️ Action item for the team:** slides **7 (Problem Statement)** and
> **8 (Objective 06)** currently say *"optional ESP32-based OLED display"* and
> make manual entry the only input. A VTU panel evaluates against those two
> slides. **Update both to state ESP32-CAM image capture** before the review, or
> the demo will not match the stated objectives.

The conflict as it stands in the PPT, for reference:

**Branch A — camera as INPUT (ESP32-CAM) ← CHOSEN:**

| Slide | Wording |
|---|---|
| 2 Abstract | "Using **ESP32-CAM**, AI/OCR, and manual entry" |
| 9 + 10 Methodology | Steps 1–3: ESP32-CAM captures images → AI/OCR detects food + expiry → validation |
| 11 Block diagram | Camera Module → Image Processing → AI Model (Food Recognition) → Identified Item (Name & Category) |
| 13 Advantages | "Built on the affordable **ESP32-CAM** module" · "Image-based registration significantly minimizes the user input" |
| 14 Limitations | "**ESP32-CAM** has limited computational resources, necessitating **backend offloading** for AI processing" |

**Branch B — display as OUTPUT (ESP32 + OLED), manual entry as the only input:**

| Slide | Wording |
|---|---|
| 3 Introduction | "Many smart-kitchen solutions rely on cameras, OCR or special hardware — adding complexity and cost. **Our project adopts a simpler path: manual inventory entry**" |
| 6 Gap analysis | "Complex smart-kitchen architectures require specialized hardware/software; costly and impractical for student projects" → "Final research gap: … combining **manual inventory**, expiry-priority management, and recipe recommendation" |
| 7 Problem statement | "allows users to **manually** maintain their food inventory … notifications through WhatsApp and an **optional ESP32-based OLED display**" |
| 8 Objective 06 | "Send alerts via WhatsApp; provide **optional ESP32+OLED local display**" |

**Why this matters:** the **Problem Statement (7)** and **Objectives (8)** are what a
VTU review panel evaluates against, and both of those say *manual entry +
optional OLED display*. The Abstract, Methodology and Advantages slides say
*ESP32-CAM with AI/OCR*.

Phases 4–9 are identical under either branch, so this never blocked backend work.

---

## Objectives (slide 8) — the contract

| # | Objective | Roadmap phase | Status |
|---|---|---|---|
| 01 | Website for manual food entry, viewing and recipe display | 5, 6, 9 | **entry + viewing done** (API Phase 5, UI Phase 6); recipe display pending (Phase 9) |
| 02 | User input of **name, quantity, expiry date** per item | 5 | **done** |
| 03 | Store **users, food items, recipes, notifications** in MySQL | 3 | **done** |
| 04 | Classify items as **Fresh / Near Expiry / Expired** by remaining days | 7 | **done** (view on every item response + daily sweep + Alerts page) |
| 05 | **Prioritise items approaching expiry** when ranking recipes | 9 | pending |
| 06 | Alerts via **WhatsApp**; optional **ESP32+OLED** local display | 8, 10 | **WhatsApp half done** (Phase 8 — queued, grouped, sent, retried). The OLED half is not being built; see the ESP32 note below |
| 07 | Low-cost, simple, extensible | all | — |

Objective 03 names exactly the four tables already in
[schema.sql](../backend/src/db/schema.sql). Objective 04 is exactly what
`v_food_items_status` computes — and since Phase 5 reads every item through that
view, `expiryStatus` and `daysLeft` shipped on every API response ahead of
Phase 7. What Phase 7 added on top is the part the objective implies but does not
spell out: a **scheduled daily sweep** that turns the classification into a dated
alert record, and an **Alerts page** where the user can see it. So 04 is now
complete in both senses — the classification is computed, and something acts on it
without the user asking.

Objective 06 is deliberately split across two phases. Phase 7 writes the
notification rows and decides each one's channel (`whatsapp` when the user has a
number *and* has opted in, otherwise `in_app`); Phase 8 adds the WhatsApp dispatch worker
that drains the `whatsapp` queue. The reason for the split is in
[README → design notes](../README.md#expiry-monitoring--alerts-phase-7): a sweep
that never touches the network cannot lose an alert to a provider outage.

**Phase 8 closes the WhatsApp half.** A second daily job sends the queue, one
grouped message per user rather than one per item, and the Alerts page exposes it
as "Send queued" plus a per-row "Retry" for anything the provider refused. With no
Meta Cloud API credentials configured the worker runs in **dry run** — every code path
except the HTTP call is exercised and the outcome is recorded with a `dryrun-`
SID — so the objective is demonstrable at the review without a paid account, and
the UI states on screen that sends are simulated. See
[README → WhatsApp Delivery](../README.md#whatsapp-delivery-phase-8).

What remains of 06 is the *optional* ESP32+OLED display, which this project is
deliberately not building — the ESP32-CAM is used as an **image input** for
Phase 10 instead. That is the discrepancy flagged at the top of this document:
slides 7 and 8 still describe the OLED.

---

## Methodology (slides 9 + 10) — 11 steps

1. **Image Capture** — ESP32-CAM captures food images
2. **AI/OCR Detection** — identifies food and expiry details
3. **Validation** — checks detected information ← *implies a user confirm/review step*
4. **Manual Entry** — used when detection fails or expiry is unavailable
5. **Digital Inventory** — stores food details in the database
6. **Expiry Monitoring** — calculates remaining days and status
7. **WhatsApp Alert** — notifies users about near-expiry items
8. **Recipe Search** — finds recipes using available ingredients
9. **Ingredient Matching** — matches inventory with recipe ingredients
10. **Expiry-Priority Recommendation** — prioritises recipes using near-expiry food
11. **Inventory Update** — updates inventory after consumption

Steps **4, 5, 6 and 11** are covered by the Phase 5 API: `POST /api/food-items`
(manual entry), the `food_items` table behind it (digital inventory),
`expiryStatus` / `daysLeft` on every response (expiry monitoring), and
`POST /api/food-items/:id/consume` (inventory update after consumption). Step 11
sets `is_consumed = 1` instead of deleting the row, so the item leaves the alert
pipeline but stays as consumption history.

As of Phase 6 those four steps also have a **user interface**: the Inventory page
covers manual entry and inventory update (add / edit / "Mark used" / restore),
and the Dashboard surfaces expiry monitoring as Fresh / Near expiry / Expired
counts plus a "Needs attention" list. Step 3 (**Validation**) is partly there
too — the add / edit form shows the server's per-field errors — but the
*detection* review it really refers to belongs to Phase 10.

Phase 7 finishes step **6**, and Phase 8 finishes step **7**:

| Step | State |
|---|---|
| 6 **Expiry Monitoring** — *"calculates remaining days and status"* | **complete** (Phase 7). `v_food_items_status` does the arithmetic; `services/expirySweep.js` runs it once a day for every user via `node-cron` and records what it found. Nothing depends on a page being open. |
| 7 **WhatsApp Alert** — *"notifies users about near-expiry items"* | **complete** (Phase 8). The sweep composes and queues; `services/whatsappDispatch.js` sends. Rows for opted-in users are grouped by user into a single daily WhatsApp message; everyone else's stay `in_app` and are visible immediately on `/alerts`. Failures are classified permanent or transient, retried accordingly, and retriable by hand from the page. Without Meta Cloud API credentials it runs in dry run, which is what makes the step demonstrable at the review. |

Step 6 is worth being precise about, because "calculates remaining days" reads
like it needs a background job and doesn't: the number comes from a SQL view on
every read, so it is never stale. The daily job exists for step 7 — someone has to
notice the item *before* the user opens the app.

## Block diagram (slide 11)

```
1. CAMERA INPUT
   Camera Module → Image Processing → AI Model → Identified Item
   (captures)     (pre-processing)   (food recog) (Name & Category)
                                                        │
2. MANUAL ENTRY                                         ▼
   User Manual Entry ──────────────►  Controller (Arduino UNO / ESP32)
   (add food items)                   (Data Processing & Control)
                                                │
                    ┌───────────────────────────┼───────────────────────┐
                    ▼                           ▼                       ▼
            Expiry Monitoring           Recipe Recommendation      Database
            (track expiry dates)        (AI-Based)                 (food, expiry, recipes)
                    │                           │                       │
                    ▼                           ▼                       ▼
            Alert System                Recommended Recipes         Cloud (sync & backup)
            (notify near expiry)        (display recipes)               │
                                                                        ▼
                                                                Web Application
                                                                        │
                                                                        ▼
                                                                   Mobile App
```

The left branch of the diagram — **Expiry Monitoring → Alert System (notify near
expiry)** — is live end to end as of Phase 8: Phase 7 monitors and queues, Phase 8
delivers. The middle branch (Recipe Recommendation) is Phase 9 and the camera input
at the top is Phase 10.

**Two things here are NOT in the current roadmap:**

- **Cloud (Data Sync & Backup)** — folds into Phase 11 (deployment)
- **Mobile App (User Access)** — **DECISION (2026-08-22): responsive web app**, not a
  native app. **Satisfied as of Phase 6**: the React frontend is mobile-first and
  was verified at 375×812 with no horizontal overflow, a single-column item list
  and the nav dropped onto its own header row, so "Web Application" and
  "Mobile App (User Access)" are the same build. No React Native.

Note the AI Model is labelled **Food Recognition (Name & Category)** — the item
*name* comes from image recognition, while the *expiry date* comes from OCR
(methodology step 2) or manual entry (step 4).

---

## Applications (slide 12)

Smart Kitchen Inventory · Expiry Monitoring · Food Waste Reduction · Smart Recipe
Recommendation · Expiry-Based Food Planning · Automated User Alerts · Household
Food Management · Future Smart-Kitchen Integration

## Advantages (slide 13)

Waste Reduction · Low-Cost Implementation (ESP32-CAM) · Remote Notifications
(WhatsApp, off-site awareness) · Automatic Monitoring (continuous background
tracking) · Sustainability Impact · Reduced Manual Effort (image-based registration)

## Limitations (slide 14) — architectural constraints

| Limitation | What it forces in the design |
|---|---|
| **OCR accuracy** depends on image quality, lighting, print clarity | Step 3 "Validation" must let the user correct a wrong reading before it is saved |
| **ESP32-CAM has limited compute** → "necessitating **backend offloading** for AI processing" | The device only uploads a JPEG; **all** recognition/OCR runs server-side. Confirms the `POST /api/device/upload` design. |
| **Connectivity dependency** — internet needed for cloud, OCR backend, recipe APIs | Cache recipe API responses (already why `recipes` table exists); handle API failure gracefully |

---

## Impact on the current schema

Already covered:

- `users`, `food_items`, `recipes`, `notifications` → Objective 03
- `v_food_items_status` (`days_left`, `FRESH`/`NEAR_EXPIRY`/`EXPIRED`) → Objective 04, methodology 6
- `notifications.notify_date` + `uq_notifications_dedupe (food_item_id, type,
  notify_date)` → methodology 7. The unique key is what makes the daily sweep
  safe to run twice; `notify_date` is the day the alert is *for*, not the row's
  creation timestamp.
- `notifications.channel` / `status` / `provider_sid` / `error_message` →
  Objective 06. Phase 7 fills the first two; Phase 8's dispatch worker fills the
  last two — `provider_sid` is the Meta Cloud API message id (or a `dryrun-` stand-in),
  and `error_message` is why the provider refused. `attempts` is what stops a
  permanently-rejected number being retried forever.
- `food_items.is_consumed` → methodology 11
- `food_items.source ENUM('manual','esp32cam')` → both input paths
- `food_items.image_url`, `category` → block diagram "Identified Item (Name & Category)"
- `recipes.ingredients` (JSON) → methodology 9 ingredient matching

Phase 7 needed **no migration**, and neither did Phase 8 — the Phase 3 schema
already had every column the sweep writes and every column the dispatch worker
updates. That was the point of designing `notifications` around a `notify_date`,
a dedupe key, and a delivery status before there was anything to write into it.

Still missing, needed for methodology step 3 (**Validation**) if Branch A is
confirmed — to be added in the Phase 10 migration, not now:

- `detection_confidence` — how sure the AI was
- `is_verified` — has a human confirmed the detected values?
- `raw_ocr_text` — what OCR actually read, for debugging bad reads

## Literature survey (slides 4, 5, 15)

Five papers, 2025–2026. Techniques referenced: hybrid recipe recommendation
(content-based + collaborative filtering, MiniLM embeddings, semantic ingredient
matching), YOLOv8 food detection, OCR expiry extraction, four-layer cloud-edge
architecture, RAG for leftover-based recipes.

Objective 05 only asks for **expiry-priority ranking**, not embeddings — so
straightforward ingredient overlap scoring weighted by `days_left` satisfies the
stated objective. The heavier ML from the papers is optional ambition, not a
requirement.
