import crypto from 'node:crypto';

import { env } from '../config/env.js';
import { ApiError } from '../utils/apiError.js';

/**
 * Gate for the ESP32-CAM's upload endpoint (Phase 10).
 *
 * The device has no browser, no login and no way to hold a JWT -- so instead
 * of a user session it presents one shared secret in the `x-device-key`
 * header, configured as DEVICE_API_KEY on both sides.
 *
 * Deliberate properties:
 *
 *  - **Constant-time compare.** `crypto.timingSafeEqual` stops an attacker
 *    from learning the key byte-by-byte by measuring response times.
 *  - **Unconfigured means closed, not open.** An empty DEVICE_API_KEY is the
 *    most likely misconfiguration there is (fresh clone, .env never filled
 *    in), and answering 503 makes that visible on the very first upload
 *    instead of leaving an endpoint anyone could call with an empty header.
 *  - **The key identifies a device, not a user.** Which kitchen the photo
 *    belongs to comes from `DEVICE_USER_ID`, set once in .env. One camera,
 *    one owner -- adding multi-device support means adding a devices table,
 *    which is a different phase's problem.
 */

function safeEqual(a, b) {
// Hash both sides first so timingSafeEqual is always 32 bytes, regardless of
// the original key length. This prevents an attacker from learning key length
// from response timing and performing efficient brute-force searches.
const hashA = crypto.createHash('sha256').update(a, 'utf8').digest();
const hashB = crypto.createHash('sha256').update(b, 'utf8').digest();
// timingSafeEqual throws on length mismatch, which would itself leak the
// length -- both hashes are 32 bytes, so the comparison is always safe.
return crypto.timingSafeEqual(hashA, hashB);
}

export function deviceAuth(req, res, next) {
  try {
    if (!env.device.apiKey) {
      throw new ApiError(
        503,
        'Device uploads are disabled -- set DEVICE_API_KEY in backend/.env'
      );
    }

    const presented = req.get('x-device-key') ?? '';
    // Use constant-time comparison to prevent timing attacks.
    // If the presented key is wrong, reject with 401 and no hint about
    // whether the header name, the value or the account was wrong.
    if (!presented || !safeEqual(presented, env.device.apiKey)) {
      throw ApiError.unauthorized('Invalid device key');
    }

    next();
  } catch (err) {
    next(err);
  }
}