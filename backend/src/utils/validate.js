import { ApiError } from './apiError.js';

/**
 * Small hand-rolled validators.
 *
 * Every validator collects ALL field errors before throwing, so the React form
 * in Phase 6 can highlight every bad field at once instead of one per attempt.
 */

// Deliberately permissive: something@something.tld. Strict RFC 5322 matching
// rejects addresses that real mail servers accept.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// E.164, e.g. +919876543210 -- the only format Meta Cloud API accepts (Phase 8).
const PHONE_RE = /^\+[1-9]\d{7,14}$/;

const PASSWORD_MIN = 8;

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function throwIfInvalid(errors) {
  const keys = Object.keys(errors);
  if (keys.length > 0) {
    throw ApiError.badRequest('Validation failed', errors);
  }
}

export function validateSignup(body = {}) {
  const name = str(body.name);
  const email = str(body.email).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const phone = str(body.phone);

  const errors = {};

  if (!name) errors.name = 'Name is required';
  else if (name.length > 100) errors.name = 'Name must be 100 characters or fewer';

  if (!email) errors.email = 'Email is required';
  else if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address';
  else if (email.length > 191) errors.email = 'Email must be 191 characters or fewer';

  if (!password) errors.password = 'Password is required';
  else if (password.length < PASSWORD_MIN) {
    errors.password = `Password must be at least ${PASSWORD_MIN} characters`;
  } else if (password.length > 72) {
    // bcrypt silently ignores anything past 72 bytes, which would make a
    // longer password behave as if it were truncated. Reject instead.
    errors.password = 'Password must be 72 characters or fewer';
  }

  // Phone is optional at signup, but must be valid if supplied.
  if (phone && !PHONE_RE.test(phone)) {
    errors.phone = 'Use international format, e.g. +919876543210';
  }

  throwIfInvalid(errors);
  return { name, email, password, phone: phone || null };
}

export function validateLogin(body = {}) {
  const email = str(body.email).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';

  const errors = {};
  if (!email) errors.email = 'Email is required';
  if (!password) errors.password = 'Password is required';

  throwIfInvalid(errors);
  return { email, password };
}

export function validateProfileUpdate(body = {}) {
  const patch = {};
  const errors = {};

  if (body.name !== undefined) {
    const name = str(body.name);
    if (!name) errors.name = 'Name cannot be empty';
    else if (name.length > 100) errors.name = 'Name must be 100 characters or fewer';
    else patch.name = name;
  }

  if (body.phone !== undefined) {
    const phone = str(body.phone);
    // Empty string means "remove my number".
    if (!phone) patch.phone = null;
    else if (!PHONE_RE.test(phone)) {
      errors.phone = 'Use international format, e.g. +919876543210';
    } else patch.phone = phone;
  }

  if (body.whatsappOptIn !== undefined) {
    if (typeof body.whatsappOptIn !== 'boolean') {
      errors.whatsappOptIn = 'Must be true or false';
    } else {
      patch.whatsappOptIn = body.whatsappOptIn;
    }
  }

  throwIfInvalid(errors);

  if (Object.keys(patch).length === 0) {
    throw ApiError.badRequest('Nothing to update -- send name, phone or whatsappOptIn');
  }
  return patch;
}

// ---------------------------------------------------------------------------
//  Food items (Phase 5)
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// DECIMAL(10,2) -- 8 digits before the point, 2 after.
const QUANTITY_MAX = 99999999.99;

export const EXPIRY_STATUSES = ['FRESH', 'NEAR_EXPIRY', 'EXPIRED'];
const SOURCES = ['manual', 'esp32cam'];

/**
 * Is this a real calendar date in YYYY-MM-DD form?
 *
 * Built with Date.UTC on purpose. `new Date('2026-02-30')` and local-timezone
 * construction both shift or silently roll over the date -- the exact class of
 * bug that would make an expiry date land on the wrong day.
 */
