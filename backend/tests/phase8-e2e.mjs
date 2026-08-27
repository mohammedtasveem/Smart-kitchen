/**
 * Phase 8 end-to-end tests -- WhatsApp dispatch.
 *
 * Hits a RUNNING server against the real database. Start the server first:
 *
 *   npm run dev                 # terminal 1
 *   node tests/phase8-e2e.mjs   # terminal 2
 *
 * Runs entirely in DRY RUN, so no Meta app is needed and no real message is ever
 * sent. A dry-run send is a full pass through the worker -- claim, group, mark
 * sent, stamp an id -- with only the HTTP call to the provider replaced, so every
 * assertion below is about real behaviour.
 *
 * IMPORTANT: this suite refuses to run if WHATSAPP_DRY_RUN is off and credentials
 * are configured, because it would then message real phone numbers.
 *
 * Three throwaway users per run:
 *
 *   A -- phone + opted in    -> the happy path: queued, then sent as one message
 *   B -- phone, opts out mid-flight -> queued, then must NOT be sent
 *   C -- no phone            -> in_app only, must never enter the WhatsApp queue
 *
 * Direct SQL is used for two setups the API deliberately does not expose:
 * backdating a `notify_date` (to test staleness) and reading `attempts`. Both are
 * scoped to this run's own rows.
 *
 * Items are deleted at the end, so re-running is safe and the demo account is
 * never touched. Clear the accounts with `npm run test:cleanup`.
 */

import { query, closePool } from '../src/config/db.js';

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

/**
 * Create a throwaway account.
 *
 * `whatsappOptIn` is applied with a follow-up PATCH rather than passed to signup,
 * because signup deliberately does not accept it -- consent is its own action. It
 * is set explicitly rather than left to the column default so these tests still
 * mean what they say if that default ever changes.
 */
async function signup(tag, { phone = null, whatsappOptIn = null } = {}) {
  const email = `phase8-${tag}-${Date.now()}@test.local`;
  const res = await api('POST', '/auth/signup', {
    body: {
      name: `Phase8 ${tag}`,
      email,
      password: 'TestPass123',
      ...(phone ? { phone } : {}),
    },
  });
  if (res.status !== 201) throw new Error(`signup failed (${res.status}): ${res.raw}`);
  const user = { token: res.body.token, id: res.body.user.id, email };

  if (whatsappOptIn !== null) {
    const patched = await api('PATCH', '/auth/me', {
      token: user.token,
      body: { whatsappOptIn },
    });
    if (patched.status !== 200) throw new Error(`opt-in patch failed (${patched.status}): ${patched.raw}`);
  }
  return user;
}

async function addItem(token, body) {
  const res = await api('POST', '/food-items', { token, body });
  if (res.status !== 201) throw new Error(`add item failed (${res.status}): ${res.raw}`);
  return res.body.item;
}

async function alertsOf(token) {
  const res = await api('GET', '/notifications?limit=100', { token });
  return res.body?.notifications ?? [];
}

/** Raw rows, for the columns the API does not expose. */
function rawAlerts(userId) {
  return query(
    'SELECT id, status, channel, attempts, provider_sid, notify_date, error_message' +
      ' FROM notifications WHERE user_id = ? ORDER BY id',
    [userId]
  );
}

const TOMORROW = dateOffset(1);
const IN_2 = dateOffset(2);
const IN_3 = dateOffset(3);
const YESTERDAY = dateOffset(-1);
const PHONE_A = '+919000000801';
const PHONE_B = '+919000000802';

console.log('Phase 8 e2e -- WhatsApp dispatch');
console.log(`Target: ${BASE}\n`);

// ---------------------------------------------------------------------------
section('0. Safety check -- must be in dry run');
// ---------------------------------------------------------------------------
{
  // Read the mode off the API rather than off process.env: the server under test
  // is a different process, and its .env is the one that decides.
  const probe = await signup('probe', { phone: '+919000000800', whatsappOptIn: true });
  const res = await api('GET', '/notifications/summary', { token: probe.token });
  const delivery = res.body?.summary?.delivery;

  check('/summary reports the delivery mode', Boolean(delivery), res.raw);

  if (delivery && delivery.dryRun !== true) {
    console.error(
      '\n  ABORTED: the server is configured to send real WhatsApp messages.\n' +
        '  Set WHATSAPP_DRY_RUN=true in backend/.env before running this suite.\n'
    );
    await closePool();
    process.exit(1);
  }
  check('dry run is on, so no real message can be sent', delivery?.dryRun === true);
  check(
    'provider is reported as meta-cloud-api',
    delivery?.provider === 'meta-cloud-api',
    delivery?.provider
  );
}

