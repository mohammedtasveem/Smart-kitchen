import { STATUS_META } from '../utils/date.js';

/** Fresh / Near expiry / Expired chip. Colour comes from the CSS class. */
export default function StatusBadge({ status, consumed = false }) {
  if (consumed) {
    return (
      <span className="badge badge-consumed">
        <span className="dot" aria-hidden="true" />
        Used
      </span>
    );
  }

  const meta = STATUS_META[status];
  if (!meta) return null;

  return (
    <span className={`badge badge-${meta.key}`}>
      <span className="dot" aria-hidden="true" />
      {meta.label}
    </span>
  );
}
