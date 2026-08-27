import { query } from '../config/db.js';

/**
 * Data access for `recipes` (Phase 9).
 *
 * Unlike `food_items`, recipes are **not scoped to a user** -- the catalogue is
 * shared, and the personalisation happens at ranking time in
 * `services/recipeMatch.js` against the caller's own inventory. So there is no
 * `user_id` argument here, and that is not an oversight: a recipe carries no
 * private data, and giving every user their own copy of the same 24 rows would
 * only make the recommender slower.
 *
 * The table is small by design. Every read pulls the whole catalogue because the
 * matcher has to score all of it to rank any of it; `MAX_CATALOGUE` is the
 * backstop that keeps that assumption honest if an API importer ever fills the
 * table with thousands of rows.
 */

const MAX_CATALOGUE = 500;

const SELECT_COLUMNS = `id, source, external_id, title, image_url,
  ready_in_minutes, servings, source_url, instructions, ingredients, fetched_at`;

/**
 * DB row -> API shape.
 *
 * `ingredients` is left exactly as the driver returned it. mysql2 parses a JSON
 * column into a real array, but a column written by an older client can come
 * back as a string -- `readIngredients` in the matcher accepts both, so this
 * function does not need to guess.
 */
export function toPublicRecipe(row) {
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id,
    title: row.title,
    imageUrl: row.image_url,
    readyInMinutes: row.ready_in_minutes === null ? null : Number(row.ready_in_minutes),
    servings: row.servings === null ? null : Number(row.servings),
    sourceUrl: row.source_url,
    instructions: row.instructions,
    ingredients: row.ingredients,
  };
}

/** The whole catalogue, optionally narrowed by title. */
export async function listRecipes(filters = {}) {
  const { search } = filters;

  const conditions = [];
  const values = [];

  if (search) {
    conditions.push('title LIKE ?');
    // Same LIKE-wildcard escaping as foodItem.model.js, so a search for "100%"
    // is a literal search.
    values.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  return query(
    `SELECT ${SELECT_COLUMNS}
       FROM recipes
       ${where}
      ORDER BY title ASC
      LIMIT ${MAX_CATALOGUE}`,
    values
  );
}

export async function findRecipeById(id) {
  const rows = await query(
    `SELECT ${SELECT_COLUMNS} FROM recipes WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function countRecipes() {
  const rows = await query('SELECT COUNT(*) AS total FROM recipes');
  return Number(rows[0].total);
}

/**
 * Insert or refresh one recipe, keyed on `(source, external_id)`.
 *
 * That pair is the table's unique key, which is what makes re-running the
 * seeder harmless: a second run updates the 24 rows in place instead of
 * creating 24 duplicates. The same property is what a future recipe-API
 * importer needs, so it can re-fetch without cleaning up first.
 */
export async function upsertRecipe(data) {
  const result = await query(
    `INSERT INTO recipes
       (source, external_id, title, image_url, ready_in_minutes, servings,
        source_url, instructions, ingredients)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE
       title            = VALUES(title),
       image_url        = VALUES(image_url),
       ready_in_minutes = VALUES(ready_in_minutes),
       servings         = VALUES(servings),
       source_url       = VALUES(source_url),
       instructions     = VALUES(instructions),
       ingredients      = VALUES(ingredients),
       fetched_at       = CURRENT_TIMESTAMP`,
    [
      data.source,
      data.externalId,
      data.title,
      data.imageUrl ?? null,
      data.readyInMinutes ?? null,
      data.servings ?? null,
      data.sourceUrl ?? null,
      data.instructions ?? null,
      JSON.stringify(data.ingredients ?? []),
    ]
  );
  // insertId is 0 on a pure update, so affectedRows is the honest signal:
  // MySQL reports 1 for an insert and 2 for a row it actually changed.
  return { inserted: result.affectedRows === 1, id: result.insertId || null };
}

/** Remove every recipe from one source. Used by the seeder's --reset flag. */
export async function deleteRecipesBySource(source) {
  const result = await query('DELETE FROM recipes WHERE source = ?', [source]);
  return result.affectedRows;
}
