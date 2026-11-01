import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { env } from '../config/env.js';
import { ApiError } from '../utils/apiError.js';
import { validateFoodItem, validateId } from '../utils/validate.js';
import * as FoodItem from '../models/foodItem.model.js';
import * as Detection from '../models/deviceDetection.model.js';
import { recognizeFood } from '../services/foodRecognition.js';

/**
 * ESP32-CAM integration (Phase 10).
 *
 * Methodology steps 1-3, split across three parties:
 *
 *   1. the device POSTs a JPEG to /upload (deviceAuth has already checked the
 *      shared key by the time any code here runs),
 *   2. Gemini proposes what it is and what the expiry date says,
 *   3. a human confirms or discards it on the Inventory screen, and only the
 *      confirm path -- through the same validateFoodItem rules as typed entry --
 *      ever writes to `food_items`.
 *
 * That last point is the whole design. A model that misreads "15/08" as an
 * expiry date can only ever produce a *suggestion*; the review gate is what
 * stops a wrong photo from silently becoming a wrong inventory row that a
 * WhatsApp alert later treats as fact.
 *
 * Fail-soft everywhere except validation: an unreadable image or a Gemini
 * outage leaves `detected_name` NULL and the row still exists, so the photo
 * reaches the reviewer with a blank form beside it rather than being lost.
 */

/**
 * Where photos live on disk.
 *
 * Resolved relative to this file, not `process.cwd()` -- `npm run dev` from
 * the repo root and `node server.js` from backend/ must land in the same
 * directory, or uploads would silently disappear between runs.
 */
const UPLOAD_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../',
  env.device.uploadDir
);

/** JPEG magic bytes -- cheaper and more honest than trusting a header. */
function isJpeg(buffer) {
  return (
    buffer.length > 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  );
}

/**
 * Reject anything that is not a storable photo.
 *
 * Shared by both entrances on purpose: a browser canvas and an ESP32-CAM are
 * held to exactly the same bar, so neither becomes the way a bad body reaches
 * the disk or the model.
 */
function assertUsableImage(image) {
  if (!Buffer.isBuffer(image) || image.length === 0) {
    throw ApiError.badRequest('Body must be raw JPEG bytes');
  }
  if (!isJpeg(image)) {
    throw ApiError.badRequest('Body does not look like a JPEG (missing SOI marker)');
  }
  if (image.length > env.device.maxImageBytes) {
    throw ApiError.badRequest(
      `Image too large (${image.length} bytes, max ${env.device.maxImageBytes})`
    );
  }
}

/**
 * Save the photo and file it for review.
 *
 * Everything that differs between the camera and the browser is decided
 * *before* this runs -- inside, they are one code path, so a fix to one is a
 * fix to the other and neither can drift into its own storage convention.
 */
