import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for authentication endpoints (login, signup).
 *
 * Limits each IP to 10 requests per 15 minutes on auth routes.
 * This prevents brute-force attacks while being lenient enough for
 * legitimate users who mistype their password.
 *
 * In production, consider using a Redis store instead of the default
 * in-memory store for multi-instance deployments.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 10 : 100, // Higher limit in dev
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    ok: false,
    error: 'Too many requests, please try again later',
    retryAfter: '15 minutes',
  },
  // Use default keyGenerator which handles IPv6 properly
});

/**
 * Stricter rate limiter for sensitive operations like password changes.
 * 5 requests per hour.
 */
export const sensitiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 requests per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: 'Too many attempts, please try again in an hour',
  },
});

/**
 * General API rate limiter for other endpoints.
 * 100 requests per 15 minutes.
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: 'Too many requests, please slow down',
  },
});
