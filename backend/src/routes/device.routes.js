import { Router } from 'express';
import express from 'express';

import { deviceAuth } from '../middleware/deviceAuth.js';
import { requireAuth } from '../middleware/auth.js';
import {
  uploadCapture,
  captureFromBrowser,
  listDetections,
  confirmDetection,
  discardDetection,
} from '../controllers/device.controller.js';

const router = Router();

// -- Device side (shared key) ------------------------------------------------

/**
 * The one endpoint the ESP32-CAM calls.
 *
 * `express.raw` parses the JPEG body here rather than globally -- app.js uses
 * `express.json` for the whole API, and a global raw parser would compete
 * with it for every request. Scoped to this route and to image content types,
 * a JSON body sent here simply parses to nothing and fails the Buffer check
 * with a 400 instead of half-succeeding.
 *
 * The 5 MB limit is above DEVICE_MAX_IMAGE_BYTES on purpose: the controller
 * gives a *specific* "too large" error, whereas body-parser would answer 413
 * before our own message could exist.
 */
router.post(
  '/upload',
  deviceAuth,
  express.raw({ type: ['image/jpeg', 'image/jpg', 'application/octet-stream'], limit: '5mb' }),
  uploadCapture
);

// -- User side (normal login) ------------------------------------------------

// Everything below needs a session. The device key can upload a photo; it
// must never be able to read one back or confirm it into the inventory.
router.use(requireAuth);

/**
 * The browser's own webcam, for when the ESP32-CAM is not on the desk.
 *
 * Deliberately *not* protected by deviceAuth: JavaScript cannot hold a secret
 * (it ships to whoever opens devtools), so this route trusts the session that
 * requireAuth has already verified and files the photo under that user.
 *
 * `express.raw` again, and for the same reason as /upload -- the browser sends
 * the canvas output as a flat `image/jpeg` body rather than multipart, so one
 * parser serves both entrances.
 */
router.post(
  '/capture',
  express.raw({ type: ['image/jpeg', 'image/jpg', 'application/octet-stream'], limit: '5mb' }),
  captureFromBrowser
);

router.get('/detections', listDetections);
router.post('/detections/:id/confirm', confirmDetection);
router.post('/detections/:id/discard', discardDetection);

export default router;
