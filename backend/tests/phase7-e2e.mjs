/**
 * Phase 7 end-to-end tests -- expiry sweep + notifications.
 *
 * Hits a RUNNING server against the real database. Start the server first:
 *
 *   npm run dev                 # terminal 1
 *   node tests/phase7-e2e.mjs   # terminal 2
 *
 * Three throwaway users per run, one per WhatsApp routing case:
 *
 *   A -- phone + opted in   -> alerts must be channel 'whatsapp', status 'pending'
 *   B -- phone + opted OUT  -> alerts must be channel 'in_app',  status 'sent'
 *   C -- no phone at all    -> alerts must be channel 'in_app',  status 'sent'
 *
 * Every user's items are deleted at the end, so re-running is safe and the real
 * demo account's data is never touched. The three accounts themselves are left
 * behind (there is no delete-account endpoint) -- clear them out with
 * `npm run test:cleanup`.
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

async function signup(tag, extra = {}) {
  const email = `phase7-${tag}-${Date.now()}@test.local`;
  const res = await api('POST', '/auth/signup', {
    body: { name: `Phase7 ${tag}`, email, password: 'TestPass123', ...extra },
  });
  if (res.status !== 201) {
    throw new Error(`signup failed (${res.status}): ${res.raw}`);
  }
  return { token: res.body.token, id: res.body.user.id, email };
}

async function addItem(token, body) {
  const res = await api('POST', '/food-items', { token, body });
  if (res.status !== 201) throw new Error(`add item failed (${res.status}): ${res.raw}`);
  return res.body.item;
}

/** All of one user's alerts, newest first. */
async function alertsOf(token, qs = '') {
  const res = await api('GET', `/notifications${qs}`, { token });
  return res.body?.notifications ?? [];
}

function findAlert(list, itemId) {
  return list.find((n) => n.foodItemId === itemId) ?? null;
}

// ---------------------------------------------------------------------------

console.log('Phase 7 E2E -- expiry sweep + notifications');
console.log(`Base: ${BASE}`);

const health = await api('GET', '/health/db');
if (health.status !== 200) {
  console.error(`\nDatabase not reachable: ${health.raw}`);
  process.exit(1);
}

// A: reachable on WhatsApp. B: has a number but opted out. C: no number.
const A = await signup('a', { phone: `+9198${String(Date.now()).slice(-8)}` });
const B = await signup('b', { phone: `+9197${String(Date.now()).slice(-8)}` });
const C = await signup('c');

await api('PATCH', '/auth/me', { token: A.token, body: { whatsappOptIn: true } });
await api('PATCH', '/auth/me', { token: B.token, body: { whatsappOptIn: false } });

console.log(`Users: A=${A.id} (whatsapp)  B=${B.id} (opted out)  C=${C.id} (no phone)`);

const TODAY = dateOffset(0);
const TOMORROW = dateOffset(1);
const IN_3 = dateOffset(3);
const IN_30 = dateOffset(30);
const YESTERDAY = dateOffset(-1);
const LONG_GONE = dateOffset(-40); // outside any sane grace window

// -- Auth gate ---------------------------------------------------------------
section('1. Auth gate');
{
  for (const [method, path] of [
    ['GET', '/notifications'],
    ['GET', '/notifications/summary'],
    ['POST', '/notifications/check'],
  ]) {
    const res = await api(method, path);
    check(`${method} ${path} without a token -> 401`, res.status === 401, `got ${res.status}`);
  }

  const bad = await api('GET', '/notifications', { token: 'not-a-real-token' });
  check('GET /notifications with a garbage token -> 401', bad.status === 401, `got ${bad.status}`);
}

// -- What the sweep selects --------------------------------------------------
section('2. Which items raise an alert');

