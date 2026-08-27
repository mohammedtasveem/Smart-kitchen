/**
 * Recipe matching and expiry-priority ranking (Phase 9, Objective 05).
 *
 * The objective on slide 8 is "prioritise items approaching expiry when ranking
 * recipes". So this file answers two questions for every recipe:
 *
 *   1. Can the user actually cook it?      -> ingredient coverage
 *   2. Would cooking it save food?         -> urgency of the matched items
 *
 * and combines them into one score. The literature slides mention embeddings and
 * semantic matching; the *objective* asks only for expiry-priority ranking, so
 * this is deliberately transparent arithmetic -- every number a recipe card shows
 * can be traced back to a specific item in the user's kitchen, which matters more
 * at a review than an unexplainable similarity value.
 *
 * Nothing here touches the database. It takes plain arrays and returns plain
 * objects, so it is testable on its own and the same code path serves the list
 * endpoint, the detail endpoint and the "cook this" action.
 */

/**
 * Aliases for what people actually type into the inventory.
 *
 * The seed catalogue uses one canonical name per ingredient, but a user adding
 * groceries writes whatever is on the packet -- "Aloo", "Dahi", "Rava", "Yogurt".
 * Without this map a full fridge would match nothing, and the feature would look
 * broken rather than empty.
 *
 * Both sides are written in readable form and pushed through `tokenise` when the
 * lookup table is built, so an entry can be added here without having to know
 * what the normaliser does to it.
 *
 * This is matching data only; it never reaches the interface.
 */
const ALIAS_SOURCE = {
    aloo: 'potato',
    batata: 'potato',
    pyaz: 'onion',
    pyaaz: 'onion',
    kanda: 'onion',
    tamatar: 'tomato',
    dahi: 'curd',
    yogurt: 'curd',
    yoghurt: 'curd',
    doodh: 'milk',
    atta: 'flour',
    maida: 'flour',
    'wheat flour': 'flour',
    'all purpose flour': 'flour',
    chawal: 'rice',
    anda: 'egg',
    murgi: 'chicken',
    murga: 'chicken',
    palak: 'spinach',
    gobi: 'cauliflower',
    'phool gobi': 'cauliflower',
    gajar: 'carrot',
    kheera: 'cucumber',
    sooji: 'semolina',
    suji: 'semolina',
    rava: 'semolina',
    'bell pepper': 'capsicum',
    'green pepper': 'capsicum',
    'shimla mirch': 'capsicum',
    coriander: 'coriander leaves',
    cilantro: 'coriander leaves',
    dhania: 'coriander leaves',
    chana: 'chickpea',
    'kabuli chana': 'chickpea',
    'garbanzo bean': 'chickpea',
    toor: 'toor dal',
    'arhar dal': 'toor dal',
    'pigeon pea': 'toor dal',
    'french bean': 'beans',
    'green bean': 'beans',
    'scallion': 'spring onion',
    'gram flour': 'besan',
    'chickpea flour': 'besan',
    'flattened rice': 'poha',
    'clarified butter': 'ghee',
    'paneer cheese': 'paneer',
    'cottage cheese': 'paneer',
};

/**
 * Crude singulariser. "tomatoes" -> "tomato", "berries" -> "berry".
 *
 * Deliberately not a full stemmer: an aggressive one turns "beans" into "bean"
 * *and* "molasses" into "molasse", and the catalogue is small enough that the
 * ALIASES map is the right place to fix the handful of words this gets wrong.
 */
function singular(word) {
  if (word.length <= 3) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('sses') || word.endsWith('shes') || word.endsWith('ches')) {
    return word.slice(0, -2);
  }
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (word.endsWith('ss') || word.endsWith('us')) return word;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/**
 * Turn free text into a comparable token list.
 *
 * Quantities and packaging noise are dropped, because inventory names in the
 * wild look like "Amul Butter 500g" and the useful token there is "butter".
 */
const NOISE = new Set([
  'fresh',
  'organic',
  'packet',
  'pack',
  'box',
  'bottle',
  'raw',
  'whole',
  'chopped',
  'sliced',
  'diced',
  'grated',
  'frozen',
  'kg',
  'g',
  'gm',
  'gms',
  'ml',
  'l',
  'litre',
  'liter',
  'pcs',
  'pc',
]);

