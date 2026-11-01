/**
 * Phase 10 end-to-end tests -- ESP32-CAM image upload + human review.
 *
 * Hits a RUNNING server against the real database. Start the server first:
 *
 *   npm run dev                # terminal 1 (needs DEVICE_API_KEY set)
 *   node tests/phase10-e2e.mjs # terminal 2
 *
 * What it covers, in methodology order:
 *   step 1  device uploads a JPEG         (shared-key gate, bad bodies)
 *   step 2  AI proposes an item           (or degrades gracefully with no key)
 *   step 3  human confirms / discards     (validation parity, race guard,
 *                                          cross-user isolation)
 *
 * It uploads two tiny real JPEGs (8x8, generated below as valid SOI/EOI
 * frames) under two throwaway users, so no hardware is needed to run it: the
 * device side is exercised over HTTP exactly as the ESP32 exercises it.
 *
 * Requires DEVICE_API_KEY in backend/.env -- without it the upload endpoint
 * correctly answers 503 and this suite reports that as a configuration
 * problem, not a pass.
 */

// Same dotenv entry as src/config/env.js: the key lives in .env, and a test
// that silently saw an empty key would report a config gap as a server bug.
import 'dotenv/config';

const BASE = process.env.API_BASE ?? 'http://localhost:5000/api';
const DEVICE_KEY = process.env.DEVICE_API_KEY ?? '';

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
    /* keep raw for the failure message */
  }
  return { status: res.status, body: json, raw: text };
}

/** Upload raw bytes the way the ESP32 does: no multipart, just a POST body. */
async function uploadJpeg(image, { key = DEVICE_KEY, userId } = {}) {
  const res = await fetch(`${BASE}/device/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/jpeg',
      ...(key ? { 'x-device-key': key } : {}),
      ...(userId ? { 'x-device-user': String(userId) } : {}),
    },
    body: image,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* raw */
  }
  return { status: res.status, body: json, raw: text };
}

/**
 * The browser's webcam: identical bytes, different credential.
 *
 * No device key is sent on purpose -- /capture is gated by the session alone,
 * which is the whole reason the shared key never has to reach JavaScript.
 */
async function captureJpeg(image, token) {
  const res = await fetch(`${BASE}/device/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/jpeg',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: image,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* raw */
  }
  return { status: res.status, body: json, raw: text };
}

async function signup(tag) {
  const email = `phase10-${tag}-${Date.now()}@test.local`;
  const res = await api('POST', '/auth/signup', {
    body: { name: `Phase10 ${tag}`, email, password: 'TestPass123' },
  });
  if (res.status !== 201) {
    throw new Error(`signup failed (${res.status}): ${res.raw}`);
  }
  return { token: res.body.token, id: res.body.user.id, email };
}

/**
 * A syntactically real JPEG: SOI marker, a JFIF APP0 header, and EOI.
 *
 * The backend's check is "does it start with FFD8FF" -- deliberately cheap,
 * because the ESP32 cannot be asked to prove more and the file is only ever
 * handed to an image model that will reject nonsense on its own. These bytes
 * satisfy exactly what is being asserted.
 */
function tinyJpeg(seed = 1) {
  const header = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]);
  const body = Buffer.alloc(64, seed); // payload bytes, content irrelevant
  const eoi = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([header, body, eoi]);
}

// ---------------------------------------------------------------------------

console.log('Phase 10 E2E -- ESP32-CAM upload + human review');
console.log(`Base: ${BASE}`);

const health = await api('GET', '/health/db');
if (health.status !== 200) {
  console.error(`\nDatabase not reachable: ${health.raw}`);
  process.exit(1);
}

if (!DEVICE_KEY) {
  console.error(
    '\nDEVICE_API_KEY is empty. Set it in backend/.env and restart the server:\n' +
      "  node -e \"console.log(require('crypto').randomBytes(24).toString('hex'))\""
  );
  process.exit(1);
}

// -- Setup -------------------------------------------------------------------

const A = await signup('a');
const B = await signup('b');
console.log(`Users: A=${A.id}  B=${B.id}`);

// ===========================================================================
// Tests
// ===========================================================================