const items = {};
{
  items.today = await addItem(A.token, { name: 'P7 Bread', unit: 'packet', expiryDate: TODAY });
  items.tomorrow = await addItem(A.token, {
    name: 'P7 Milk',
    quantity: 2,
    unit: 'litre',
    expiryDate: TOMORROW,
  });
  items.in3 = await addItem(A.token, { name: 'P7 Paneer', quantity: 250, unit: 'g', expiryDate: IN_3 });
  items.fresh = await addItem(A.token, { name: 'P7 Rice', quantity: 5, unit: 'kg', expiryDate: IN_30 });
  items.expired = await addItem(A.token, { name: 'P7 Tomatoes', unit: 'kg', expiryDate: YESTERDAY });
  items.ancient = await addItem(A.token, { name: 'P7 Ancient', expiryDate: LONG_GONE });
  items.consumed = await addItem(A.token, { name: 'P7 Eaten', expiryDate: TOMORROW });
  await api('POST', `/food-items/${items.consumed.id}/consume`, { token: A.token });

  const res = await api('POST', '/notifications/check', { token: A.token });
  check('POST /notifications/check -> 200', res.status === 200, `got ${res.status}: ${res.raw}`);

  const r = res.body?.result;
  check('sweep reports today\'s date', r?.today === TODAY, `got ${r?.today}`);
  check(
    'created 4 alerts (3 near expiry + 1 expired)',
    r?.created === 4,
    `got ${r?.created} (near=${r?.nearExpiry} expired=${r?.expired})`
  );
  check('nearExpiry = 3', r?.nearExpiry === 3, `got ${r?.nearExpiry}`);
  check('expired = 1', r?.expired === 1, `got ${r?.expired}`);
  check('response carries the refreshed list', Array.isArray(res.body?.notifications), 'missing');

  const list = await alertsOf(A.token);
  check('FRESH item raises no alert', findAlert(list, items.fresh.id) === null, 'P7 Rice was alerted');
  check(
    'item expired beyond the grace window raises no alert',
    findAlert(list, items.ancient.id) === null,
    'P7 Ancient was alerted'
  );
  check(
    'consumed item raises no alert',
    findAlert(list, items.consumed.id) === null,
    'P7 Eaten was alerted'
  );
}

// -- Type + wording ----------------------------------------------------------
section('3. Alert type and wording');
{
  const list = await alertsOf(A.token);

  const cases = [
    [items.today, 'near_expiry', 'P7 Bread (1 packet) expires today'],
    [items.tomorrow, 'near_expiry', 'P7 Milk (2 litre) expires tomorrow'],
    [items.in3, 'near_expiry', 'P7 Paneer (250 g) expires in 3 days'],
    [items.expired, 'expired', 'P7 Tomatoes (1 kg) expired yesterday'],
  ];

  for (const [item, type, message] of cases) {
    const alert = findAlert(list, item.id);
    check(`${item.name}: type '${type}'`, alert?.type === type, `got ${alert?.type}`);
    check(`${item.name}: message "${message}"`, alert?.message === message, `got "${alert?.message}"`);
    check(`${item.name}: notifyDate is today`, alert?.notifyDate === TODAY, `got ${alert?.notifyDate}`);
  }

  check(
    'quantity 1.00 renders as "1", not "1.00"',
    !list.some((n) => n.message.includes('1.00')),
    list.find((n) => n.message.includes('1.00'))?.message
  );
}

// -- Idempotency -------------------------------------------------------------
section('4. Idempotency (the whole point of the dedupe key)');
{
  const before = await alertsOf(A.token);

  const second = await api('POST', '/notifications/check', { token: A.token });
  check('second sweep the same day creates 0', second.body?.result?.created === 0, `got ${second.body?.result?.created}`);
  check('second sweep scans 0 (dedupe filters before insert)', second.body?.result?.scanned === 0, `got ${second.body?.result?.scanned}`);

  const third = await api('POST', '/notifications/check', { token: A.token });
  check('third sweep still creates 0', third.body?.result?.created === 0, `got ${third.body?.result?.created}`);

  const after = await alertsOf(A.token);
  check(
    'alert count unchanged after three sweeps',
    after.length === before.length,
    `${before.length} -> ${after.length}`
  );
}

