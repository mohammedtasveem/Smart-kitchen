import { env } from '../config/env.js';
import { explainDbError } from '../config/db.js';

export { ApiError } from '../utils/apiError.js';

/** Reached only when no route matched. */
export function notFound(req, res) {
  res.status(404).json({
    ok: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

/**
 * Central error handler. Express 5 forwards rejected async handlers here
 * automatically, so route code can just `throw`.
 */
export function errorHandler(err, req, res, _next) {
  const status = err.status ?? err.statusCode ?? 500;

  // MySQL errors arrive with a `code` like ER_DUP_ENTRY -- translate the
  // common ones into a hint the developer can act on.
  const hint = err.code ? explainDbError(err.code) : null;

  if (status >= 500) {
    console.error('[error]', err);
  }

  res.status(status).json({
    ok: false,
    error: err.message || 'Internal Server Error',
    ...(err.details ? { details: err.details } : {}),
    ...(hint ? { hint } : {}),
    ...(env.isProduction ? {} : { stack: err.stack }),
  });
}
