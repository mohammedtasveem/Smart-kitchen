import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { getSummary, listFoodItems } from '../api/foodItems.js';
import Donut from '../components/Donut.jsx';
import { EmptyState, ItemGridSkeleton, StatGridSkeleton } from '../components/Feedback.jsx';
import Icon from '../components/Icon.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { expiryText, formatDate } from '../utils/date.js';

const ATTENTION_LIMIT = 6;

function Stat({ label, value, note, tone, icon, alert = false }) {
  return (
    <div className={`stat is-${tone}${alert ? ' is-alert' : ''}`}>
      <div className="stat-label">
        <Icon name={icon} size={14} />
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();

  const [summary, setSummary] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      // Both calls are independent, so they go out together rather than
      // waterfalling and doubling the time to first paint.
      const [summaryRes, listRes] = await Promise.all([
        getSummary(),
        listFoodItems({ limit: 100 }),
      ]);
      setSummary(summaryRes.summary);
      setItems(listRes.items);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The page keeps its own shape while loading -- heading, then tiles, then
  // cards -- so nothing jumps when the data lands.
  if (loading) {
    return (
      <div className="stack">
        <div className="skeleton sk-title" style={{ height: 34 }} />
        <StatGridSkeleton />
        <ItemGridSkeleton count={4} label="Loading your dashboard" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="notice notice-error" role="alert">
        <Icon name="warning" size={17} />
        <span>{error}</span>
      </div>
    );
  }

  // The list arrives sorted soonest-expiry-first, so expired items come first
  // and no re-sorting is needed here.
  const attention = items
    .filter((item) => item.expiryStatus !== 'FRESH')
    .slice(0, ATTENTION_LIMIT);

  const hasItems = summary.totalActive > 0 || summary.consumed > 0;

  return (
    <div className="stack">
      <section className="hero">
        <p className="hero-eyebrow">
          <Icon name="leaf" size={13} />
          Your kitchen today
        </p>
        <h1>Hello, {user.name.split(' ')[0]}</h1>
        <p>
          {summary.needsAttention > 0
            ? `${summary.needsAttention} item${
                summary.needsAttention === 1 ? '' : 's'
              } need${summary.needsAttention === 1 ? 's' : ''} your attention — check them before they go to waste.`
            : 'Nothing is expiring in the next three days. Everything in your kitchen looks good.'}
        </p>
        <div className="hero-actions">
          <Link to="/inventory" className="btn btn-primary">
            <Icon name="plus" size={17} />
            Add an item
          </Link>
          <Link to="/alerts" className="btn btn-on-dark">
            <Icon name="bell" size={16} />
            View alerts
          </Link>
        </div>
      </section>

      <div className="stat-grid">
        <Stat
          label="Near expiry"
          value={summary.nearExpiry}
          note="within 3 days"
          tone="near"
          icon="clock"
          alert={summary.nearExpiry > 0}
        />
        <Stat
          label="Expired"
          value={summary.expired}
          note="remove soon"
          tone="expired"
          icon="warning"
        />
        <Stat label="Fresh" value={summary.fresh} note="still good" tone="fresh" icon="check" />
        <Stat
          label="Total"
          value={summary.totalActive}
          note={`${summary.consumed} used`}
          tone="fresh"
          icon="package"
        />
      </div>

      {/* Phase 8 needs a number to send alerts to. Ask for it once, here, and
          only when it is actually missing. */}
      {!user.phone && (
        <div className="notice notice-brand">
          <Icon name="phone" size={17} />
          <span>
            Add your phone number to receive WhatsApp expiry alerts —{' '}
            <Link to="/profile">go to Profile</Link>
          </span>
        </div>
      )}

      {hasItems && (
        <section className="card">
          <div className="card-head">
            <h2>
              <Icon name="compass" size={18} />
              Freshness breakdown
            </h2>
          </div>
          <Donut
            total={summary.totalActive}
            label="in kitchen"
            segments={[
              {
                key: 'expired',
                label: 'Expired',
                value: summary.expired,
                color: 'var(--bad-500)',
              },
              {
                key: 'near',
                label: 'Near expiry',
                value: summary.nearExpiry,
                color: 'var(--near-500)',
              },
              {
                key: 'fresh',
                label: 'Fresh',
                value: summary.fresh,
                color: 'var(--brand-500)',
              },
            ]}
          />
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>
            <Icon name="warning" size={18} />
            Needs attention
          </h2>
          <Link to="/inventory">
            View all
            <Icon name="arrowRight" size={15} />
          </Link>
        </div>

        {!hasItems ? (
          <EmptyState
            icon="package"
            title="Your inventory is empty"
            action={
              <Link to="/inventory" className="btn btn-primary">
                <Icon name="plus" size={17} />
                Add your first item
              </Link>
            }
          >
            Add an item to get started — its expiry status is calculated for you.
          </EmptyState>
        ) : attention.length === 0 ? (
          <EmptyState icon="checkCircle" title="Nothing is expiring soon">
            All {summary.fresh} of your items are still fresh.
          </EmptyState>
        ) : (
          <div className="item-grid">
            {attention.map((item) => (
              <article
                key={item.id}
                className={`item is-${item.expiryStatus === 'EXPIRED' ? 'expired' : 'near'}`}
              >
                <div className="item-top">
                  <div>
                    <div className="item-name">{item.name}</div>
                    {item.category && <div className="item-category">{item.category}</div>}
                  </div>
                  <StatusBadge status={item.expiryStatus} />
                </div>
                <div className="item-meta">
                  <span>
                    <b>{item.quantity}</b> {item.unit}
                  </span>
                  <span>{formatDate(item.expiryDate)}</span>
                </div>
                <div
                  className={`item-expiry is-${
                    item.expiryStatus === 'EXPIRED' ? 'expired' : 'near'
                  }`}
                >
                  <Icon name={item.expiryStatus === 'EXPIRED' ? 'warning' : 'clock'} size={14} />
                  {expiryText(item.daysLeft)}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