// -- Channel routing ---------------------------------------------------------
section('5. Channel routing by WhatsApp reachability');
{
  const list = await alertsOf(A.token);
  const alert = findAlert(list, items.tomorrow.id);
  check("A (phone + opted in): channel 'whatsapp'", alert?.channel === 'whatsapp', `got ${alert?.channel}`);
  check("A: status 'pending' -- waiting for Phase 8", alert?.status === 'pending', `got ${alert?.status}`);
  check('A: sentAt is null while pending', alert?.sentAt === null, `got ${alert?.sentAt}`);
}
{
  const item = await addItem(B.token, { name: 'B Milk', expiryDate: TOMORROW });
  await api('POST', '/notifications/check', { token: B.token });

  const alert = findAlert(await alertsOf(B.token), item.id);
  check("B (opted out): channel 'in_app'", alert?.channel === 'in_app', `got ${alert?.channel}`);
  check("B: status 'sent' -- nothing is queued for WhatsApp", alert?.status === 'sent', `got ${alert?.status}`);
  check('B: sentAt is set', Boolean(alert?.sentAt), `got ${alert?.sentAt}`);
}
{
  const item = await addItem(C.token, { name: 'C Milk', expiryDate: TOMORROW });
  await api('POST', '/notifications/check', { token: C.token });

  const alert = findAlert(await alertsOf(C.token), item.id);
  check("C (no phone): channel 'in_app'", alert?.channel === 'in_app', `got ${alert?.channel}`);
  check("C: status 'sent'", alert?.status === 'sent', `got ${alert?.status}`);
}
{
  // Adding a number and opting in must change routing from the next sweep on.
  await api('PATCH', '/auth/me', {
    token: C.token,
    body: { phone: `+9196${String(Date.now()).slice(-8)}`, whatsappOptIn: true },
  });
  const item = await addItem(C.token, { name: 'C Paneer', expiryDate: IN_3 });
  await api('POST', '/notifications/check', { token: C.token });

  const alert = findAlert(await alertsOf(C.token), item.id);
  check(
    'C after adding a number: new alerts route to whatsapp',
    alert?.channel === 'whatsapp' && alert?.status === 'pending',
    `got ${alert?.channel}/${alert?.status}`
  );
}

// -- Summary -----------------------------------------------------------------
section('6. GET /notifications/summary');
{
  const res = await api('GET', '/notifications/summary', { token: A.token });
  const s = res.body?.summary;
  check('summary -> 200', res.status === 200, `got ${res.status}`);
  check('pending = 4 (all of A\'s alerts await WhatsApp dispatch)', s?.pending === 4, `got ${s?.pending}`);
  check('sent = 0', s?.sent === 0, `got ${s?.sent}`);
  check('failed = 0', s?.failed === 0, `got ${s?.failed}`);
  check('total = 4', s?.total === 4, `got ${s?.total}`);
  check('whatsappReady is true for A', s?.whatsappReady === true, `got ${s?.whatsappReady}`);
  check('schedule config is exposed', typeof s?.schedule?.cron === 'string', `got ${JSON.stringify(s?.schedule)}`);

  const bRes = await api('GET', '/notifications/summary', { token: B.token });
  check('whatsappReady is false for opted-out B', bRes.body?.summary?.whatsappReady === false, `got ${bRes.body?.summary?.whatsappReady}`);
  check('B: sent = 1, pending = 0', bRes.body?.summary?.sent === 1 && bRes.body?.summary?.pending === 0, JSON.stringify(bRes.body?.summary));
}

