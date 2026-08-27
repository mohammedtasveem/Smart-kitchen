import Icon from './Icon.jsx';

export function Spinner({ large = false, label = 'Loading' }) {
  return (
    <>
      <span className={`spinner${large ? ' spinner-lg' : ''}`} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </>
  );
}

/** Full-viewport loader -- used while the stored token is being verified. */
export function FullPageSpinner({ label = 'Loading' }) {
  return (
    <div className="center-screen">
      <Spinner large label={label} />
      <span>{label}…</span>
    </div>
  );
}

/**
 * Empty state.
 *
 * Takes an `icon` name from the icon set rather than an emoji: emoji render as a
 * different picture on every platform (and as a box on some projectors), while a
 * stroked SVG matches the rest of the interface and inherits its colour.
 */
export function EmptyState({ icon = 'inbox', title, children, action = null }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={26} />
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

/* --------------------------------------------------------------- skeletons */
/*
 * Shown while a request is in flight, in the shape of the thing being fetched.
 * A block that matches the incoming layout tells the user what is coming and
 * keeps the page from jumping when it lands; a spinner alone on a blank page
 * looks like something has hung.
 *
 * All of these are `aria-hidden` with a single live label on the wrapper, so a
 * screen reader hears "Loading your items" once instead of reading out a dozen
 * meaningless boxes.
 */

/** Four stat tiles. */
export function StatGridSkeleton({ count = 4 }) {
  return (
    <div className="stat-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton sk-stat" />
      ))}
    </div>
  );
}

/** A grid of item cards. */
export function ItemGridSkeleton({ count = 6, label = 'Loading' }) {
  return (
    <>
      <span className="sr-only" role="status">
        {label}
      </span>
      <div className="item-grid" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="skeleton sk-card" />
        ))}
      </div>
    </>
  );
}

/** Stacked rows, for the alert log. */
export function RowsSkeleton({ count = 4, label = 'Loading' }) {
  return (
    <>
      <span className="sr-only" role="status">
        {label}
      </span>
      <div className="stack" style={{ gap: 9 }} aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="skeleton sk-row" />
        ))}
      </div>
    </>
  );
}
