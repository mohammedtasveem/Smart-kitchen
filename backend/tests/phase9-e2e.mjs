/**
 * Phase 9 end-to-end tests -- recipe recommendation.
 *
 * Hits a RUNNING server against the real database. Start the server first:
 *
 *   npm run dev            # terminal 1
 *   node tests/phase9-e2e.mjs   # terminal 2
 *
 * Creates two throwaway users and adds inventory items that match (and don't
 * match) the seeded recipe catalogue. Tests ranking, scoring, filtering,
 * the cook action (methodology step 11), and cross-user isolation.
 *
 * Prerequisites:
 *   - Recipes must be seeded: `npm run db:seed:recipes` (or the migration
 *     handles it automatically).
 *   - Phase 5 test items are cleaned up, but this suite creates its own.
 */

const BASE = process.env.API_BASE ?? 'http://localhost:5000/api';

let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? `\n        -> ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** Local-timezone YYYY-MM-DD, offset by `days`. Matches MySQL CURDATE(). */
function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON response -- keep the raw text for the failure message */
  }
  return { status: res.status, body: json, raw: text };
}

async function signup(tag) {
  const email = `phase9-${tag}-${Date.now()}@test.local`;
  const res = await api('POST', '/auth/signup', {
    body: { name: `Phase9 ${tag}`, email, password: 'TestPass123' },
  });
  if (res.status !== 201) {
    throw new Error(`signup failed (${res.status}): ${res.raw}`);
  }
  return { token: res.body.token, id: res.body.user.id, email };
}

async function addItem(token, { name, category, quantity, unit, expiryDate }) {
  const res = await api('POST', '/food-items', {
    token,
    body: { name, category, quantity, unit, expiryDate },
  });
  if (res.status !== 201) {
    throw new Error(`addItem(${name}) failed (${res.status}): ${res.raw}`);
  }
  return res.body.item;
}

// ---------------------------------------------------------------------------

console.log('Phase 9 E2E -- recipe recommendation');
console.log(`Base: ${BASE}`);

const health = await api('GET', '/health/db');
if (health.status !== 200) {
  console.error(`\nDatabase not reachable: ${health.raw}`);
  process.exit(1);
}

// -- Setup: create users and inventory --------------------------------------

const TODAY = dateOffset(0);
const NEAR = dateOffset(1);    // tomorrow -> NEAR_EXPIRY
const FAR = dateOffset(60);    // 60 days out -> FRESH
const PAST = dateOffset(-2);   // 2 days ago -> EXPIRED

const A = await signup('a');
const B = await signup('b');
console.log(`Users: A=${A.id}  B=${B.id}`);

// User A gets items that match some recipes:
//   - Tomato (tomato) -> matches Aloo Gobi, Paneer Butter Masala, etc.
//   - Potato (potato) -> matches Aloo Gobi, Aloo Paratha, etc.
//   - Onion (onion)  -> matches almost everything
//   - Milk (milk)    -> matches Banana Milkshake, Curd Rice, etc.
//   - Spinach (spinach) -> matches Palak Paneer, Spinach Dal
//   - Bread (bread, EXPIRED) -> should NOT match Grilled Cheese

const tomato = await addItem(A.token, {
  name: 'Tomato',
  category: 'Vegetables',
  quantity: 4,
  unit: 'pcs',
  expiryDate: NEAR, // expiring tomorrow -> high urgency
});

const potato = await addItem(A.token, {
  name: 'Potato',
  category: 'Vegetables',
  quantity: 1,
  unit: 'kg',
  expiryDate: FAR, // fresh
});

const onion = await addItem(A.token, {
  name: 'Onion',
  category: 'Vegetables',
  quantity: 2,
  unit: 'pcs',
  expiryDate: FAR, // fresh
});

const milk = await addItem(A.token, {
  name: 'Milk',
  category: 'Dairy',
  quantity: 1,
  unit: 'litre',
  expiryDate: NEAR, // expiring tomorrow
});

const spinach = await addItem(A.token, {
  name: 'Spinach',
  category: 'Vegetables',
  quantity: 200,
  unit: 'g',
  expiryDate: dateOffset(5), // 5 days -> FRESH
});

const bread = await addItem(A.token, {
  name: 'Bread',
  category: 'Bakery',
  quantity: 1,
  unit: 'pcs',
  expiryDate: PAST, // expired -> should be excluded from matching
});

console.log(
  `Inventory: tomato=${tomato.id} potato=${potato.id} onion=${onion.id} milk=${milk.id} spinach=${spinach.id} bread=${bread.id}`
);

// ===========================================================================
// Tests
// ===========================================================================

// -- 1. Auth gate -----------------------------------------------------------
section('1. Auth gate');
{
  const res = await api('GET', '/recipes');
  check('GET /recipes without token -> 401', res.status === 401, `got ${res.status}`);

  const bad = await api('GET', '/recipes', { token: 'not-a-real-token' });
  check('GET /recipes with bad token -> 401', bad.status === 401, `got ${bad.status}`);
}

// -- 2. Recipe catalogue loaded ---------------------------------------------
section('2. Recipe catalogue');
let catalogueSize = 0;
{
  // Use show-all mode (includeUnmatched=true, maxMissing=99) to see everything
  const res = await api('GET', '/recipes?includeUnmatched=true&maxMissing=99', {
    token: A.token,
  });
  check('GET /recipes -> 200', res.status === 200, `got ${res.status}: ${res.raw}`);
  const recipes = res.body?.recipes ?? [];
  catalogueSize = res.body?.summary?.catalogueSize ?? 0;
  check('catalogue has 24 recipes', catalogueSize === 24, `got ${catalogueSize}`);
  check('response includes summary', Boolean(res.body?.summary), JSON.stringify(res.body?.summary));
  check(
    'summary.itemsUsable > 0 (has non-expired items)',
    (res.body?.summary?.itemsUsable ?? 0) > 0,
    `got ${res.body?.summary?.itemsUsable}`
  );
}

// -- 3. Ranking and scoring -------------------------------------------------
section('3. Ranking and scoring');
let ranked;
{
  const res = await api('GET', '/recipes?maxMissing=99&includeUnmatched=true', {
    token: A.token,
  });
  ranked = res.body?.recipes ?? [];

  check('recipes are returned', ranked.length > 0, `got ${ranked.length}`);

  // Aloo Gobi uses potato, cauliflower(!), onion, tomato.
  // User A has tomato, potato, onion (3 of 4 core) -> should be ranked
  // well but not top because cauliflower is missing.
  const alooGobi = ranked.find((r) => r.title === 'Aloo Gobi');
  check('Aloo Gobi is in the list', Boolean(alooGobi), 'not found');
  if (alooGobi) {
    check(
      'Aloo Gobi has 3/4 core ingredients (potato, onion, tomato)',
      alooGobi.match?.haveCount === 3,
      `got ${alooGobi.match?.haveCount}`
    );
    check(
      'Aloo Gobi has 1 missing (cauliflower)',
      alooGobi.match?.missingCount === 1,
      `got ${alooGobi.match?.missingCount}`
    );
    check(
      'Aloo Gobi score > 0',
      alooGobi.match?.score > 0,
      `got ${alooGobi.match?.score}`
    );
  }

  // Tomato Rasam uses tomato, toor dal, tamarind.
  // User A has only tomato (1 of 3) -> lower score than Aloo Gobi.
  const rasam = ranked.find((r) => r.title === 'Tomato Rasam');
  if (rasam && alooGobi) {
    check(
      'Aloo Gobi scores higher than Tomato Rasam (3 ingredients vs 1)',
      alooGobi.match.score >= rasam.match.score,
      `alooGobi=${alooGobi.match.score} rasam=${rasam.match.score}`
    );
  }

  // Mixed Vegetable Sabzi uses potato, carrot, beans, peas, capsicum, onion.
  // User A has potato and onion (2 of 6) -> lower coverage.
  const mixVeg = ranked.find((r) => r.title === 'Mixed Vegetable Sabzi');
  if (mixVeg) {
    check(
      'Mixed Vegetable Sabzi has 2/6 ingredients',
      mixVeg.match?.haveCount === 2,
      `got ${mixVeg.match?.haveCount}`
    );
  }

  // Check that expired bread is excluded from matching.
  const grilledCheese = ranked.find((r) => r.title === 'Grilled Cheese Sandwich');
  if (grilledCheese) {
    // Grilled cheese needs bread, cheese, butter, tomato.
    // User A has bread (EXPIRED) and tomato. Bread should NOT count.
    check(
      'Grilled Cheese: expired bread does NOT count as "have"',
      grilledCheese.match?.haveCount <= 1, // only tomato at most
      `haveCount=${grilledCheese.match?.haveCount} missing=${grilledCheese.match?.missing}`
    );
  }

  // Expiry-priority: tomato expires tomorrow (NEAR_EXPIRY), so recipes using
  // tomato should have expiringCount > 0.
  const palakPaneer = ranked.find((r) => r.title === 'Palak Paneer');
  if (palakPaneer) {
    check(
      'Palak Paneer has expiringCount > 0 (tomato expires tomorrow)',
      (palakPaneer.match?.expiringCount ?? 0) > 0,
      `expiringCount=${palakPaneer.match?.expiringCount}`
    );
  }
}

// -- 4. Filtering: onlyExpiring ---------------------------------------------
section('4. Filter: onlyExpiring');
{
  const res = await api('GET', '/recipes?onlyExpiring=true&maxMissing=99', {
    token: A.token,
  });
  const recipes = res.body?.recipes ?? [];
  check(
    'onlyExpiring returns recipes that use expiring items',
    recipes.length > 0,
    `got ${recipes.length}`
  );
  // Every recipe in this list should have expiringCount > 0
  const allHaveExpiring = recipes.every((r) => r.match?.expiringCount > 0);
  check(
    'all recipes in onlyExpiring have expiringCount > 0',
    allHaveExpiring,
    `some recipes have expiringCount=0`
  );
}

// -- 5. Filtering: search ---------------------------------------------------
section('5. Filter: search');
{
  const res = await api('GET', '/recipes?search=palak&maxMissing=99', {
    token: A.token,
  });
  const recipes = res.body?.recipes ?? [];
  check(
    'search "palak" returns Palak Paneer',
    recipes.some((r) => r.title === 'Palak Paneer'),
    `got: ${recipes.map((r) => r.title).join(', ')}`
  );
  check(
    'search "palak" does NOT return Aloo Gobi',
    !recipes.some((r) => r.title === 'Aloo Gobi'),
    `got: ${recipes.map((r) => r.title).join(', ')}`
  );
}

// -- 6. Filtering: maxMissing -----------------------------------------------
section('6. Filter: maxMissing');
{
  const strict = await api('GET', '/recipes?maxMissing=0&includeUnmatched=false', {
    token: A.token,
  });
  const loose = await api('GET', '/recipes?maxMissing=99&includeUnmatched=true', {
    token: A.token,
  });
  check(
    'maxMissing=0 returns fewer or equal recipes than maxMissing=99',
    (strict.body?.recipes?.length ?? 0) <= (loose.body?.recipes?.length ?? 0),
    `strict=${strict.body?.recipes?.length} loose=${loose.body?.recipes?.length}`
  );
  // All recipes with maxMissing=0 should have missingCount === 0
  const allCookable = (strict.body?.recipes ?? []).every((r) => r.match?.missingCount === 0);
  check(
    'maxMissing=0: all recipes have missingCount=0',
    allCookable,
    JSON.stringify(
      (strict.body?.recipes ?? [])
        .filter((r) => r.match?.missingCount > 0)
        .map((r) => `${r.title}: missing=${r.match.missingCount}`)
    )
  );
}

// -- 7. Single recipe detail ------------------------------------------------
section('7. GET /recipes/:id');
let firstRecipeId;
{
  // Get the first recipe from the catalogue
  const list = await api('GET', '/recipes?includeUnmatched=true&maxMissing=99&limit=1', {
    token: A.token,
  });
  firstRecipeId = list.body?.recipes?.[0]?.id;
  check('have a recipe id to test with', Boolean(firstRecipeId), JSON.stringify(list.body?.recipes?.[0]));

  if (firstRecipeId) {
    const res = await api('GET', `/recipes/${firstRecipeId}`, { token: A.token });
    check('GET /recipes/:id -> 200', res.status === 200, `got ${res.status}: ${res.raw}`);
    check('response has recipe object', Boolean(res.body?.recipe), JSON.stringify(res.body));
    check(
      'recipe has match data',
      Boolean(res.body?.recipe?.match),
      JSON.stringify(res.body?.recipe?.match)
    );
    check(
      'recipe has instructions',
      Boolean(res.body?.recipe?.instructions),
      `got ${typeof res.body?.recipe?.instructions}`
    );
    check(
      'recipe has ingredients array',
      Array.isArray(res.body?.recipe?.ingredients),
      `got ${typeof res.body?.recipe?.ingredients}`
    );
  }
}

{
  const res = await api('GET', '/recipes/99999', { token: A.token });
  check('GET /recipes/:id for non-existent -> 404', res.status === 404, `got ${res.status}`);
}

{
  const res = await api('GET', '/recipes/abc', { token: A.token });
  check('GET /recipes/:id with non-numeric -> 400', res.status === 400, `got ${res.status}`);
}

// -- 8. Cook action (methodology step 11) -----------------------------------
section('8. POST /recipes/:id/cook (consume matched items)');

// Find a recipe that matches at least one item we can consume.
// Tomato Rasam uses tomato + toor dal + tamarind. User A has only tomato.
// That's enough for the cook test.
let rasamId;
{
  const list = await api('GET', '/recipes?maxMissing=99&includeUnmatched=true', {
    token: A.token,
  });
  const rasam = (list.body?.recipes ?? []).find((r) => r.title === 'Tomato Rasam');
  rasamId = rasam?.id;
}

if (rasamId) {
  // Pre-check: tomato is not consumed
  const preList = await api('GET', '/food-items?includeConsumed=true', { token: A.token });
  const preTomato = preList.body?.items?.find((i) => i.id === tomato.id);
  check('tomato is not consumed before cook', preTomato?.isConsumed === false, JSON.stringify(preTomato));

  const res = await api('POST', `/recipes/${rasamId}/cook`, { token: A.token });
  check('POST /recipes/:id/cook -> 200', res.status === 200, `got ${res.status}: ${res.raw}`);
  check('consumedCount >= 1', (res.body?.consumedCount ?? 0) >= 1, `got ${res.body?.consumedCount}`);
  check('response has consumed array', Array.isArray(res.body?.consumed), JSON.stringify(res.body?.consumed));
  check('response has updated recipe with match', Boolean(res.body?.recipe?.match), '');

  // Post-check: tomato should now be consumed
  const postList = await api('GET', '/food-items?includeConsumed=true', { token: A.token });
  const postTomato = postList.body?.items?.find((i) => i.id === tomato.id);
  check('tomato is consumed after cook', postTomato?.isConsumed === true, JSON.stringify(postTomato));

  // Cooking again should either consume 0 items or fail gracefully
  const res2 = await api('POST', `/recipes/${rasamId}/cook`, { token: A.token });
  // If all matched items are already consumed, should return consumedCount=0 or error
  check(
    'cooking again returns 0 consumed or error',
    res2.status === 200 || res2.status === 400,
    `got ${res2.status}: ${res2.raw}`
  );

  // Undo: mark tomato as not consumed for remaining tests
  await api('POST', `/food-items/${tomato.id}/consume`, {
    token: A.token,
    body: { consumed: false },
  });
} else {
  console.log('  SKIP  Tomato Rasam not found in catalogue');
}

// -- 9. Cook: recipe with no matching ingredients ---------------------------
section('9. Cook: no matching ingredients');
{
  // Find a recipe where user A has 0 ingredients
  // (hard to guarantee, so use a non-existent recipe id)
  const res = await api('POST', '/recipes/99999/cook', { token: A.token });
  check('POST /recipes/:id/cook for non-existent -> 404', res.status === 404, `got ${res.status}`);
}

// -- 10. Cross-user isolation -----------------------------------------------
section('10. Cross-user isolation (user B vs user A)');
{
  const res = await api('GET', '/recipes', { token: B.token });
  check('B sees recipes (empty kitchen)', res.status === 200, `got ${res.status}`);
  check(
    'B has 0 usable items',
    res.body?.summary?.itemsUsable === 0,
    `got ${res.body?.summary?.itemsUsable}`
  );
  // B should see all recipes but with 0 match (empty kitchen)
  const recipes = res.body?.recipes ?? [];
  if (recipes.length > 0) {
    check(
      'B recipes all have score 0 (empty kitchen)',
      recipes.every((r) => r.match?.score === 0),
      `scores: ${recipes.slice(0, 3).map((r) => r.match?.score).join(', ')}`
    );
  }
}

{
  // B tries to cook A's recipe with A's items
  if (rasamId) {
    const res = await api('POST', `/recipes/${rasamId}/cook`, { token: B.token });
    // B has no matching ingredients, so should get 400
    check(
      'B cooks recipe with no ingredients -> 400',
      res.status === 400,
      `got ${res.status}: ${res.raw}`
    );
  }

  // B's inventory is still empty
  const bList = await api('GET', '/food-items', { token: B.token });
  check("B's inventory is still empty", bList.body?.items?.length === 0, `got ${bList.body?.items?.length}`);
}

// -- 11. Summary data -------------------------------------------------------
section('11. Summary data in response');
{
  const res = await api('GET', '/recipes?maxMissing=99&includeUnmatched=true', {
    token: A.token,
  });
  const s = res.body?.summary;
  check('summary.catalogueSize is number', typeof s?.catalogueSize === 'number', `got ${s?.catalogueSize}`);
  check('summary.itemsInKitchen is number', typeof s?.itemsInKitchen === 'number', `got ${s?.itemsInKitchen}`);
  check('summary.itemsUsable is number', typeof s?.itemsUsable === 'number', `got ${s?.itemsUsable}`);
  check('summary.itemsExpired is number', typeof s?.itemsExpired === 'number', `got ${s?.itemsExpired}`);
  check('summary.itemsExpiringSoon is number', typeof s?.itemsExpiringSoon === 'number', `got ${s?.itemsExpiringSoon}`);
  check('summary.topScore is number', typeof s?.topScore === 'number', `got ${s?.topScore}`);
  check('summary.filters is object', Boolean(s?.filters), JSON.stringify(s?.filters));

  // itemsExpired should be 1 (the bread)
  check('summary.itemsExpired = 1', s?.itemsExpired === 1, `got ${s?.itemsExpired}`);
  // itemsExpiringSoon should be >= 2 (tomato + milk expire tomorrow)
  check(
    'summary.itemsExpiringSoon >= 2',
    (s?.itemsExpiringSoon ?? 0) >= 2,
    `got ${s?.itemsExpiringSoon}`
  );
}

// -- 12. Cleanup ------------------------------------------------------------
section('12. Cleanup');
{
  // Remove all items for user A
  const list = await api('GET', '/food-items?includeConsumed=true', { token: A.token });
  for (const item of list.body?.items ?? []) {
    await api('DELETE', `/food-items/${item.id}`, { token: A.token });
  }
  const after = await api('GET', '/food-items?includeConsumed=true', { token: A.token });
  check('all test items removed', after.body?.items?.length === 0, `${after.body?.items?.length} left`);
  console.log(`  NOTE  test users ${A.email} / ${B.email} left in the users table`);
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
console.log('='.repeat(60));
process.exit(failed === 0 ? 0 : 1);
