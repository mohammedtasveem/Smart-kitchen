import { validateId, validateRecipeQuery } from '../utils/validate.js';
import * as Recipe from '../models/recipe.model.js';
import * as FoodItem from '../models/foodItem.model.js';
import { matchRecipe, rankRecipes } from '../services/recipeMatch.js';
import { ApiError } from '../utils/apiError.js';

/**
 * Recipe recommendation (Phase 9, Objective 05: "prioritise items approaching
 * expiry when ranking recipes").
 *
 * The catalogue is shared, but every response here is personal -- the ranking is
 * computed against `req.user`'s own inventory, and the item ids in each match
 * belong to the caller. So the recipes need no ownership check while the match
 * data does, and the only place a user id enters is the inventory read.
 *
 * Ranking is done in the application rather than in SQL on purpose. The scoring
 * rule is the part of this phase a review panel will ask about, and it is far
 * more legible as commented arithmetic in `services/recipeMatch.js` than as a
 * CASE expression buried in a query. The catalogue is 24 rows; there is no
 * performance argument for the alternative.
 */

/** How many inventory rows the recommender looks at. */
const ITEM_SCAN_LIMIT = 200;

/**
 * Match -> API shape.
 *
 * Strips `soonestDaysLeft`, which is a sort key only: it is `Infinity` when
 * nothing matched, and `JSON.stringify` turns that into `null`, so exposing it
 * would ship a field whose meaning changes with the value.
 */
function toPublicMatch(match) {
  return {
    score: match.score,
    coveragePercent: match.coveragePercent,
    totalCore: match.totalCore,
    haveCount: match.haveCount,
    missingCount: match.missingCount,
    expiringCount: match.expiringCount,
    have: match.have,
    missing: match.missing,
    pantry: match.pantry,
  };
}

/** Load the caller's usable stock once, for whichever handler needs it. */
async function loadKitchen(userId) {
  const rows = await FoodItem.listByUser(userId, {
    includeConsumed: false,
    limit: ITEM_SCAN_LIMIT,
    offset: 0,
  });
  return rows.map(FoodItem.toPublicFoodItem);
}

/**
 * GET /api/recipes
 *
 * The ranked list. Returns recipes *and* the reason each one ranked where it
 * did, because a recommendation the user cannot explain to themselves is one
 * they will not trust -- every card can say "uses your spinach, 0 days left".
 */
export async function listRecipes(req, res) {
  const filters = validateRecipeQuery(req.query);

  const [rows, items] = await Promise.all([
    Recipe.listRecipes({ search: filters.search }),
    loadKitchen(req.user.id),
  ]);

  const catalogue = rows.map(Recipe.toPublicRecipe);
  const ranked = rankRecipes(catalogue, items, {
    maxMissing: filters.maxMissing,
    onlyExpiring: filters.onlyExpiring,
    // Score is gated on coverage, so `minScore: 1` is exactly "at least one
    // ingredient is in the kitchen" -- expressed as a score so the browse
    // toggle has a single knob to turn off.
    minScore: filters.includeUnmatched ? 0 : 1,
    limit: filters.limit,
  });

  // Counted from the same array the matcher used, so the numbers on the page
  // can never disagree with the cards under them.
  const usable = items.filter((i) => i.expiryStatus !== 'EXPIRED');
  const expiring = usable.filter((i) => i.daysLeft !== null && i.daysLeft <= 3);

  res.json({
    ok: true,
    count: ranked.length,
    recipes: ranked.map(({ recipe, match }) => ({ ...recipe, match: toPublicMatch(match) })),
    summary: {
      catalogueSize: catalogue.length,
      // Expired stock is excluded from matching -- see rankRecipes for why --
      // and saying so here is what stops the count looking like a bug.
      itemsInKitchen: items.length,
      itemsUsable: usable.length,
      itemsExpired: items.length - usable.length,
      itemsExpiringSoon: expiring.length,
      topScore: ranked.length > 0 ? ranked[0].match.score : 0,
      filters: {
        maxMissing: filters.maxMissing,
        onlyExpiring: filters.onlyExpiring,
        includeUnmatched: filters.includeUnmatched,
        search: filters.search ?? null,
      },
    },
  });
}

/**
 * GET /api/recipes/:id
 *
 * One recipe with its full method and a fresh match against the kitchen as it
 * is right now, so opening a card after cooking something else shows the truth
 * rather than a cached score.
 */
export async function getRecipe(req, res) {
  const id = validateId(req.params.id, 'id');

  const row = await Recipe.findRecipeById(id);
  if (!row) throw ApiError.notFound('Recipe not found');

  const recipe = Recipe.toPublicRecipe(row);
  const items = await loadKitchen(req.user.id);
  const usable = items.filter((i) => i.expiryStatus !== 'EXPIRED');

  res.json({
    ok: true,
    recipe: { ...recipe, match: toPublicMatch(matchRecipe(recipe, usable)) },
  });
}

/**
 * POST /api/recipes/:id/cook
 *
 * Methodology step 11, "Inventory Update -- updates inventory after
 * consumption", triggered from the recipe rather than from the item list. The
 * matched items are marked consumed in one go, which is the whole loop the
 * project describes: an item nears expiry -> it raises an alert -> it lifts a
 * recipe to the top -> cooking that recipe clears it from the kitchen.
 *
 * Only ingredients this recipe actually matched are consumed, and each one goes
 * through `FoodItem.setConsumed`, which is scoped by `user_id`. So the recipe id
 * in the URL cannot be used to reach another user's stock even though recipes
 * themselves are shared.
 */
export async function cookRecipe(req, res) {
  const id = validateId(req.params.id, 'id');

  const row = await Recipe.findRecipeById(id);
  if (!row) throw ApiError.notFound('Recipe not found');

  const recipe = Recipe.toPublicRecipe(row);
  const items = await loadKitchen(req.user.id);
  const usable = items.filter((i) => i.expiryStatus !== 'EXPIRED');
  const match = matchRecipe(recipe, usable);

  if (match.haveCount === 0) {
    throw ApiError.badRequest('None of this recipe\'s ingredients are in your kitchen', {
      ingredients: 'Add the ingredients to your inventory first',
    });
  }

  // De-duplicated: one item can satisfy two ingredients, and consuming it
  // twice would be a silent no-op the second time rather than an error.
  const itemIds = [...new Set(match.have.map((h) => h.itemId))];

  const consumed = [];
  for (const itemId of itemIds) {
    const updated = await FoodItem.setConsumed(itemId, req.user.id, true);
    if (updated) consumed.push(FoodItem.toPublicFoodItem(updated));
  }

  res.json({
    ok: true,
    consumedCount: consumed.length,
    consumed,
    recipe: { ...recipe, match: toPublicMatch(match) },
  });
}