export function tokenise(text) {
  if (!text) return [];
  const cleaned = String(text)
    .toLowerCase()
    // Strip anything that is not a letter or a space. This also removes the
    // digits in "500g" while leaving the "g" to be dropped as noise below.
    .replace(/[^a-z\s]+/g, ' ')
    .trim();

  const words = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map(singular)
    .filter((w) => !NOISE.has(w));

  // A name made entirely of noise ("500g packet") still needs to compare as
  // something, so fall back to the cleaned words rather than an empty list.
  if (words.length === 0) {
    return cleaned.split(/\s+/).filter(Boolean).map(singular);
  }
  return words;
}

/** Canonical key for one name: normalised, de-noised, aliased. */
export function canonical(text) {
  const key = tokenise(text).join(' ');
  return ALIASES.get(key) ?? key;
}

/**
 * Built after `tokenise` exists, and with both sides run through it, so
 * "coriander" and the catalogue's "coriander leaves" reduce to the same key
 * however either one happens to be spelled in the table above.
 */
const ALIASES = new Map(
  Object.entries(ALIAS_SOURCE).map(([from, to]) => [
    tokenise(from).join(' '),
    tokenise(to).join(' '),
  ])
);

/**
 * Does an inventory item satisfy a recipe ingredient?
 *
 * Compared as token *sets* in both directions rather than by substring, so
 * "paneer cubes" satisfies "paneer" while "ice" never satisfies "rice".
 */
export function itemSatisfies(itemName, ingredientName) {
  const item = canonical(itemName);
  const ingredient = canonical(ingredientName);
  if (!item || !ingredient) return false;
  if (item === ingredient) return true;

  const itemTokens = new Set(item.split(' '));
  const ingredientTokens = ingredient.split(' ');

  // Every word of the ingredient appears in the item name: "toor dal" in
  // "toor dal 1kg", or "paneer" in "paneer cubes".
  if (ingredientTokens.every((t) => itemTokens.has(t))) return true;

  // The other direction, for a terse inventory entry against a longer
  // ingredient: "coriander" in the kitchen against "coriander leaves".
  const ingredientSet = new Set(ingredientTokens);
  return [...itemTokens].every((t) => ingredientSet.has(t));
}

// ---------------------------------------------------------------------------
//  Scoring
// ---------------------------------------------------------------------------

/**
 * How much cooking this item today is worth, by days remaining.
 *
 * The 3-day boundary is the same one `v_food_items_status` uses for
 * NEAR_EXPIRY, so a recipe the Alerts page is nagging about also rises to the
 * top of the recipe list. Keeping the numbers here rather than in the formula
 * makes the table above directly quotable on a slide.
 */
const URGENCY_POINTS = [
  { maxDays: 1, points: 3 }, // today or tomorrow
  { maxDays: 3, points: 2 }, // near expiry
  { maxDays: 7, points: 1.5 }, // this week
];
const BASE_POINTS = 1; // fresh, no hurry

/**
 * Weight split, applied as `coverage x (COVERAGE + URGENCY x urgency)`.
 *
 * Multiplied by coverage rather than added to it, deliberately. With a plain
 * weighted sum a recipe you can barely cook (1 of 3 ingredients) outranked one
 * you nearly can (2 of 4) purely because its single match expired sooner, which
 * is not a useful suggestion. Gating on coverage keeps urgency as a tie-breaker
 * *within* the recipes you can actually make.
 *
 * The scale reads cleanly: a recipe you can fully cook from fresh stock scores
 * 70, and the last 30 points are earned by how soon its ingredients expire. 100
 * means every ingredient is in the kitchen and every one of them goes off today.
 */
const COVERAGE_WEIGHT = 0.7;
const URGENCY_WEIGHT = 0.3;

/** Points 1..3 -> 0..1, so the two halves of the score are comparable. */
const MAX_POINTS = 3;

export function urgencyPoints(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return BASE_POINTS;
  for (const band of URGENCY_POINTS) {
    if (daysLeft <= band.maxDays) return band.points;
  }
  return BASE_POINTS;
}

/**
 * Ingredients as a flat list of `{ name, pantry }`.
 *
 * The column is JSON and two writers will eventually touch it: the seeder,
 * which stores objects, and any future recipe-API importer, which is likely to
 * store plain strings. Accepting both here means the importer needs no
 * knowledge of this format, and a malformed row degrades to "no ingredients"
 * instead of throwing inside a request.
 */