const userA = await signup('a-optin', { phone: PHONE_A, whatsappOptIn: true });
const userB = await signup('b-optout', { phone: PHONE_B, whatsappOptIn: true });
const userC = await signup('c-nophone');
// ---------------------------------------------------------------------------
section('1. Both new endpoints require a token');
// ---------------------------------------------------------------------------
{
  for (const [method, path] of [
    ['POST', '/notifications/send'],
    ['POST', '/notifications/1/retry'],
  ]) {
    const res = await api(method, path);
    check(`${method} ${path} without a token -> 401`, res.status === 401, `got ${res.status}`);
  }
  const bad = await api('POST', '/notifications/send', { token: 'not-a-real-token' });
  check('POST /notifications/send with a garbage token -> 401', bad.status === 401, `got ${bad.status}`);
}

// ---------------------------------------------------------------------------
section('2. Nothing queued -> a send is a no-op, not an error');
// ---------------------------------------------------------------------------
{
  const res = await api('POST', '/notifications/send', { token: userA.token });
  check('POST /notifications/send -> 200', res.status === 200, res.raw);
  check('queued is 0', res.body?.result?.queued === 0, JSON.stringify(res.body?.result));
  check('no messages sent', res.body?.result?.messagesSent === 0);
  check('result reports dryRun: true', res.body?.result?.dryRun === true);
}

// ---------------------------------------------------------------------------
section('3. Four items -> one grouped message, one shared SID');
// ---------------------------------------------------------------------------
let itemsA = [];
{
  itemsA = [
    await addItem(userA.token, { name: 'P8 Milk', quantity: 2, unit: 'litre', expiryDate: TOMORROW }),
    await addItem(userA.token, { name: 'P8 Bread', quantity: 1, unit: 'packet', expiryDate: IN_2 }),
    await addItem(userA.token, { name: 'P8 Curd', quantity: 500, unit: 'g', expiryDate: IN_3 }),
    await addItem(userA.token, { name: 'P8 Tomato', quantity: 1, unit: 'kg', expiryDate: YESTERDAY }),
  ];

  const swept = await api('POST', '/notifications/check', { token: userA.token });
  check('sweep queued 4 alerts', swept.body?.result?.created === 4, JSON.stringify(swept.body?.result));
  check(
    'all 4 routed to WhatsApp',
    swept.body?.result?.queuedForWhatsApp === 4,
    JSON.stringify(swept.body?.result)
  );

  const sent = await api('POST', '/notifications/send', { token: userA.token });
  const r = sent.body?.result;
  check('POST /notifications/send -> 200', sent.status === 200, sent.raw);
  check('4 alerts were picked up', r?.queued === 4, JSON.stringify(r));
  check('grouped into ONE message', r?.messagesSent === 1, `messagesSent=${r?.messagesSent}`);
  check('one recipient', r?.recipients === 1, `recipients=${r?.recipients}`);
  check('all 4 marked sent', r?.alertsSent === 4, `alertsSent=${r?.alertsSent}`);
  check('none failed', r?.alertsFailed === 0 && r?.alertsRetryLater === 0, JSON.stringify(r));
  check('no errors reported', Array.isArray(r?.errors) && r.errors.length === 0, JSON.stringify(r?.errors));

  const rows = await rawAlerts(userA.id);
  check('every row is status=sent', rows.every((x) => x.status === 'sent'), JSON.stringify(rows.map((x) => x.status)));
  check('every row got one attempt', rows.every((x) => x.attempts === 1), JSON.stringify(rows.map((x) => x.attempts)));

  const sids = new Set(rows.map((x) => x.provider_sid));
  check('all four rows share ONE provider SID', sids.size === 1, `${sids.size} distinct SIDs`);
  check(
    'the SID is marked as simulated',
    [...sids][0]?.startsWith('dryrun-'),
    [...sids][0] ?? 'null'
  );

  const api8 = await alertsOf(userA.token);
  check('API exposes attempts', api8.every((n) => n.attempts === 1), JSON.stringify(api8.map((n) => n.attempts)));
  check('API exposes sentAt on every row', api8.every((n) => Boolean(n.sentAt)));
  check('no errorMessage on a successful send', api8.every((n) => n.errorMessage === null));
}

// ---------------------------------------------------------------------------
section('4. A second send is a no-op -- nothing is delivered twice');
// ---------------------------------------------------------------------------
{
  const again = await api('POST', '/notifications/send', { token: userA.token });
  check('queued is 0 on the second run', again.body?.result?.queued === 0, JSON.stringify(again.body?.result));
  check('no second message', again.body?.result?.messagesSent === 0);

  const rows = await rawAlerts(userA.id);
  check('attempts did NOT increase', rows.every((x) => x.attempts === 1), JSON.stringify(rows.map((x) => x.attempts)));
}

