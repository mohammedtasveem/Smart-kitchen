import { ApiError } from '../utils/apiError.js';
import {
  validateFoodItem,
  validateFoodItemUpdate,
  validateFoodItemQuery,
  validateId,
  EXPIRY_STATUSES,
} from '../utils/validate.js';
import * as FoodItem from '../models/foodItem.model.js';

/**
 * Every handler here takes the owner from `req.user.id` -- set by requireAuth
 * from a verified token -- and never from the request body or query string.
 * A client cannot ask for another user's items because it has no way to say
 * whose items it wants.
 *
 * A row that belongs to someone else returns **404, not 403**. Answering 403
 * would confirm that the id exists, which is a small leak of other users' data.
 */

/** Loads an item or throws 404. Ownership is enforced inside the model query. */
async function mustFindOwned(id, userId) {
  const row = await FoodItem.findById(id, userId);
  if (!row) throw ApiError.notFound('Food item not found');
  return row;
}

/** POST /api/food-items */
export async function createItem(req, res) {
  const data = validateFoodItem(req.body);
  const item = await FoodItem.createFoodItem(req.user.id, data);
  res.status(201).json({ ok: true, item: FoodItem.toPublicFoodItem(item) });
}

/**
 * GET /api/food-items
 *
 * Query: ?status=NEAR_EXPIRY&category=Dairy&q=milk&includeConsumed=true
 *        &limit=200&offset=0
 */
export async function listItems(req, res) {
  const filters = validateFoodItemQuery(req.query);

  const [rows, total] = await Promise.all([
    FoodItem.listByUser(req.user.id, filters),
    FoodItem.countByUser(req.user.id, filters),
  ]);

  res.json({
    ok: true,
    count: rows.length,
    total,
    limit: filters.limit,
    offset: filters.offset,
    items: rows.map(FoodItem.toPublicFoodItem),
  });
}

/**
 * GET /api/food-items/summary
 *
 * Registered before /:id in the router, otherwise Express would read
 * "summary" as an id.
 */
export async function summary(req, res) {
  const [rows, consumed, categories] = await Promise.all([
    FoodItem.statusCounts(req.user.id),
    FoodItem.consumedCount(req.user.id),
    FoodItem.listCategories(req.user.id),
  ]);

  // GROUP BY omits statuses with no rows. Seed all three at 0 so the dashboard
  // can render every badge without checking whether a key exists.
  const counts = {};
  for (const status of EXPIRY_STATUSES) counts[status] = 0;
  for (const row of rows) counts[row.expiry_status] = Number(row.count);

  res.json({
    ok: true,
    summary: {
      fresh: counts.FRESH,
      nearExpiry: counts.NEAR_EXPIRY,
      expired: counts.EXPIRED,
      // Active = still in the kitchen. Consumed items are history and are
      // deliberately outside this total.
      totalActive: counts.FRESH + counts.NEAR_EXPIRY + counts.EXPIRED,
      consumed,
      // Anything needing attention today -- the number the dashboard headline
      // and the Phase 8 WhatsApp job both care about.
      needsAttention: counts.NEAR_EXPIRY + counts.EXPIRED,
      categories,
    },
  });
}

/** GET /api/food-items/:id */
export async function getItem(req, res) {
  const id = validateId(req.params.id);
  const item = await mustFindOwned(id, req.user.id);
  res.json({ ok: true, item: FoodItem.toPublicFoodItem(item) });
}

/** PATCH /api/food-items/:id */
export async function updateItem(req, res) {
  const id = validateId(req.params.id);
  const patch = validateFoodItemUpdate(req.body);

  const existing = await mustFindOwned(id, req.user.id);

  // purchase_date <= expiry_date has to hold on the FINAL row, so compare the
  // merged values. Patching only the expiry date must not be able to leave a
  // purchase date stranded after it.
  const purchaseDate =
    patch.purchaseDate !== undefined ? patch.purchaseDate : existing.purchase_date;
  const expiryDate = patch.expiryDate !== undefined ? patch.expiryDate : existing.expiry_date;

  if (purchaseDate && expiryDate && purchaseDate > expiryDate) {
    throw ApiError.badRequest('Validation failed', {
      purchaseDate: 'Purchase date cannot be after the expiry date',
    });
  }

  const updated = await FoodItem.updateFoodItem(id, req.user.id, patch);
  if (!updated) throw ApiError.notFound('Food item not found');

  res.json({ ok: true, item: FoodItem.toPublicFoodItem(updated) });
}

/**
 * POST /api/food-items/:id/consume
 *
 * Body is optional: `{ "consumed": false }` puts the item back into the active
 * inventory, for the mis-tap case. Anything else marks it consumed.
 */
export async function consumeItem(req, res) {
  const id = validateId(req.params.id);

  const raw = req.body?.consumed;
  if (raw !== undefined && typeof raw !== 'boolean') {
    throw ApiError.badRequest('Validation failed', { consumed: 'Must be true or false' });
  }
  const consumed = raw ?? true;

  const updated = await FoodItem.setConsumed(id, req.user.id, consumed);
  if (!updated) throw ApiError.notFound('Food item not found');

  res.json({ ok: true, item: FoodItem.toPublicFoodItem(updated) });
}

/** DELETE /api/food-items/:id */
export async function deleteItem(req, res) {
  const id = validateId(req.params.id);

  const deleted = await FoodItem.deleteFoodItem(id, req.user.id);
  if (!deleted) throw ApiError.notFound('Food item not found');

  res.json({ ok: true, deleted: id });
}