async function fileCapture(userId, image) {
  // Recognition runs BEFORE the insert so one round trip produces a complete
  // row. It cannot throw (foodRecognition.js downgrades every failure), so
  // there is no path where the file is saved but the request dies.
  const recognition = await recognizeFood(image);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${stamp}-${crypto.randomBytes(4).toString('hex')}.jpg`;
  const absolute = path.join(UPLOAD_ROOT, filename);

  await fs.mkdir(UPLOAD_ROOT, { recursive: true });
  // Written before the row: a database row pointing at a missing file would
  // show a broken image in review forever, while a file with no row is just
  // an orphan the next cleanup could sweep.
  await fs.writeFile(absolute, image);

  const detection = await Detection.createForUser(userId, {
    // uploadDir is a path relative to the backend root, and app.js serves the
    // backend root's `uploads/` directory at /uploads -- so the URL is just
    // the configured relative path with forward slashes.
    imageUrl: `/${env.device.uploadDir.replace(/\\/g, '/').replace(/^\/+/, '')}/${filename}`,
    recognition,
  });

  return { detection, recognition };
}

/** Both entrances answer identically, so neither client needs two branches. */
function sendCapture(res, { detection, recognition }) {
  res.status(201).json({
    ok: true,
    // What the caller needs to know is only "stored". The recognition result
    // goes back too, so a serial monitor shows what the model saw without
    // opening the website.
    detection: Detection.toPublicDetection(detection),
    recognition: { detected: recognition.detected, provider: recognition.provider },
  });
}

/**
 * POST /api/device/upload
 *
 * Raw JPEG body (`Content-Type: image/jpeg`), not multipart. The ESP32's
 * HTTPClient can push bytes without a multipart encoder, and a parser that
 * does not exist cannot have a parser bug -- one less thing on a device that
 * cannot log a stack trace.
 */
export async function uploadCapture(req, res) {
  assertUsableImage(req.body);

  // Whose kitchen: the sketch sends nothing and gets the configured default.
  // A trusted device (the shared key already proved itself) MAY say explicitly
  // via `x-device-user` -- which is also what lets the e2e suite upload photos
  // under its throwaway users without editing .env mid-run. Not attacker-
  // controlled in any meaningful sense: possession of DEVICE_API_KEY already
  // grants upload rights, this only chooses which inbox it lands in.
  const explicitUser = Number(req.get('x-device-user'));
  const userId = Number.isInteger(explicitUser) && explicitUser > 0
    ? explicitUser
    : env.device.userId;

  if (!userId) {
    throw new ApiError(
      503,
      'DEVICE_USER_ID is not set -- the camera has no kitchen to file photos under'
    );
  }

  sendCapture(res, await fileCapture(userId, req.body));
}

/**
 * POST /api/device/capture -- the same photograph, taken by a person.
 *
 * For when the ESP32-CAM is not on the desk: the browser's own webcam posts
 * here instead. The split exists because the two cannot share a credential.
 * This route is gated by requireAuth and files the photo under `req.user.id`;
 * the device route is gated by DEVICE_API_KEY and files it under
 * DEVICE_USER_ID. Handing that shared key to JavaScript would publish it in
 * the shipped bundle for anyone to read, so the browser never sees it.
 *
 * Same validation, same bytes on disk, same review queue -- the only thing
 * that changes is where "whose kitchen" comes from, and here it comes from a
 * verified session rather than from .env.
 */
export async function captureFromBrowser(req, res) {
  assertUsableImage(req.body);
  sendCapture(res, await fileCapture(req.user.id, req.body));
}

/**
 * GET /api/device/detections
 *
 * The review queue: this user's pending photos, newest first. Requires a
 * normal login -- the shared device key must never be enough to read a
 * kitchen's contents.
 */
export async function listDetections(req, res) {
  const rows = await Detection.listPending(req.user.id);
  res.json({
    ok: true,
    count: rows.length,
    detections: rows.map(Detection.toPublicDetection),
  });
}

/**
 * POST /api/device/detections/:id/confirm
 *
 * Body is an ordinary food-item payload; the AI's proposal has already been
 * dropped into the form for the reviewer to correct. Going through
 * validateFoodItem here is the point of the design: a confirmed detection
 * and a typed entry are indistinguishable downstream, including the
 * purchase-before-expiry rule and the 150-char name limit.
 */
export async function confirmDetection(req, res) {
  const id = validateId(req.params.id);

  const detection = await Detection.findById(id, req.user.id);
  if (!detection) throw ApiError.notFound('Detection not found');
  if (detection.status !== 'pending') {
    throw ApiError.conflict(`Detection already ${detection.status}`);
  }

  const data = validateFoodItem({ ...req.body, source: 'esp32cam' });

  const item = await FoodItem.createFoodItem(req.user.id, data);

  // The status guard inside markConfirmed makes this atomic against a
  // double-click: if two confirms raced, the loser's UPDATE matched 0 rows.
  const won = await Detection.markConfirmed(id, req.user.id, item.id);
  if (!won) {
    // The row existed a moment ago (checked above) and now says otherwise --
    // another tab confirmed it. Undo the item rather than leave a duplicate.
    await FoodItem.deleteFoodItem(item.id, req.user.id);
    throw ApiError.conflict('Detection was already confirmed elsewhere');
  }

  res.status(201).json({
    ok: true,
    item: FoodItem.toPublicFoodItem(item),
    detectionId: id,
  });
}

/** POST /api/device/detections/:id/discard */
export async function discardDetection(req, res) {
  const id = validateId(req.params.id);

  const discarded = await Detection.markDiscarded(id, req.user.id);
  // 404 for both "not yours" and "never existed" (same reasoning as food
  // items), but a detection that exists and is merely no longer pending gets
  // its real state -- the user should learn *why* their tap did nothing.
  if (!discarded) {
    const existing = await Detection.findById(id, req.user.id);
    if (!existing) throw ApiError.notFound('Detection not found');
    throw ApiError.conflict(`Detection already ${existing.status}`);
  }

  res.json({ ok: true, discarded: id });
}