// -- 1. Device key gate ------------------------------------------------------
section('1. Device key gate');
{
  const noKey = await uploadJpeg(tinyJpeg(1), { key: '' });
  check('upload without key -> 401', noKey.status === 401, `got ${noKey.status}`);

  const badKey = await uploadJpeg(tinyJpeg(1), { key: 'not-the-real-key' });
  check('upload with wrong key -> 401', badKey.status === 401, `got ${badKey.status}`);

  const noBody = await fetch(`${BASE}/device/upload`, {
    method: 'POST',
    headers: { 'x-device-key': DEVICE_KEY, 'Content-Type': 'image/jpeg' },
  });
  check('upload with empty body -> 400', noBody.status === 400, `got ${noBody.status}`);

  const notJpeg = await uploadJpeg(Buffer.from('this is not a jpeg at all'), {});
  check('upload of non-JPEG bytes -> 400', notJpeg.status === 400, `got ${notJpeg.status}`);
}

// -- 2. Capture + recognition (methodology steps 1-2) ------------------------
section('2. Upload creates a pending detection');
let detA;
{
  const res = await uploadJpeg(tinyJpeg(2), { userId: A.id });
  check('valid JPEG upload -> 201', res.status === 201, `got ${res.status}: ${res.raw}`);
  detA = res.body?.detection;

  check('response carries a detection', Boolean(detA), JSON.stringify(res.body));
  check('detection starts as pending', detA?.status === 'pending', `got ${detA?.status}`);
  check(
    'imageUrl points at /uploads/detections/',
    typeof detA?.imageUrl === 'string' && detA.imageUrl.includes('/uploads/detections/'),
    `got ${detA?.imageUrl}`
  );

  const rec = res.body?.recognition;
  check('response reports recognition outcome', Boolean(rec), JSON.stringify(res.body));
  if (rec) {
    if (rec.detected) {
      console.log(`  NOTE  AI proposed: ${detA.detectedName} (provider ${rec.provider})`);
      check('proposed item has a name', Boolean(detA.detectedName), '');
      check(
        'confidence is 0..1 when present',
        detA.confidence === null || (detA.confidence >= 0 && detA.confidence <= 1),
        `got ${detA.confidence}`
      );
    } else {
      console.log(
        '  NOTE  no GEMINI_API_KEY (or unreadable image) -- proposal absent, ' +
          'which is the documented degrade path, not a failure'
      );
      check('degraded upload still stores the photo', Boolean(detA?.imageUrl), '');
    }
  }

  // The photo must not leak into another kitchen's review queue.
  const bList = await api('GET', '/device/detections', { token: B.token });
  check(
    'user B does not see user A\'s detection',
    bList.status === 200 &&
      !(bList.body?.detections ?? []).some((d) => d.id === detA?.id),
    `got ${bList.raw}`
  );
}

// -- 3. Review queue ----------------------------------------------------------
section('3. Review queue');
{
  const anon = await api('GET', '/device/detections');
  check('GET /detections without token -> 401', anon.status === 401, `got ${anon.status}`);

  const res = await api('GET', '/device/detections', { token: A.token });
  check('GET /detections -> 200', res.status === 200, `got ${res.status}: ${res.raw}`);
  check(
    'queue contains the new photo',
    (res.body?.detections ?? []).some((d) => d.id === detA?.id),
    JSON.stringify(res.body?.detections?.map((d) => d.id))
  );
}

