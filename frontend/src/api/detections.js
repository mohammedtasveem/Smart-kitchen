import { api } from './client.js';

/**
 * Camera detection review endpoints (Phase 10).
 *
 * The ESP32-CAM's upload side is deliberately NOT here: it is a device with a
 * shared key, not the browser. These are the human-review half -- send a
 * photo in, list the queue, then confirm it into the inventory or throw it
 * away.
 */

/**
 * Send a photo taken by the browser's webcam through the same pipeline the
 * ESP32-CAM uses.
 *
 * Raw bytes, not FormData: the server parses `image/jpeg` with express.raw,
 * and multipart would need a body parser the device route deliberately does
 * not have. The Blob already carries that type, so it travels as-is.
 *
 * Note what is NOT sent -- no device key. This call is authorised by the
 * login session, which is exactly why the shared key never has to reach
 * JavaScript.
 */
export function captureFromCamera(blob) {
  return api.postBinary('/device/capture', blob, blob.type || 'image/jpeg');
}

/** This user's pending photos, newest first. */
export function listDetections() {
  return api.get('/device/detections');
}

/**
 * Turn a reviewed detection into a real food item.
 *
 * `payload` is the same shape FoodItemForm already submits for a manual add,
 * so the review screen reuses that form unchanged -- corrected fields travel
 * exactly as they would if typed from scratch.
 */
export function confirmDetection(id, payload) {
  return api.post(`/device/detections/${id}/confirm`, payload);
}

/** Reject the photo's proposal. The image row stays for the audit trail. */
export function discardDetection(id) {
  return api.post(`/device/detections/${id}/discard`);
}