function isRealDate(value) {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

function checkQuantity(raw, errors) {
  const qty = Number(raw);
  if (!Number.isFinite(qty)) {
    errors.quantity = 'Quantity must be a number';
    return null;
  }
  if (qty <= 0) {
    errors.quantity = 'Quantity must be greater than 0';
    return null;
  }
  if (qty > QUANTITY_MAX) {
    errors.quantity = 'Quantity is too large';
    return null;
  }
  // The column stores 2 decimals; round here so what the client gets back
  // matches what was saved.
  return Math.round(qty * 100) / 100;
}

/** POST /api/food-items */
export function validateFoodItem(body = {}) {
  const errors = {};

  const name = str(body.name);
  if (!name) errors.name = 'Item name is required';
  else if (name.length > 150) errors.name = 'Name must be 150 characters or fewer';

  const category = str(body.category);
  if (category.length > 60) errors.category = 'Category must be 60 characters or fewer';

  const quantity = checkQuantity(body.quantity ?? 1, errors);

  const unit = str(body.unit) || 'pcs';
  if (unit.length > 20) errors.unit = 'Unit must be 20 characters or fewer';

  const expiryDate = str(body.expiryDate);
  if (!expiryDate) errors.expiryDate = 'Expiry date is required';
  else if (!isRealDate(expiryDate)) errors.expiryDate = 'Use a real date in YYYY-MM-DD format';

  const purchaseDate = str(body.purchaseDate);
  if (purchaseDate && !isRealDate(purchaseDate)) {
    errors.purchaseDate = 'Use a real date in YYYY-MM-DD format';
  } else if (purchaseDate && expiryDate && isRealDate(expiryDate) && purchaseDate > expiryDate) {
    // Plain string compare is correct for zero-padded YYYY-MM-DD.
    errors.purchaseDate = 'Purchase date cannot be after the expiry date';
  }

  const notes = str(body.notes);
  if (notes.length > 500) errors.notes = 'Notes must be 500 characters or fewer';

  const source = str(body.source) || 'manual';
  if (!SOURCES.includes(source)) {
    errors.source = `Source must be one of: ${SOURCES.join(', ')}`;
  }

  const imageUrl = str(body.imageUrl);
  if (imageUrl.length > 500) errors.imageUrl = 'Image URL must be 500 characters or fewer';

  throwIfInvalid(errors);

  return {
    name,
    category: category || null,
    quantity,
    unit,
    purchaseDate: purchaseDate || null,
    expiryDate,
    notes: notes || null,
    source,
    imageUrl: imageUrl || null,
  };
}

/**
 * PATCH /api/food-items/:id
 *
 * `isConsumed` is deliberately NOT accepted here -- POST /:id/consume is the
 * single way to mark an item used up, so there is one code path to reason about.
 */
export function validateFoodItemUpdate(body = {}) {
  const errors = {};
  const patch = {};

  if (body.name !== undefined) {
    const name = str(body.name);
    if (!name) errors.name = 'Name cannot be empty';
    else if (name.length > 150) errors.name = 'Name must be 150 characters or fewer';
    else patch.name = name;
  }

  if (body.category !== undefined) {
    const category = str(body.category);
    if (category.length > 60) errors.category = 'Category must be 60 characters or fewer';
    else patch.category = category || null;
  }

  if (body.quantity !== undefined) {
    const qty = checkQuantity(body.quantity, errors);
    if (qty !== null) patch.quantity = qty;
  }

  if (body.unit !== undefined) {
    const unit = str(body.unit);
    if (!unit) errors.unit = 'Unit cannot be empty';
    else if (unit.length > 20) errors.unit = 'Unit must be 20 characters or fewer';
    else patch.unit = unit;
  }

  if (body.expiryDate !== undefined) {
    const expiryDate = str(body.expiryDate);
    if (!isRealDate(expiryDate)) errors.expiryDate = 'Use a real date in YYYY-MM-DD format';
    else patch.expiryDate = expiryDate;
  }

  if (body.purchaseDate !== undefined) {
    const purchaseDate = str(body.purchaseDate);
    if (!purchaseDate) patch.purchaseDate = null;
    else if (!isRealDate(purchaseDate)) {
      errors.purchaseDate = 'Use a real date in YYYY-MM-DD format';
    } else patch.purchaseDate = purchaseDate;
  }

  if (body.notes !== undefined) {
    const notes = str(body.notes);
    if (notes.length > 500) errors.notes = 'Notes must be 500 characters or fewer';
    else patch.notes = notes || null;
  }

  if (body.imageUrl !== undefined) {
    const imageUrl = str(body.imageUrl);
    if (imageUrl.length > 500) errors.imageUrl = 'Image URL must be 500 characters or fewer';
    else patch.imageUrl = imageUrl || null;
  }

  throwIfInvalid(errors);

  if (Object.keys(patch).length === 0) {
    throw ApiError.badRequest('Nothing to update -- send at least one field');
  }

  // Cross-field check: only possible once both final values are known, which
  // for a PATCH means after merging with the stored row. The controller does
  // that; here we only catch the case where both arrive together.
  if (
    patch.purchaseDate &&
    patch.expiryDate &&
    patch.purchaseDate > patch.expiryDate
  ) {
    throw ApiError.badRequest('Validation failed', {
      purchaseDate: 'Purchase date cannot be after the expiry date',
    });
  }

  return patch;
}

/** Query string for GET /api/food-items */
export function validateFoodItemQuery(query = {}) {
  const errors = {};
  const filters = {};

  if (query.status !== undefined && str(query.status) !== '') {
    const status = str(query.status).toUpperCase();
    if (!EXPIRY_STATUSES.includes(status)) {
      errors.status = `Status must be one of: ${EXPIRY_STATUSES.join(', ')}`;
    } else filters.status = status;
  }

  if (query.category !== undefined && str(query.category) !== '') {
    filters.category = str(query.category);
  }

  if (query.q !== undefined && str(query.q) !== '') {
    filters.search = str(query.q).slice(0, 150);
  }

  // Consumed items are history -- hidden unless explicitly requested.
  filters.includeConsumed = str(query.includeConsumed) === 'true';

  const limit = query.limit === undefined ? 200 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    errors.limit = 'Limit must be a whole number between 1 and 500';
  } else filters.limit = limit;

  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(offset) || offset < 0) {
    errors.offset = 'Offset must be 0 or more';
  } else filters.offset = offset;

  throwIfInvalid(errors);
  return filters;
}

