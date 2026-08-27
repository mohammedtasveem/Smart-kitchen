import { api, toQuery } from './client.js';

/**
 * Recipe endpoints (Phase 9).
 *
 * Same idea as the other api modules -- URLs live here, pages don't build paths.
 */

/**
 * The ranked recommendation list.
 *
 * Every recipe comes back with a `match` block explaining its position: which of
 * the user's items it would use, how many days those have left, and what is
 * missing. The page renders that rather than a bare score, because a suggestion
 * the user can't see the reason for is one they won't act on.
 *
 * Filters: `maxMissing` (default 3 on the server), `onlyExpiring`,
 * `includeUnmatched`, `search`, `limit`.
 */
export function listRecipes(filters = {}) {
  return api.get(`/recipes${toQuery(filters)}`);
}

/** One recipe with its full method, re-matched against the kitchen right now. */
export function getRecipe(id) {
  return api.get(`/recipes/${id}`);
}

/**
 * Marks the ingredients this recipe matched as consumed -- methodology step 11,
 * "inventory update after consumption".
 *
 * Only the matched items are touched, and only the caller's own, so this cannot
 * empty someone else's kitchen. It is not reversible in one call: undoing means
 * restoring each item from the Inventory page.
 */
export function cookRecipe(id) {
  return api.post(`/recipes/${id}/cook`);
}
