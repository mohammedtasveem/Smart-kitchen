import { ApiError } from '../utils/apiError.js';
import { readBearerToken, verifyToken } from '../utils/jwt.js';
import { readTokenFromCookie } from '../utils/cookie.js';
import { findById } from '../models/user.model.js';

/**
 * Gate for any route that needs a logged-in user.
 *
 * Reads token from either:
 *   1. httpOnly cookie (preferred, XSS-safe)
 *   2. Authorization: Bearer header (fallback for API clients)
 *
 * On success `req.user` holds the FRESH row from the database, not the token
 * payload -- so a deleted account or an updated phone number takes effect
 * immediately rather than when the 7-day token expires.
 */
export async function requireAuth(req, res, next) {
  try {
    // Try cookie first (httpOnly, XSS-safe), then fall back to header
    const token = readTokenFromCookie(req) || readBearerToken(req.headers.authorization);
    if (!token) {
      throw ApiError.unauthorized('Not authenticated -- please log in');
    }

    const userId = verifyToken(token);
    const user = await findById(userId);

    if (!user) {
      // Valid signature, but the account is gone.
      throw ApiError.unauthorized('Account no longer exists');
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