// ---------------------------------------------------------------------------
section('5. Opting out after queueing stops the send');
// ---------------------------------------------------------------------------
{
  await addItem(userB.token, { name: 'P8 Paneer', quantity: 250, unit: 'g', expiryDate: TOMORROW });
  const swept = await api('POST', '/notifications/check', { token: userB.token });
  check('B queued 1 WhatsApp alert while opted in', swept.body?.result?.queuedForWhatsApp === 1, JSON.stringify(swept.body?.result));

  // Opt out *after* the row is already sitting in the queue.
  const off = await api('PATCH', '/auth/me', { token: userB.token, body: { whatsappOptIn: false } });
  check('PATCH /auth/me turns the opt-in off -> 200', off.status === 200, off.raw);

  const sent = await api('POST', '/notifications/send', { token: userB.token });
  check('the queued alert is NOT picked up', sent.body?.result?.queued === 0, JSON.stringify(sent.body?.result));

  const rows = await rawAlerts(userB.id);
  check('it is still pending, not sent', rows.every((x) => x.status === 'pending'), JSON.stringify(rows.map((x) => x.status)));
  check('and was never attempted', rows.every((x) => x.attempts === 0), JSON.stringify(rows.map((x) => x.attempts)));
}

// ---------------------------------------------------------------------------
section('6. in_app alerts never enter the WhatsApp queue');
// ---------------------------------------------------------------------------
{
  await addItem(userC.token, { name: 'P8 Butter', quantity: 100, unit: 'g', expiryDate: TOMORROW });
  const swept = await api('POST', '/notifications/check', { token: userC.token });
  check('C (no phone) queued 0 for WhatsApp', swept.body?.result?.queuedForWhatsApp === 0, JSON.stringify(swept.body?.result));
  check('C recorded 1 in the app', swept.body?.result?.recordedInApp === 1, JSON.stringify(swept.body?.result));

  const sent = await api('POST', '/notifications/send', { token: userC.token });
  check('a send finds nothing to do', sent.body?.result?.queued === 0, JSON.stringify(sent.body?.result));

  const rows = await rawAlerts(userC.id);
  check('the row is channel=in_app', rows.every((x) => x.channel === 'in_app'), JSON.stringify(rows.map((x) => x.channel)));
  check('already status=sent', rows.every((x) => x.status === 'sent'));
  check('with no provider SID -- nothing went to WhatsApp', rows.every((x) => x.provider_sid === null));
}

// ---------------------------------------------------------------------------
section('7. Retry validation');
// ---------------------------------------------------------------------------
{
  const missing = await api('POST', '/notifications/99999999/retry', { token: userA.token });
  check('retrying an unknown id -> 404', missing.status === 404, `got ${missing.status}`);

  const bad = await api('POST', '/notifications/abc/retry', { token: userA.token });
  check('retrying a non-numeric id -> 400', bad.status === 400, `got ${bad.status}`);

  const sentRows = await rawAlerts(userA.id);
  const alreadySent = await api('POST', `/notifications/${sentRows[0].id}/retry`, { token: userA.token });
  check('retrying an already-sent alert -> 400', alreadySent.status === 400, `got ${alreadySent.status}`);
  check(
    'and the message says it is already sent',
    /already sent/i.test(alreadySent.body?.error ?? alreadySent.raw),
    alreadySent.raw
  );

  const inApp = await rawAlerts(userC.id);
  const wrongChannel = await api('POST', `/notifications/${inApp[0].id}/retry`, { token: userC.token });
  check('retrying an in_app alert -> 400', wrongChannel.status === 400, `got ${wrongChannel.status}`);
  check(
    'and the message says only WhatsApp alerts can be retried',
    /whatsapp/i.test(wrongChannel.body?.error ?? wrongChannel.raw),
    wrongChannel.raw
  );
}

// ---------------------------------------------------------------------------
section("8. Retrying another user's alert is a 404, not a 403");
// ---------------------------------------------------------------------------
{
  const bRows = await rawAlerts(userB.id);
  const stolen = await api('POST', `/notifications/${bRows[0].id}/retry`, { token: userA.token });
  check(
    "A cannot see B's alert id at all -> 404",
    stolen.status === 404,
    `got ${stolen.status} -- an existing id must not be distinguishable from a missing one`
  );

  const stillThere = await rawAlerts(userB.id);
  check("B's alert was not touched", stillThere[0].status === 'pending' && stillThere[0].attempts === 0);
}

