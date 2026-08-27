import bcrypt from 'bcryptjs';

import { ApiError } from '../utils/apiError.js';
import { signToken } from '../utils/jwt.js';
import { setTokenCookie, clearTokenCookie } from '../utils/cookie.js';
import { validateSignup, validateLogin, validateProfileUpdate } from '../utils/validate.js';
import {
  createUser,
  emailExists,
  findByEmailWithHash,
  toPublicUser,
  updateUser,
} from '../models/user.model.js';

// Cost 12: ~250ms per hash on typical hardware. Slow enough to make offline
// cracking expensive, fast enough that login still feels instant.
const BCRYPT_ROUNDS = 12;

/** POST /api/auth/signup */
export async function signup(req, res) {
  const { name, email, password, phone } = validateSignup(req.body);

  if (await emailExists(email)) {
    throw ApiError.conflict('An account with this email already exists', {
      email: 'Email is already registered',
    });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  let user;
  try {
    user = await createUser({ name, email, passwordHash, phone });
  } catch (err) {
    // Two simultaneous signups can both pass the emailExists check; the UNIQUE
    // index is what actually guarantees uniqueness.
    if (err.code === 'ER_DUP_ENTRY') {
      throw ApiError.conflict('An account with this email already exists', {
        email: 'Email is already registered',
      });
    }
    throw err;
  }

  const token = signToken(user.id);
  setTokenCookie(res, token);

  res.status(201).json({
    ok: true,
    token, // Also return in body for development (cookie may not work cross-port)
    user: toPublicUser(user),
  });
}

/** POST /api/auth/login */
export async function login(req, res) {
  const { email, password } = validateLogin(req.body);

  const row = await findByEmailWithHash(email);

  // Same message and roughly the same timing whether the email exists or the
  // password is wrong -- otherwise this endpoint becomes a way to discover
  // which emails are registered.
  const hash = row?.password_hash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
  const passwordMatches = await bcrypt.compare(password, hash);

  if (!row || !passwordMatches) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const token = signToken(row.id);
  setTokenCookie(res, token);

  res.json({
    ok: true,
    token, // Also return in body for development (cookie may not work cross-port)
    user: toPublicUser(row),
  });
}

/** GET /api/auth/me -- requires auth */
export async function me(req, res) {
  res.json({ ok: true, user: toPublicUser(req.user) });
}

/**
 * PATCH /api/auth/me -- requires auth
 * Phase 8 needs a way to set the WhatsApp number and opt-in flag.
 */
export async function updateMe(req, res) {
  const patch = validateProfileUpdate(req.body);
  const updated = await updateUser(req.user.id, patch);
  res.json({ ok: true, user: toPublicUser(updated) });
}

/** POST /api/auth/logout -- clear the JWT cookie */
export async function logout(req, res) {
  clearTokenCookie(res);
  res.json({ ok: true, message: 'Logged out' });
}