export function readIngredients(raw) {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      if (typeof entry === 'string') return { name: entry, pantry: false };
      if (entry && typeof entry.name === 'string') {
        return { name: entry.name, pantry: Boolean(entry.pantry) };
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * Match one recipe against the kitchen.
 *
 * `items` must already exclude expired and consumed rows -- see `rankRecipes`
 * for why expired food is treated as absent rather than available.
 *
 * Pantry ingredients are reported but left out of the coverage fraction. A
 * 4-ingredient curry that also wants salt and turmeric should not read as 67%
 * cookable just because the spice rack is not in the inventory.
 */
export function matchRecipe(recipe, items) {
  const ingredients = readIngredients(recipe.ingredients);
  const core = ingredients.filter((i) => !i.pantry);
  const pantry = ingredients.filter((i) => i.pantry).map((i) => i.name);

  const have = [];
  const missing = [];

  for (const ingredient of core) {
    // More than one item can satisfy an ingredient -- two cartons of milk, or
    // "Tomato" and "Tomatoes". Take the most urgent, because that is the one
    // cooking this recipe would rescue.
    const candidates = items.filter((item) => itemSatisfies(item.name, ingredient.name));
    if (candidates.length === 0) {
      missing.push(ingredient.name);
      continue;
    }
    const best = candidates.reduce((a, b) => {
      const av = a.daysLeft ?? Number.POSITIVE_INFINITY;
      const bv = b.daysLeft ?? Number.POSITIVE_INFINITY;
      return bv < av ? b : a;
    });
    have.push({
      ingredient: ingredient.name,
      itemId: best.id,
      itemName: best.name,
      daysLeft: best.daysLeft ?? null,
      expiryStatus: best.expiryStatus ?? null,
    });
  }

  const total = core.length;
  const coverage = total === 0 ? 0 : have.length / total;

  const avgPoints =
    have.length === 0
      ? BASE_POINTS
      : have.reduce((sum, h) => sum + urgencyPoints(h.daysLeft), 0) / have.length;

  // Normalised urgency: 0 when everything matched is fresh, 1 when everything
  // matched expires today.
  const urgency = (avgPoints - BASE_POINTS) / (MAX_POINTS - BASE_POINTS);

  // Coverage gates the whole score, so a recipe nothing matches is 0 without
  // needing a special case.
  const score = coverage * (COVERAGE_WEIGHT + URGENCY_WEIGHT * urgency);

  return {
    have,
    missing,
    pantry,
    totalCore: total,
    haveCount: have.length,
    missingCount: missing.length,
    coveragePercent: Math.round(coverage * 100),
    // How many matched items the Alerts page would already be warning about.
    // This is the number the UI leads with -- it is the objective, stated
    // plainly: "uses 2 items that expire soon".
    expiringCount: have.filter((h) => h.daysLeft !== null && h.daysLeft <= 3).length,
    soonestDaysLeft: have.reduce(
      (min, h) => (h.daysLeft !== null && h.daysLeft < min ? h.daysLeft : min),
      Number.POSITIVE_INFINITY
    ),
    score: Math.round(score * 100),
  };
}

/**
 * Rank the whole catalogue for one kitchen.
 *
 * **Expired items are dropped, not scored.** Suggesting a recipe *because* it
 * uses food that is already unsafe would invert the point of the project, so
 * the recommender treats an expired item as something the user does not have.
 * The Alerts page is what tells them to throw it away.
 */
export function rankRecipes(recipes, items, options = {}) {
  const { maxMissing = null, minScore = 0, onlyExpiring = false, limit = null } = options;

  const usable = items.filter((item) => !item.isConsumed && item.expiryStatus !== 'EXPIRED');

  let ranked = recipes.map((recipe) => ({ recipe, match: matchRecipe(recipe, usable) }));

  if (maxMissing !== null) {
    ranked = ranked.filter((r) => r.match.missingCount <= maxMissing);
  }
  if (onlyExpiring) {
    ranked = ranked.filter((r) => r.match.expiringCount > 0);
  }
  if (minScore > 0) {
    ranked = ranked.filter((r) => r.match.score >= minScore);
  }

  ranked.sort((a, b) => {
    // Score first, then the tie-breakers a cook would actually care about:
    // fewer missing ingredients, then something expiring sooner, then title so
    // the order is stable between two identical requests.
    if (b.match.score !== a.match.score) return b.match.score - a.match.score;
    if (a.match.missingCount !== b.match.missingCount) {
      return a.match.missingCount - b.match.missingCount;
    }
    if (a.match.soonestDaysLeft !== b.match.soonestDaysLeft) {
      return a.match.soonestDaysLeft - b.match.soonestDaysLeft;
    }
    return String(a.recipe.title).localeCompare(String(b.recipe.title));
  });

  return limit ? ranked.slice(0, limit) : ranked;
}