// -- Filters + validation ----------------------------------------------------
section('7. List filters and validation');
{
  const byType = await alertsOf(A.token, '?type=expired');
  check('?type=expired returns only expired alerts', byType.length === 1 && byType[0].type === 'expired', `got ${byType.length} of type ${byType[0]?.type}`);

  const byStatus = await alertsOf(A.token, '?status=pending');
  check('?status=pending returns all 4', byStatus.length === 4, `got ${byStatus.length}`);

  const bySent = await alertsOf(A.token, '?status=sent');
  check('?status=sent returns none for A', bySent.length === 0, `got ${bySent.length}`);

  const byDate = await alertsOf(A.token, `?date=${TODAY}`);
  check(`?date=${TODAY} returns all 4`, byDate.length === 4, `got ${byDate.length}`);

  const otherDay = await alertsOf(A.token, `?date=${dateOffset(-5)}`);
  check('?date for a day with no sweep returns none', otherDay.length === 0, `got ${otherDay.length}`);

  const paged = await api('GET', '/notifications?limit=2', { token: A.token });
  check('?limit=2 returns 2 but reports total 4', paged.body?.count === 2 && paged.body?.total === 4, `count=${paged.body?.count} total=${paged.body?.total}`);
}
{
  const cases = [
    ['?status=whenever', 'status'],
    ['?type=nonsense', 'type'],
    ['?date=2026-02-30', 'date'],
    ['?limit=0', 'limit'],
    ['?limit=999', 'limit'],
    ['?offset=-1', 'offset'],
  ];
  for (const [qs, field] of cases) {
    const res = await api('GET', `/notifications${qs}`, { token: A.token });
    check(
      `GET /notifications${qs} -> 400 on '${field}'`,
      res.status === 400 && Boolean(res.body?.details?.[field]),
      `got ${res.status}: ${res.raw}`
    );
  }
}

// -- Cross-user isolation ----------------------------------------------------
section("8. Cross-user isolation");
{
  const aList = await alertsOf(A.token);
  const bList = await alertsOf(B.token);

  const aIds = new Set(aList.map((n) => n.id));
  check(
    "B's alerts do not appear in A's list",
    bList.every((n) => !aIds.has(n.id)),
    'overlap found'
  );
  check(
    "A's list contains only A's items",
    aList.every((n) => n.message.startsWith('P7 ')),
    aList.find((n) => !n.message.startsWith('P7 '))?.message
  );
  check("B sees exactly 1 alert of its own", bList.length === 1, `got ${bList.length}`);
}
{
  // A user-scoped sweep must not raise alerts for anyone else. C has an item
  // due that has already been swept; B running a sweep must change nothing.
  const cBefore = (await alertsOf(C.token)).length;
  await api('POST', '/notifications/check', { token: B.token });
  const cAfter = (await alertsOf(C.token)).length;
  check("B's sweep does not touch C's alerts", cBefore === cAfter, `${cBefore} -> ${cAfter}`);
}

// -- History survives item deletion ------------------------------------------
section('9. History outlives the food item');
{
  const before = findAlert(await alertsOf(A.token), items.expired.id);
  check('alert names its item before deletion', before?.foodItemName === 'P7 Tomatoes', `got ${before?.foodItemName}`);

  const del = await api('DELETE', `/food-items/${items.expired.id}`, { token: A.token });
  check('delete the food item -> 200', del.status === 200, `got ${del.status}`);

  const list = await alertsOf(A.token);
  const orphan = before ? list.find((n) => n.id === before.id) : null;
  check('the alert row still exists (ON DELETE SET NULL)', Boolean(orphan), 'alert vanished with the item');
  check('its foodItemId is now null', orphan?.foodItemId === null, `got ${orphan?.foodItemId}`);
  check('its message is preserved', orphan?.message === before?.message, `got "${orphan?.message}"`);
  check('A still has 4 alerts in history', list.length === 4, `got ${list.length}`);
}

// -- Cleanup -----------------------------------------------------------------
section('10. Cleanup');
{
  let leftovers = 0;
  for (const user of [A, B, C]) {
    const owned = await api('GET', '/food-items?includeConsumed=true&limit=500', { token: user.token });
    for (const item of owned.body?.items ?? []) {
      await api('DELETE', `/food-items/${item.id}`, { token: user.token });
    }
    const rest = await api('GET', '/food-items?includeConsumed=true', { token: user.token });
    leftovers += rest.body?.items?.length ?? 0;
  }
  check('all test items removed', leftovers === 0, `${leftovers} left behind`);
  console.log(`  NOTE  test users ${A.email} / ${B.email} / ${C.email} left in the users table`);
  console.log('  NOTE  their notification rows remain as history (food_item_id is now NULL)');
}

// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
console.log('='.repeat(60));

process.exit(failed === 0 ? 0 : 1);