/** Path params like :id -- must be a positive integer. */
export function validateId(raw, field = 'id') {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw ApiError.badRequest('Validation failed', { [field]: 'Must be a positive whole number' });
  }
  return id;
}

// ---------------------------------------------------------------------------
//  Notifications (Phase 7)
// ---------------------------------------------------------------------------

const NOTIFICATION_TYPES = ['near_expiry', 'expired', 'recipe_suggestion'];
const NOTIFICATION_STATUSES = ['pending', 'sent', 'failed'];

/** Query string for GET /api/notifications */
export function validateNotificationQuery(query = {}) {
  const errors = {};
  const filters = {};

  if (query.status !== undefined && str(query.status) !== '') {
    const status = str(query.status).toLowerCase();
    if (!NOTIFICATION_STATUSES.includes(status)) {
      errors.status = `Status must be one of: ${NOTIFICATION_STATUSES.join(', ')}`;
    } else filters.status = status;
  }

  if (query.type !== undefined && str(query.type) !== '') {
    const type = str(query.type).toLowerCase();
    if (!NOTIFICATION_TYPES.includes(type)) {
      errors.type = `Type must be one of: ${NOTIFICATION_TYPES.join(', ')}`;
    } else filters.type = type;
  }

  // ?date=2026-08-22 -- "show me the alerts raised on this day".
  if (query.date !== undefined && str(query.date) !== '') {
    const date = str(query.date);
    if (!isRealDate(date)) errors.date = 'Use a real date in YYYY-MM-DD format';
    else filters.date = date;
  }

  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    errors.limit = 'Limit must be a whole number between 1 and 200';
  } else filters.limit = limit;

  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isInteger(offset) || offset < 0) {
    errors.offset = 'Offset must be 0 or more';
  } else filters.offset = offset;

  throwIfInvalid(errors);
  return filters;
}

/**
 * Query for GET /api/recipes (Phase 9).
 *
 * `maxMissing` defaults to 3 rather than being unbounded. The point of the page
 * is "what can I cook tonight", and a recipe missing six ingredients is not an
 * answer to that -- it is noise that pushes the useful suggestions off screen.
 * Pass `maxMissing=99` to browse the whole catalogue anyway.
 */
export function validateRecipeQuery(query = {}) {
  const errors = {};
  const filters = {};

  if (query.search !== undefined && str(query.search) !== '') {
    const search = str(query.search);
    if (search.length > 100) errors.search = 'Search must be 100 characters or fewer';
    else filters.search = search;
  }

  const maxMissing = query.maxMissing === undefined ? 3 : Number(query.maxMissing);
  if (!Number.isInteger(maxMissing) || maxMissing < 0 || maxMissing > 99) {
    errors.maxMissing = 'maxMissing must be a whole number between 0 and 99';
  } else filters.maxMissing = maxMissing;

  const limit = query.limit === undefined ? 30 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    errors.limit = 'Limit must be a whole number between 1 and 100';
  } else filters.limit = limit;

  // "Only show me recipes that would actually rescue something."
  filters.onlyExpiring = str(query.onlyExpiring) === 'true';

  // By default a recipe has to match at least one thing in the kitchen. A
  // recipe you own none of the ingredients for is not a recommendation, it is
  // the catalogue -- so browsing that is an explicit request, not the default.
  filters.includeUnmatched = str(query.includeUnmatched) === 'true';

  throwIfInvalid(errors);
  return filters;
}
