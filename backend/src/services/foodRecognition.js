import { env } from '../config/env.js';

/**
 * Phase 10, methodology step 2 -- "AI/OCR detects food + expiry".
 *
 * Takes the JPEG the ESP32-CAM uploaded and asks Gemini to read it: what is
 * the item, what category, what does the expiry date on the pack say, how sure
 * are you. The answer is a *proposal*, never an inventory row -- the human
 * review in step 3 decides that (see controllers/device.controller.js).
 *
 * Three properties this module is built around:
 *
 *  1. **No key, no failure.** With GEMINI_API_KEY unset it returns
 *     `{ provider: 'none', detected: false }` and the upload still succeeds.
 *     The photo is kept and the review screen becomes a manual form beside it.
 *     A missing optional credential must never take a feature offline.
 *
 *  2. **A model that says something wrong beats an exception.** Every network
 *     error, timeout and malformed response is caught and downgraded to the
 *     same "no detection" shape, because a failed recognition only costs the
 *     user a typed field -- an unhandled rejection costs the whole upload.
 *
 *  3. **Dates come back as YYYY-MM-DD or not at all.** Packaging prints
 *     "BEST BEFORE 15/08/26" in a dozen formats; parsing them here (where the
 *     rules can be tested) rather than in the controller keeps a misread date
 *     from ever reaching `food_items`.
 */

/** Categories the rest of the app already uses (food item form datalist). */
const KNOWN_CATEGORIES = [
  'Dairy', 'Vegetables', 'Fruits', 'Grains', 'Pulses', 'Spices',
  'Bakery', 'Meat', 'Frozen', 'Snacks', 'Beverages', 'Condiments',
];

const PROMPT = `You are reading a photo taken by a fixed kitchen camera pointing at one food product or its packaging.

Reply with ONLY a JSON object, no markdown, no commentary:
{
  "name": string,            // the food item's common name, <= 60 chars, e.g. "Amul Milk"
  "category": string,        // exactly one of: ${KNOWN_CATEGORIES.join(', ')} — or "" if unclear
  "expiryDate": string,      // "YYYY-MM-DD" printed on the pack, or null if not readable
  "confidence": number,      // 0.0 - 1.0, how sure you are of the item identity
  "rawText": string          // any dates/labels you could read verbatim, <= 300 chars, or ""
}

Rules:
- If the photo shows no food or packaging at all, return {"name": null, "category": null, "expiryDate": null, "confidence": 0, "rawText": ""}.
- Never invent an expiry date. If no date is legible, expiryDate must be null.
- If the date has no year visible, use null rather than guessing.`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `'2026-11-05'` -> valid; anything the model freestyled -> null. */
function realDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const ok =
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  // A date in the far past is a misread, not a real expiry.
  const plausible = y >= new Date().getFullYear() - 1 && y <= new Date().getFullYear() + 30;
  return ok && plausible ? value : null;
}

function clampConfidence(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(0, n));
}

/** Shape returned for "we have nothing" -- also the shape of every failure. */
const NO_DETECTION = Object.freeze({
  detected: false,
  provider: 'none',
  name: null,
  category: null,
  expiryDate: null,
  confidence: null,
  rawText: null,
});

/**
 * Strip the ```json fences and any prose a model wraps its answer in, then
 * take the first balanced {...} span. Models routinely add a sentence even
 * when told not to; parsing should not need a second try because of it.
 */
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < candidate.length; i += 1) {
    if (candidate[i] === '{') depth += 1;
    else if (candidate[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Propose an item from a photo.
 *
 * @param {Buffer} imageBuffer decoded JPEG bytes straight off the device
 * @returns {Promise<object>} always resolves, never throws -- see NO_DETECTION
 */
export async function recognizeFood(imageBuffer) {
  if (!env.vision.apiKey) return { ...NO_DETECTION };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.vision.timeoutMs);

  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(env.vision.model)}:generateContent`;

    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.vision.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PROMPT },
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: imageBuffer.toString('base64'),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          // The prompt demands bare JSON; this asks the API to enforce it,
          // which removes most of the "wrapped it in prose anyway" cases.
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) {
      // 429 on the free tier is rate limiting, not a bug -- same degrade path.
      console.warn(`[vision] ${env.vision.model} answered ${res.status}`);
      return { ...NO_DETECTION };
    }

    const payload = await res.json();
    const text = payload?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('');
    const parsed = text ? extractJson(text) : null;
    if (!parsed) {
      console.warn('[vision] response had no parseable JSON');
      return { ...NO_DETECTION };
    }

    if (!parsed.name || typeof parsed.name !== 'string') {
      // The model explicitly reported "nothing recognisable here".
      return { ...NO_DETECTION };
    }

    const category =
      typeof parsed.category === 'string' && KNOWN_CATEGORIES.includes(parsed.category)
        ? parsed.category
        : null;

    const confidence = clampConfidence(parsed.confidence);

    return {
      detected: true,
      provider: env.vision.model,
      name: parsed.name.trim().slice(0, 150),
      category,
      expiryDate: realDate(parsed.expiryDate),
      // A missing confidence is not "0 confident" -- it is unknown, and the UI
      // treats the two differently (unknown hides the badge instead of
      // shouting LOW).
      confidence,
      rawText:
        typeof parsed.rawText === 'string'
          ? parsed.rawText.trim().slice(0, 500) || null
          : null,
    };
  } catch (err) {
    // AbortError is our own timeout; everything else is network/parse.
    const reason = err?.name === 'AbortError' ? 'timed out' : (err?.message ?? 'failed');
    console.warn(`[vision] recognition ${reason} -- returning no detection`);
    return { ...NO_DETECTION };
  } finally {
    clearTimeout(timer);
  }
}