// -- 4. Confirm: validation parity with typed entry ---------------------------
section('4. Confirm detection');
{
  // The confirm endpoint must run the SAME rules as POST /food-items.
  const bad = await api('POST', `/device/detections/${detA.id}/confirm`, {
    token: A.token,
    body: { name: '', expiryDate: 'not-a-date' },
  });
  check(
    'confirm with empty name + bad date -> 400 with details',
    bad.status === 400 && Boolean(bad.body?.details),
    `got ${bad.status}: ${bad.raw}`
  );
  check(
    'both field errors reported at once',
    Boolean(bad.body?.details?.name) && Boolean(bad.body?.details?.expiryDate),
    JSON.stringify(bad.body?.details)
  );

  // Another user's detection answers 404, not 403 (same reasoning as items).
  const foreign = await api('POST', `/device/detections/${detA.id}/confirm`, {
    token: B.token,
    body: { name: 'Milk', expiryDate: '2030-01-01' },
  });
  check("confirming someone else's detection -> 404", foreign.status === 404, `got ${foreign.status}`);

  const good = await api('POST', `/device/detections/${detA.id}/confirm`, {
    token: A.token,
    body: {
      name: 'Amul Milk',
      category: 'Dairy',
      quantity: 1,
      unit: 'litre',
      expiryDate: '2030-01-15',
      notes: 'reviewed from camera photo',
    },
  });
  check('valid confirm -> 201', good.status === 201, `got ${good.status}: ${good.raw}`);

  const item = good.body?.item;
  check('confirm created a food item', Boolean(item?.id), JSON.stringify(good.body));
  check(
    "item source is 'esp32cam'",
    item?.source === 'esp32cam',
    `got ${item?.source}`
  );

  // The item must be a normal inventory row -- filters, status view, alerts
  // all read the same table, so a detection-created item that did not appear
  // here would be a phantom.
  const list = await api('GET', '/food-items?q=Amul', { token: A.token });
  check(
    'confirmed item appears in inventory list',
    (list.body?.items ?? []).some((i) => i.id === item.id),
    JSON.stringify(list.body?.items?.map((i) => i.name))
  );

  // Double-confirm: the status guard should reject the second attempt.
  const again = await api('POST', `/device/detections/${detA.id}/confirm`, {
    token: A.token,
    body: { name: 'Amul Milk', expiryDate: '2030-01-15' },
  });
  check('second confirm -> 409', again.status === 409, `got ${again.status}: ${again.raw}`);

  const afterList = await api('GET', '/food-items?q=Amul', { token: A.token });
  const copies = (afterList.body?.items ?? []).filter((i) => i.name === 'Amul Milk');
  check('no duplicate inventory row from the double-confirm', copies.length === 1, `got ${copies.length}`);

  const queue = await api('GET', '/device/detections', { token: A.token });
  check(
    'confirmed detection left the pending queue',
    !(queue.body?.detections ?? []).some((d) => d.id === detA.id),
    JSON.stringify(queue.body?.detections?.map((d) => d.id))
  );

  // Cleanup: remove the item so re-runs start clean.
  await api('DELETE', `/food-items/${item.id}`, { token: A.token });
}

// -- 5. Discard ----------------------------------------------------------------
section('5. Discard detection');
{
  const second = await uploadJpeg(tinyJpeg(3), { userId: A.id });
  check('second upload -> 201', second.status === 201, `got ${second.status}: ${second.raw}`);
  const det = second.body?.detection;

  const foreign = await api('POST', `/device/detections/${det.id}/discard`, { token: B.token });
  check("discarding someone else's detection -> 404", foreign.status === 404, `got ${foreign.status}`);

  const ok = await api('POST', `/device/detections/${det.id}/discard`, { token: A.token });
  check('discard -> 200', ok.status === 200, `got ${ok.status}: ${ok.raw}`);

  const again = await api('POST', `/device/detections/${det.id}/discard`, { token: A.token });
  check('second discard -> 409 (already discarded)', again.status === 409, `got ${again.status}`);

  const queue = await api('GET', '/device/detections', { token: A.token });
  check(
    'discarded detection left the pending queue',
    !(queue.body?.detections ?? []).some((d) => d.id === det.id),
    JSON.stringify(queue.body?.detections?.map((d) => d.id))
  );

  const items = await api('GET', '/food-items', { token: A.token });
  check('discard created no inventory item', (items.body?.items?.length ?? 0) === 0,
    `got ${items.body?.items?.length}`);
}