// ---------------------------------------------------------------------------
section('9. A failed alert can be retried, and it sends');
// ---------------------------------------------------------------------------
{
  // Force a realistic failure state: B opts back in, and the row is marked failed
  // the way a permanent Meta Cloud API error would leave it.
  await api('PATCH', '/auth/me', { token: userB.token, body: { whatsappOptIn: true } });
  const bRows = await rawAlerts(userB.id);
  const target = bRows[0].id;
  await query(
    "UPDATE notifications SET status='failed', attempts=3, error_message=? WHERE id=?",
    ['Recipient not on WhatsApp (WhatsApp 131026)', target]
  );

  const retried = await api('POST', `/notifications/${target}/retry`, { token: userB.token });
  check('POST /notifications/:id/retry -> 200', retried.status === 200, retried.raw);
  check('it was sent in the same request', retried.body?.result?.alertsSent === 1, JSON.stringify(retried.body?.result));
  check('the returned row is status=sent', retried.body?.notification?.status === 'sent', JSON.stringify(retried.body?.notification));
  check('the old error message was cleared', retried.body?.notification?.errorMessage === null);
  check(
    'attempts was reset then used once',
    retried.body?.notification?.attempts === 1,
    `attempts=${retried.body?.notification?.attempts}`
  );
  check('it got a fresh SID', retried.body?.notification?.providerSid?.startsWith('dryrun-') === true);
}

// ---------------------------------------------------------------------------
section('10. A stale pending alert is failed, not delivered late');
// ---------------------------------------------------------------------------
{
  const item = await addItem(userA.token, {
    name: 'P8 Stale',
    quantity: 1,
    unit: 'packet',
    expiryDate: TOMORROW,
  });

  // Backdate the row past WHATSAPP_STALE_AFTER_DAYS. No API does this -- and none
  // should -- but it is exactly the state a server that was off for a week leaves.
  await query(
    `INSERT INTO notifications (user_id, food_item_id, channel, type, message, status, notify_date)
     VALUES (?, ?, 'whatsapp', 'near_expiry', ?, 'pending', DATE_SUB(CURDATE(), INTERVAL 10 DAY))`,
    [userA.id, item.id, 'P8 Stale (1 packet) expires tomorrow']
  );

  const before = await query(
    "SELECT id FROM notifications WHERE user_id=? AND status='pending'",
    [userA.id]
  );
  check('a 10-day-old pending alert exists', before.length === 1, `found ${before.length}`);

  const sent = await api('POST', '/notifications/send', { token: userA.token });
  check('it is NOT delivered', sent.body?.result?.alertsSent === 0, JSON.stringify(sent.body?.result));
  check('it is counted as stale', sent.body?.result?.staleExpired >= 1, JSON.stringify(sent.body?.result));

  const after = await query('SELECT status, error_message FROM notifications WHERE id=?', [before[0].id]);
  check('the row is now failed', after[0]?.status === 'failed', after[0]?.status);
  check(
    'with a reason that explains why',
    /no longer current/i.test(after[0]?.error_message ?? ''),
    after[0]?.error_message ?? 'null'
  );

  const tooOld = await api('POST', `/notifications/${before[0].id}/retry`, { token: userA.token });
  check('and it is too old to retry -> 400', tooOld.status === 400, `got ${tooOld.status}`);
  check('with a message saying so', /too old/i.test(tooOld.body?.error ?? tooOld.raw), tooOld.raw);
}

// ---------------------------------------------------------------------------
section('11. Cross-user isolation: one send never touches another queue');
// ---------------------------------------------------------------------------
{
  // Give both A and B a fresh pending alert on the same day.
  for (const [user, name] of [
    [userA, 'P8 Iso A'],
    [userB, 'P8 Iso B'],
  ]) {
    await addItem(user.token, { name, quantity: 1, unit: 'piece', expiryDate: TOMORROW });
    await api('POST', '/notifications/check', { token: user.token });
  }

  const bBefore = await query(
    "SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND status='pending'",
    [userB.id]
  );
  check("B has a pending alert before A's send", Number(bBefore[0].c) === 1, JSON.stringify(bBefore));

  const sent = await api('POST', '/notifications/send', { token: userA.token });
  check("A's send delivers exactly one message", sent.body?.result?.messagesSent === 1, JSON.stringify(sent.body?.result));
  check('to exactly one recipient', sent.body?.result?.recipients === 1, JSON.stringify(sent.body?.result));

  const bAfter = await query(
    "SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND status='pending'",
    [userB.id]
  );
  check("B's alert is untouched and still pending", Number(bAfter[0].c) === 1, JSON.stringify(bAfter));
}

