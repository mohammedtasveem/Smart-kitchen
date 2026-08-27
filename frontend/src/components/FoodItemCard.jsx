import Icon from './Icon.jsx';
import StatusBadge from './StatusBadge.jsx';
import { expiryText, formatDate, STATUS_META } from '../utils/date.js';

/**
 * One item in the inventory grid.
 *
 * `expiryStatus` and `daysLeft` come straight from the API (the SQL view
 * computes them against today's date). Nothing here recalculates them -- the
 * "3 days = near expiry" rule lives in one place, in schema.sql.
 */
export default function FoodItemCard({ item, onConsume, onEdit, onDelete, busy = false }) {
  const statusKey = STATUS_META[item.expiryStatus]?.key ?? 'fresh';

  const classes = ['item'];
  if (item.isConsumed) classes.push('is-consumed');
  else if (statusKey !== 'fresh') classes.push(`is-${statusKey}`);

  return (
    <article className={classes.join(' ')}>
      <div className="item-top">
        <div>
          <div className={`item-name${item.isConsumed ? ' struck' : ''}`}>{item.name}</div>
          {item.category && <div className="item-category">{item.category}</div>}
        </div>
        <StatusBadge status={item.expiryStatus} consumed={item.isConsumed} />
      </div>

      <div className="item-meta">
        <span>
          <b>{item.quantity}</b> {item.unit}
        </span>
        <span>Expiry: {formatDate(item.expiryDate)}</span>
      </div>

      {!item.isConsumed && (
        <div className={`item-expiry is-${statusKey}`}>
          <Icon name={statusKey === 'expired' ? 'warning' : statusKey === 'near' ? 'clock' : 'check'} size={14} />
          {expiryText(item.daysLeft)}
        </div>
      )}

      {item.notes && <div className="item-notes">{item.notes}</div>}

      <div className="item-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onConsume(item)}
          disabled={busy}
        >
          <Icon name={item.isConsumed ? 'undo' : 'check'} size={15} />
          {item.isConsumed ? 'Restore' : 'Mark used'}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onEdit(item)}
          disabled={busy}
        >
          <Icon name="pencil" size={15} />
          Edit
        </button>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          onClick={() => onDelete(item)}
          disabled={busy}
        >
          <Icon name="trash" size={15} />
          Delete
        </button>
      </div>
    </article>
  );
}