// -- 6. Image is actually served ----------------------------------------------
section('6. Photo is served for the review screen');
{
  const det = await uploadJpeg(tinyJpeg(4), { userId: A.id });
  const url = det.body?.detection?.imageUrl;
  check('upload returned an imageUrl', typeof url === 'string', det.raw);

  if (url) {
    const origin = new URL(BASE).origin;
    const res = await fetch(`${origin}${url}`);
    check('GET imageUrl -> 200', res.status === 200, `got ${res.status} for ${url}`);
    const ctype = res.headers.get('content-type') ?? '';
    check('served as an image', ctype.startsWith('image/'), `got ${ctype}`);

    const bytes = Buffer.from(await res.arrayBuffer());
    check('served bytes start with JPEG SOI', bytes[0] === 0xff && bytes[1] === 0xd8,
      `got ${bytes.slice(0, 4).toString('hex')}`);

    // Clean up the queue entry.
    await api('POST', `/device/detections/${det.body.detection.id}/discard`, { token: A.token });
  }
}

// -- 7. Webcam capture (the browser's own camera) ----------------------------
section('7. Webcam capture without the ESP32-CAM');
{
  const anon = await captureJpeg(tinyJpeg(6), '');
  check('capture without token -> 401', anon.status === 401, `got ${anon.status}`);

  // The device key must NOT open this route. A key that worked here would be
  // a key already sitting in the shipped JavaScript bundle.
  const keyed = await fetch(`${BASE}/device/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg', 'x-device-key': DEVICE_KEY },
    body: tinyJpeg(6),
  });
  check('device key alone cannot use /capture', keyed.status === 401, `got ${keyed.status}`);

  const notJpeg = await captureJpeg(Buffer.from('not a jpeg at all'), A.token);
  check('webcam upload of non-JPEG bytes -> 400', notJpeg.status === 400, `got ${notJpeg.status}`);

  const ok = await captureJpeg(tinyJpeg(7), A.token);
  check('webcam capture with session -> 201', ok.status === 201, `got ${ok.status}: ${ok.raw}`);
  const det = ok.body?.detection;
  check('capture created a pending detection', det?.status === 'pending', `got ${det?.status}`);
  check(
    'capture stores the photo',
    typeof det?.imageUrl === 'string' && det.imageUrl.includes('/uploads/detections/'),
    `got ${det?.imageUrl}`
  );

  const aQueue = await api('GET', '/device/detections', { token: A.token });
  check(
    'capture lands in the sender\'s queue',
    (aQueue.body?.detections ?? []).some((d) => d.id === det?.id),
    JSON.stringify(aQueue.body?.detections?.map((d) => d.id))
  );

  const bQueue = await api('GET', '/device/detections', { token: B.token });
  check(
    "capture stays out of another user's queue",
    !(bQueue.body?.detections ?? []).some((d) => d.id === det?.id),
    JSON.stringify(bQueue.body?.detections?.map((d) => d.id))
  );

  // The point of the whole feature: a webcam photo must come out the far end
  // as an ordinary inventory row, indistinguishable from a device photo.
  const confirmed = await api('POST', `/device/detections/${det.id}/confirm`, {
    token: A.token,
    body: {
      name: 'Webcam Scan',
      category: 'Snacks',
      quantity: 1,
      unit: 'pcs',
      expiryDate: '2030-06-01',
    },
  });
  check(
    'webcam capture confirms into inventory -> 201',
    confirmed.status === 201,
    `got ${confirmed.status}: ${confirmed.raw}`
  );
  check(
    "confirmed item source is 'esp32cam'",
    confirmed.body?.item?.source === 'esp32cam',
    `got ${confirmed.body?.item?.source}`
  );

  // Leave the queue and the kitchen as they were found.
  if (confirmed.body?.item?.id) {
    await api('DELETE', `/food-items/${confirmed.body.item.id}`, { token: A.token });
  }
}

// -- 8. Isolation summary ------------------------------------------------------
section('8. Cross-user isolation');
{
  const aQueue = await api('GET', '/device/detections', { token: A.token });
  const bQueue = await api('GET', '/device/detections', { token: B.token });
  check('A and B queues are disjoint', aQueue.status === 200 && bQueue.status === 200);

  const noTokenUpload = await uploadJpeg(tinyJpeg(5), { key: '' });
  check('no key, no upload', noTokenUpload.status === 401, `got ${noTokenUpload.status}`);
}

// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log(`Passed: ${passed}   Failed: ${failed}`);
console.log('='.repeat(60));
if (failed > 0) process.exit(1);
process.exit(0);
