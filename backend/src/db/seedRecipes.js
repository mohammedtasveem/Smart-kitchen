/**
 * Recipe catalogue seeder (Phase 9).
 *
 *   npm run db:seed:recipes            insert or refresh the catalogue
 *   npm run db:seed:recipes -- --reset delete the seeded rows first
 *
 * Safe to run any number of times: rows are upserted on
 * `(source, external_id)`, so a second run updates the same 24 recipes instead
 * of duplicating them. `--reset` only ever touches rows whose source is
 * `seed`, so a recipe imported from an external API later is left alone.
 *
 * Why a seeded catalogue rather than a live recipe API: the client's own
 * limitations slide lists connectivity as a risk and asks for recipe responses
 * to be cached, and `recipes` is that cache. Seeding it means the recommender
 * works at a review with no API key, no rate limit and no internet -- while the
 * `source` / `external_id` columns leave the door open for an importer to add to
 * the same table without any change to the matching code.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pool } from '../config/db.js';
import { explainDbError } from '../config/db.js';
import { upsertRecipe, deleteRecipesBySource, countRecipes } from '../models/recipe.model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(here, 'recipes.seed.json');

export const SEED_SOURCE = 'seed';

const shouldReset = process.argv.includes('--reset');

/**
 * Seed file -> the shape `upsertRecipe` stores.
 *
 * The two ingredient lists are flattened into one array of `{ name, pantry }`.
 * Keeping them as one column matches the schema, and the `pantry` flag is what
 * lets the matcher leave salt and turmeric out of the coverage fraction without
 * hiding them from the recipe card.
 */
export function toRecipeRow(entry) {
  const core = (entry.ingredients ?? []).map((name) => ({ name, pantry: false }));
  const pantry = (entry.pantry ?? []).map((name) => ({ name, pantry: true }));

  return {
    source: SEED_SOURCE,
    externalId: entry.externalId,
    title: entry.title,
    imageUrl: entry.imageUrl ?? null,
    readyInMinutes: entry.readyInMinutes ?? null,
    servings: entry.servings ?? null,
    sourceUrl: entry.sourceUrl ?? null,
    instructions: entry.instructions ?? null,
    ingredients: [...core, ...pantry],
  };
}

export async function loadSeedFile() {
  const raw = await fs.readFile(SEED_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.recipes)) {
    throw new Error('recipes.seed.json must contain a "recipes" array');
  }
  return parsed.recipes;
}

async function main() {
  const entries = await loadSeedFile();
  console.log(`[seed] read ${entries.length} recipes from recipes.seed.json`);

  // Reject duplicate ids up front. Without this check a typo'd externalId
  // silently overwrites another recipe through the upsert and the catalogue
  // quietly shrinks.
  const ids = entries.map((e) => e.externalId);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length > 0) {
    throw new Error(`duplicate externalId in seed file: ${[...new Set(duplicates)].join(', ')}`);
  }

  if (shouldReset) {
    const removed = await deleteRecipesBySource(SEED_SOURCE);
    console.log(`[seed] --reset removed ${removed} existing "${SEED_SOURCE}" recipe(s)`);
  }

  let inserted = 0;
  let updated = 0;

  for (const entry of entries) {
    const row = toRecipeRow(entry);
    if (!row.externalId || !row.title || row.ingredients.length === 0) {
      throw new Error(`incomplete recipe in seed file: ${row.title ?? row.externalId ?? '?'}`);
    }
    const result = await upsertRecipe(row);
    if (result.inserted) inserted += 1;
    else updated += 1;
  }

  const total = await countRecipes();
  console.log(`[seed] ${inserted} inserted, ${updated} updated`);
  console.log(`[seed] catalogue now holds ${total} recipe(s)`);
}

main()
  .catch((err) => {
    console.error(`\n[seed] FAILED: ${err.message}`);
    const hint = explainDbError(err.code);
    if (hint) console.error(`[seed] hint: ${hint}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
