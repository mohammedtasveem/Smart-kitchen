/**
 * The single place the frontend talks to the backend.
 *
 * Nothing else in the app calls `fetch`, so token handling, error shape and the
 * "your session expired" path all live in exactly one file.
 *
 * Token is stored in localStorage and sent via Authorization: Bearer header.
 * The backend also sets an httpOnly cookie as a secondary mechanism for
 * production deployments where the frontend and backend share a domain.
 */

// Defaults to a relative path so the Vite dev proxy handles it and the browser
// stays on one origin. A deployed build can point elsewhere via VITE_API_BASE.
const BASE = import.meta.env.VITE_API_BASE || '/api';

// When BASE is a full URL (deployed build: https://backend.onrender.com/api)
// this is its origin, e.g. https://backend.onrender.com. Empty in dev, where
// BASE is the relative /api and the Vite proxy serves /uploads too.
const API_ORIGIN = /^https?:\/\//i.test(BASE) ? new URL(BASE).origin : '';

/**
 * Point a server-relative asset path at the backend.
 *
 * The API returns photos as `/uploads/detections/<file>.jpg` -- correct only
 * when the frontend and backend share an origin, which they do in dev but not
 * on Vercel (frontend) + Render (backend): the browser would ask Vercel for the
 * file and get a 404. Absolute URLs (a recipe from the web) and data: URIs are
 * returned untouched, so this is safe on any image field.
 */
export function assetUrl(path) {
  if (!path || typeof path !== 'string') return path;
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return `${API_ORIGIN}${path.startsWith('/') ? '' : '/'}${path}`;
}

const TOKEN_KEY = 'sfi_token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* nothing we can do; the session just won't survive a reload */
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Mirrors the backend's error envelope: `{ ok: false, error, details }`.
 * `details` is the per-field map that forms read to highlight bad inputs.
 */
export class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  /** True when the request never reached the server. */
  get isNetwork() {
    return this.status === 0;
  }
}

// AuthContext registers a callback here so an expired token logs the user out
// wherever it is noticed, instead of every page handling 401 on its own.
let onUnauthorized = null;

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// Login and signup answer 401/409 as normal business outcomes. A 401 from those
// must not be mistaken for "session expired" and trigger a logout.
const AUTH_ENTRY_PATHS = ['/auth/login', '/auth/signup'];

/**
 * One request shape for the whole app.
 *
 * `raw` swaps the JSON encoding for a body passed through untouched -- the
 * webcam's JPEG bytes, which must not be stringified. Auth, the error envelope
 * and the 401-to-logout path stay identical either way, so a binary endpoint
 * cannot quietly behave differently from every other call.
 */
async function request(method, path, body, { raw = false, contentType = 'application/json' } = {}) {
  const token = getToken();

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': contentType } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(
      0,
      'Could not reach the server. Is the backend running? (npm run dev)'
    );
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      /* a proxy error page, not JSON -- fall through to the generic message */
    }
  }

  if (!res.ok) {
    if (res.status === 401 && token && !AUTH_ENTRY_PATHS.includes(path)) {
      onUnauthorized?.();
    }
    throw new ApiError(
      res.status,
      data?.error || `Request failed (${res.status})`,
      data?.details ?? null
    );
  }

  return data;
}

/** Turns `{ status: 'FRESH', q: '' }` into `?status=FRESH` -- empties dropped. */
export function toQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
  /** POST a non-JSON body (binary upload) with the same auth and errors. */
  postBinary: (path, body, contentType) =>
    request('POST', path, body, { raw: true, contentType }),
};