// ---------------------------------------------------------------------------
section('12. Summary reports the delivery mode and dispatch schedule');
// ---------------------------------------------------------------------------
{
  const res = await api('GET', '/notifications/summary', { token: userA.token });
  const s = res.body?.summary;
  check('GET /notifications/summary -> 200', res.status === 200, res.raw);
  check('delivery.configured is a boolean', typeof s?.delivery?.configured === 'boolean');
  check('delivery.dryRun is true', s?.delivery?.dryRun === true);
  check('schedule.dispatchEnabled is present', typeof s?.schedule?.dispatchEnabled === 'boolean');
  check('schedule.dispatchCron is present', typeof s?.schedule?.dispatchCron === 'string', s?.schedule?.dispatchCron);
  check(
    'sent + pending + failed adds up to total',
    s?.sent + s?.pending + s?.failed === s?.total,
    JSON.stringify(s)
  );
  check('A has at least one sent alert', s?.sent >= 4, `sent=${s?.sent}`);
  check('A has at least one failed alert (the stale one)', s?.failed >= 1, `failed=${s?.failed}`);
}

// ---------------------------------------------------------------------------
section('13. The grouped message body');
// ---------------------------------------------------------------------------
{
  // Imported directly: the body never leaves the server in an API response, and
  // asserting on its shape is the only way to catch a formatting regression.
  const { composeBody } = await import('../src/services/whatsappDispatch.js');
  const body = composeBody({
    name: 'Noorain Kaladgi',
    rows: [
      { type: 'expired', message: 'Tomatoes (1 kg) expired 2 days ago' },
      { type: 'near_expiry', message: 'Amul Milk (2 litre) expires tomorrow' },
      { type: 'near_expiry', message: 'Paneer (250 g) expires in 2 days' },
    ],
  });

  check('greets by first name only', body.includes('Hi Noorain,'), body);
  check('expired items come first', body.indexOf('Already expired') < body.indexOf('Use soon'));
  check('counts each section', body.includes('Already expired (1)') && body.includes('Use soon (2)'), body);
  check('every item is bulleted', (body.match(/^• /gm) ?? []).length === 3);
  check('reuses the sweep wording verbatim', body.includes('Amul Milk (2 litre) expires tomorrow'));
  check('uses WhatsApp bold, not Markdown', body.includes('*Smart Kitchen*') && !body.includes('**'));
  check('ends with a call to action', /before they go to waste\.$/.test(body.trim()), body.slice(-60));

  // A user with nothing expired must not get an empty "Already expired (0)".
  const soonOnly = composeBody({
    name: 'Aiman',
    rows: [{ type: 'near_expiry', message: 'Curd (500 g) expires today' }],
  });
  check('omits the expired section when there is none', !soonOnly.includes('Already expired'), soonOnly);
}

// ---------------------------------------------------------------------------
section('14. Cleanup -- remove every item these accounts created');
// ---------------------------------------------------------------------------
{
  let removed = 0;
  for (const user of [userA, userB, userC]) {
    const list = await api('GET', '/food-items?limit=100', { token: user.token });
    for (const item of list.body?.items ?? []) {
      const res = await api('DELETE', `/food-items/${item.id}`, { token: user.token });
      if (res.status === 200) removed += 1;
    }
  }
  check('all test items deleted', removed >= 8, `deleted ${removed}`);

  const left = await api('GET', '/food-items', { token: userA.token });
  check('A has no items left', (left.body?.items ?? []).length === 0);

  // The alert history deliberately survives item deletion (Phase 7), so the rows
  // are still there -- with a null food_item_id. Verify that, then clear them so
  // repeated runs do not accumulate.
  const orphans = await query(
    'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND food_item_id IS NULL',
    [userA.id]
  );
  check('alert history outlived the items', Number(orphans[0].c) > 0, JSON.stringify(orphans));

  for (const user of [userA, userB, userC]) {
    await query('DELETE FROM notifications WHERE user_id = ?', [user.id]);
  }
  const none = await query(
    `SELECT COUNT(*) AS c FROM notifications WHERE user_id IN (?, ?, ?)`,
    [userA.id, userB.id, userC.id]
  );
  check('test alert rows cleared', Number(none[0].c) === 0, JSON.stringify(none));
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
console.log('='.repeat(60));
console.log(`  NOTE  test users ${userA.email} / ${userB.email} / ${userC.email} left behind`);
console.log('  NOTE  clear them with `npm run test:cleanup`');

await closePool();
process.exit(failed === 0 ? 0 : 1);
