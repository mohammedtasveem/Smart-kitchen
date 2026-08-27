/**
 * Phase 5 end-to-end tests -- food inventory CRUD.
 *
 * Hits a RUNNING server against the real database. Start the server first:
 *
 *   npm run dev            # terminal 1
 *   node tests/phase5-e2e.mjs   # terminal 2
 *
 * Creates two throwaway users per run (timestamped emails) and deletes every
 * item it made, so it is safe to re-run. The point of two users is the
 * isolation block at the end: user B must not be able to see, edit or delete
 * anything belonging to user A.
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
  const email = `phase5-${tag}-${Date.now()}@test.local`;
  const res = await api('POST', '/auth/signup', {
    body: { name: `Phase5 ${tag}`, email, password: 'TestPass123' },
  });
  if (res.status !== 201) {
    throw new Error(`signup failed (${res.status}): ${res.raw}`);
  }
  return { token: res.body.token, id: res.body.user.id, email };
}

// ---------------------------------------------------------------------------

console.log('Phase 5 E2E -- food inventory CRUD');
console.log(`Base: ${BASE}`);

const health = await api('GET', '/health/db');
if (health.status !== 200) {
  console.error(`\nDatabase not reachable: ${health.raw}`);
  process.exit(1);
}

const A = await signup('a');
const B = await signup('b');
console.log(`Users: A=${A.id}  B=${B.id}`);

const TODAY = dateOffset(0);
const NEAR = dateOffset(1);
const FAR = dateOffset(60);
const PAST = dateOffset(-2);

// -- Auth gate ---------------------------------------------------------------
section('1. Auth gate');
{
  const res = await api('GET', '/food-items');
  check('GET /food-items without a token -> 401', res.status === 401, `got ${res.status}`);

  const bad = await api('GET', '/food-items', { token: 'not-a-real-token' });
  check('GET /food-items with a garbage token -> 401', bad.status === 401, `got ${bad.status}`);
}

// -- Create ------------------------------------------------------------------
section('2. Create + computed expiry status');
let milk;
let rice;
let bread;
{
  const res = await api('POST', '/food-items', {
    token: A.token,
    body: {
      name: 'Milk',
      category: 'Dairy',
      quantity: 1.5,
      unit: 'litre',
      purchaseDate: TODAY,
      expiryDate: NEAR,
      notes: 'use by tomorrow',
    },
  });
  milk = res.body?.item;
  check('POST milk -> 201', res.status === 201, `got ${res.status}: ${res.raw}`);
  check('status is NEAR_EXPIRY', milk?.expiryStatus === 'NEAR_EXPIRY', `got ${milk?.expiryStatus}`);
  check('daysLeft is 1', milk?.daysLeft === 1, `got ${milk?.daysLeft}`);
  check(
    `expiryDate returned unshifted (${NEAR})`,
    milk?.expiryDate === NEAR,
    `sent ${NEAR}, got ${milk?.expiryDate}`
  );
  check(
    'quantity is a number, not a DECIMAL string',
    typeof milk?.quantity === 'number' && milk.quantity === 1.5,
    `got ${JSON.stringify(milk?.quantity)} (${typeof milk?.quantity})`
  );
  check('isConsumed defaults to false', milk?.isConsumed === false, `got ${milk?.isConsumed}`);
  check('source defaults to "manual"', milk?.source === 'manual', `got ${milk?.source}`);
}
{
  const res = await api('POST', '/food-items', {
    token: A.token,
    body: { name: 'Rice', category: 'Grains', quantity: 5, unit: 'kg', expiryDate: FAR },
  });
  rice = res.body?.item;
  check('POST rice (60 days out) -> FRESH', rice?.expiryStatus === 'FRESH', `got ${rice?.expiryStatus}`);
  check('daysLeft is 60', rice?.daysLeft === 60, `got ${rice?.daysLeft}`);
  check('optional purchaseDate stays null', rice?.purchaseDate === null, `got ${rice?.purchaseDate}`);
}
{
  const res = await api('POST', '/food-items', {
    token: A.token,
    body: { name: 'Bread', category: 'Bakery', expiryDate: PAST },
  });
  bread = res.body?.item;
  check('POST bread (2 days ago) -> EXPIRED', bread?.expiryStatus === 'EXPIRED', `got ${bread?.expiryStatus}`);
  check('daysLeft is -2', bread?.daysLeft === -2, `got ${bread?.daysLeft}`);
  check('quantity defaults to 1', bread?.quantity === 1, `got ${bread?.quantity}`);
  check('unit defaults to "pcs"', bread?.unit === 'pcs', `got ${bread?.unit}`);
}

// -- Validation --------------------------------------------------------------
section('3. Validation');
{
  const res = await api('POST', '/food-items', {
    token: A.token,
    body: { name: '', quantity: 0, expiryDate: 'not-a-date', unit: 'x'.repeat(30) },
  });
  const d = res.body?.details ?? {};
  check('bad create -> 400', res.status === 400, `got ${res.status}`);
  check(
    'all four field errors come back at once',
    Boolean(d.name && d.quantity && d.expiryDate && d.unit),
    `got keys: ${Object.keys(d).join(', ')}`
  );
}
{
  const res = await api('POST', '/food-items', {
    token: A.token,
    body: { name: 'Ghost', expiryDate: '2026-02-30' },
  });
  check(
    'impossible calendar date (2026-02-30) -> 400',
    res.status === 400 && Boolean(res.body?.details?.expiryDate),
    `got ${res.status}: ${res.raw}`
  );
}
{
  const res = await api('POST', '/food-items', {
    token: A.token,
    body: { name: 'Backwards', purchaseDate: FAR, expiryDate: TODAY },
  });
  check(
    'purchaseDate after expiryDate -> 400',
    res.status === 400 && Boolean(res.body?.details?.purchaseDate),
    `got ${res.status}: ${res.raw}`
  );
}
{
  const res = await api('GET', '/food-items?status=SOMEDAY', { token: A.token });
  check('unknown ?status value -> 400', res.status === 400, `got ${res.status}`);
}
{
  const res = await api('GET', '/food-items/abc', { token: A.token });
  check('non-numeric :id -> 400', res.status === 400, `got ${res.status}: ${res.raw}`);
}

// -- List + filters ----------------------------------------------------------
section('4. List, sort and filters');
{
  const res = await api('GET', '/food-items', { token: A.token });
  const items = res.body?.items ?? [];
  check('GET list -> 200', res.status === 200, `got ${res.status}`);
  check('3 items for user A', items.length === 3, `got ${items.length}`);
  check(
    'sorted soonest-expiry first (Bread, Milk, Rice)',
    items.map((i) => i.name).join(',') === 'Bread,Milk,Rice',
    `got ${items.map((i) => i.name).join(',')}`
  );
  check('total matches count', res.body?.total === 3, `got ${res.body?.total}`);
}
{
  const res = await api('GET', '/food-items?status=NEAR_EXPIRY', { token: A.token });
  check(
    'filter status=NEAR_EXPIRY -> only Milk',
    res.body?.items?.length === 1 && res.body.items[0].name === 'Milk',
    JSON.stringify(res.body?.items?.map((i) => i.name))
  );
}
{
  const res = await api('GET', '/food-items?status=EXPIRED', { token: A.token });
  check(
    'filter status=EXPIRED -> only Bread',
    res.body?.items?.length === 1 && res.body.items[0].name === 'Bread',
    JSON.stringify(res.body?.items?.map((i) => i.name))
  );
}
{
  const res = await api('GET', '/food-items?q=ic', { token: A.token });
  check(
    'search q=ic -> Rice',
    res.body?.items?.length === 1 && res.body.items[0].name === 'Rice',
    JSON.stringify(res.body?.items?.map((i) => i.name))
  );
}
{
  const res = await api('GET', '/food-items?category=Dairy', { token: A.token });
  check(
    'filter category=Dairy -> Milk',
    res.body?.items?.length === 1 && res.body.items[0].name === 'Milk',
    JSON.stringify(res.body?.items?.map((i) => i.name))
  );
}
{
  const res = await api('GET', '/food-items?limit=2', { token: A.token });
  check(
    'limit=2 returns 2 rows but total stays 3',
    res.body?.items?.length === 2 && res.body?.total === 3,
    `count=${res.body?.items?.length} total=${res.body?.total}`
  );
}

// -- Summary -----------------------------------------------------------------
section('5. Dashboard summary');
{
  const res = await api('GET', '/food-items/summary', { token: A.token });
  const s = res.body?.summary;
  check('GET /summary -> 200 (not treated as an :id)', res.status === 200, `got ${res.status}: ${res.raw}`);
  check('fresh = 1', s?.fresh === 1, `got ${s?.fresh}`);
  check('nearExpiry = 1', s?.nearExpiry === 1, `got ${s?.nearExpiry}`);
  check('expired = 1', s?.expired === 1, `got ${s?.expired}`);
  check('totalActive = 3', s?.totalActive === 3, `got ${s?.totalActive}`);
  check('needsAttention = 2', s?.needsAttention === 2, `got ${s?.needsAttention}`);
  check(
    'categories listed alphabetically',
    JSON.stringify(s?.categories) === JSON.stringify(['Bakery', 'Dairy', 'Grains']),
    JSON.stringify(s?.categories)
  );
}
{
  const res = await api('GET', '/food-items/summary', { token: B.token });
  const s = res.body?.summary;
  check(
    "user B's summary is all zeros",
    s?.totalActive === 0 && s?.fresh === 0 && s?.categories?.length === 0,
    JSON.stringify(s)
  );
}

// -- Read one + update -------------------------------------------------------
section('6. Read one and update');
{
  const res = await api('GET', `/food-items/${milk.id}`, { token: A.token });
  check('GET /:id -> 200', res.status === 200 && res.body?.item?.id === milk.id, `got ${res.status}`);
}
{
  const res = await api('PATCH', `/food-items/${milk.id}`, {
    token: A.token,
    body: { quantity: 0.75, notes: 'half left' },
  });
  check('PATCH quantity + notes -> 200', res.status === 200, `got ${res.status}: ${res.raw}`);
  check('quantity updated to 0.75', res.body?.item?.quantity === 0.75, `got ${res.body?.item?.quantity}`);
  check('notes updated', res.body?.item?.notes === 'half left', `got ${res.body?.item?.notes}`);
  check('untouched fields preserved', res.body?.item?.name === 'Milk', `got ${res.body?.item?.name}`);
}
{
  const res = await api('PATCH', `/food-items/${rice.id}`, {
    token: A.token,
    body: { expiryDate: NEAR },
  });
  check(
    'PATCH expiryDate re-computes status FRESH -> NEAR_EXPIRY',
    res.body?.item?.expiryStatus === 'NEAR_EXPIRY',
    `got ${res.body?.item?.expiryStatus}`
  );
  // put it back so later assertions still hold
  await api('PATCH', `/food-items/${rice.id}`, { token: A.token, body: { expiryDate: FAR } });
}
{
  // Milk already has purchaseDate = TODAY. Moving only the expiry into the past
  // must be rejected by the merged cross-field check.
  const res = await api('PATCH', `/food-items/${milk.id}`, {
    token: A.token,
    body: { expiryDate: PAST },
  });
  check(
    'PATCH expiry before the stored purchase date -> 400 (merged check)',
    res.status === 400 && Boolean(res.body?.details?.purchaseDate),
    `got ${res.status}: ${res.raw}`
  );
}
{
  const res = await api('PATCH', `/food-items/${milk.id}`, { token: A.token, body: {} });
  check('empty PATCH -> 400', res.status === 400, `got ${res.status}`);
}
{
  const res = await api('PATCH', `/food-items/${milk.id}`, {
    token: A.token,
    body: { userId: 9999, isConsumed: true },
  });
  check(
    'PATCH with only unknown fields -> 400 (no column injection)',
    res.status === 400,
    `got ${res.status}: ${res.raw}`
  );
}

// -- Consume -----------------------------------------------------------------
section('7. Consume / un-consume (Methodology step 11)');
{
  const res = await api('POST', `/food-items/${bread.id}/consume`, { token: A.token });
  check('POST /:id/consume -> 200', res.status === 200, `got ${res.status}: ${res.raw}`);
  check('isConsumed is true', res.body?.item?.isConsumed === true, `got ${res.body?.item?.isConsumed}`);

  const list = await api('GET', '/food-items', { token: A.token });
  check(
    'consumed item drops out of the default list',
    list.body?.items?.every((i) => i.name !== 'Bread'),
    JSON.stringify(list.body?.items?.map((i) => i.name))
  );

  const withConsumed = await api('GET', '/food-items?includeConsumed=true', { token: A.token });
  check(
    'includeConsumed=true brings it back',
    withConsumed.body?.items?.length === 3,
    `got ${withConsumed.body?.items?.length}`
  );

  const sum = await api('GET', '/food-items/summary', { token: A.token });
  check('summary: expired back to 0', sum.body?.summary?.expired === 0, `got ${sum.body?.summary?.expired}`);
  check('summary: consumed = 1', sum.body?.summary?.consumed === 1, `got ${sum.body?.summary?.consumed}`);
}
{
  const res = await api('POST', `/food-items/${bread.id}/consume`, {
    token: A.token,
    body: { consumed: false },
  });
  check('consume { consumed: false } undoes it', res.body?.item?.isConsumed === false, `got ${res.body?.item?.isConsumed}`);
}
{
  const res = await api('POST', `/food-items/${bread.id}/consume`, {
    token: A.token,
    body: { consumed: 'yes' },
  });
  check('consume with a non-boolean -> 400', res.status === 400, `got ${res.status}`);
}

// -- Cross-user isolation ----------------------------------------------------
section('8. Cross-user isolation (user B vs user A\'s items)');
{
  const res = await api('GET', '/food-items', { token: B.token });
  check("B's list is empty", res.body?.items?.length === 0, `got ${res.body?.items?.length}`);
}
{
  const res = await api('GET', `/food-items/${milk.id}`, { token: B.token });
  check("B GET A's item -> 404 (not 403, no existence leak)", res.status === 404, `got ${res.status}`);
}
{
  const res = await api('PATCH', `/food-items/${milk.id}`, {
    token: B.token,
    body: { name: 'Hacked' },
  });
  check("B PATCH A's item -> 404", res.status === 404, `got ${res.status}`);

  const still = await api('GET', `/food-items/${milk.id}`, { token: A.token });
  check("A's item name is untouched", still.body?.item?.name === 'Milk', `got ${still.body?.item?.name}`);
}
{
  const res = await api('POST', `/food-items/${milk.id}/consume`, { token: B.token });
  check("B consume A's item -> 404", res.status === 404, `got ${res.status}`);
}
{
  const res = await api('DELETE', `/food-items/${milk.id}`, { token: B.token });
  check("B DELETE A's item -> 404", res.status === 404, `got ${res.status}`);

  const still = await api('GET', `/food-items/${milk.id}`, { token: A.token });
  check("A's item still exists after B's delete attempt", still.status === 200, `got ${still.status}`);
}

// -- Delete ------------------------------------------------------------------
section('9. Delete');
{
  const res = await api('DELETE', `/food-items/${milk.id}`, { token: A.token });
  check('A deletes own item -> 200', res.status === 200, `got ${res.status}: ${res.raw}`);

  const gone = await api('GET', `/food-items/${milk.id}`, { token: A.token });
  check('deleted item -> 404', gone.status === 404, `got ${gone.status}`);

  const twice = await api('DELETE', `/food-items/${milk.id}`, { token: A.token });
  check('deleting it again -> 404', twice.status === 404, `got ${twice.status}`);
}

// -- Cleanup -----------------------------------------------------------------
section('10. Cleanup');
{
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
