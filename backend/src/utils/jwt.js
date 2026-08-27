import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';
import { ApiError } from './apiError.js';

/**
 * Sign a token for a user id. The payload stays minimal on purpose -- name,
 * email and phone can change, and a stale copy inside a 7-day token would be
 * wrong. The user is loaded fresh from the DB on every request instead.
 */
export function signToken(userId) {
  if (!env.jwt.secret) {
    throw new Error('JWT_SECRET is not set -- cannot sign tokens. Check backend/.env');
  }
  return jwt.sign({}, env.jwt.secret, {
    subject: String(userId),
    expiresIn: env.jwt.expiresIn,
  });
}

/** Verify a token and return its user id. Throws ApiError(401) on any problem. */
export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, env.jwt.secret);
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw ApiError.unauthorized('Malformed token');
    }
    return userId;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Session expired -- please log in again');
    }
    throw ApiError.unauthorized('Invalid token');
  }
}

/** Pull the bearer token out of an Authorization header. Returns null if absent. */
export function readBearerToken(header) {
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer (.+)$/i);
  return match ? match[1].trim() : null;
}
