import { env } from '../config/env.js';

/**
 * Cookie configuration for JWT tokens.
 *
 * httpOnly: true  -> JavaScript cannot read the cookie (XSS protection)
 * secure: true    -> Only sent over HTTPS (set true in production)
 * sameSite: 'lax' -> CSRF protection (sends on top-level navigation)
 * maxAge: 7 days  -> Matches JWT expiresIn
 */
const COOKIE_NAME = 'sfi_token';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function getCookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProduction, // true in production, false in development
    sameSite: 'lax',
    maxAge: MAX_AGE_MS,
    path: '/',
    // In development, the frontend and backend are on different ports,
    // so we don't set domain. In production on the same domain, this works.
  };
}

/**
 * Set the JWT token as an httpOnly cookie.
 * Called after successful login or signup.
 */
export function setTokenCookie(res, token) {
  res.cookie(COOKIE_NAME, token, getCookieOptions());
}

/**
 * Clear the JWT token cookie.
 * Called on logout.
 */
export function clearTokenCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    path: '/',
  });
}

/**
 * Read the JWT token from the cookie.
 * Returns null if not found.
 */
export function readTokenFromCookie(req) {
  return req.cookies?.[COOKIE_NAME] ?? null;
}
