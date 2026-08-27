/**
 * Date helpers.
 *
 * Everything here works on the plain 'YYYY-MM-DD' strings the API sends and
 * expects. The strings are never turned into Date objects and back -- that
 * round trip is what shifts an expiry date by a day in some timezones, and a
 * wrong expiry date makes the whole project wrong.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Today as 'YYYY-MM-DD' in the user's own timezone (matches MySQL CURDATE()). */
export function todayISO() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

/** '2026-08-25' -> '25 Aug 2026'. Pure string work, no Date parsing. */
export function formatDate(iso) {
  if (typeof iso !== 'string' || iso.length < 10) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  const month = MONTHS[Number(m) - 1];
  if (!month) return iso;
  return `${Number(d)} ${month} ${y}`;
}

/**
 * '2026-08-22T18:40:12.000Z' -> '23 Aug 2026'.
 *
 * For DATETIME columns only (created_at). Those ARE real instants, so converting
 * to the reader's local day is correct here -- the opposite of expiry_date,
 * which is a calendar date and must never be shifted.
 */
export function formatTimestamp(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * '2026-08-22T02:30:12.000Z' -> '08:00' in the reader's own timezone.
 *
 * Used where the calendar day is already shown by a heading, so repeating the
 * date on every row would be noise -- the clock time is the new information.
 */
export function formatClockTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Human sentence for the days-left number the API computes.
 * The backend owns the arithmetic; this only phrases it.
 */
export function expiryText(daysLeft) {
  if (typeof daysLeft !== 'number' || Number.isNaN(daysLeft)) return '';
  if (daysLeft < -1) return `Expired ${Math.abs(daysLeft)} days ago`;
  if (daysLeft === -1) return 'Expired yesterday';
  if (daysLeft === 0) return 'Expires today';
  if (daysLeft === 1) return 'Expires tomorrow';
  return `${daysLeft} days left`;
}

/** Class suffix + label for a status, used by badges and item cards. */
export const STATUS_META = {
  FRESH: { key: 'fresh', label: 'Fresh' },
  NEAR_EXPIRY: { key: 'near', label: 'Near expiry' },
  EXPIRED: { key: 'expired', label: 'Expired' },
};
