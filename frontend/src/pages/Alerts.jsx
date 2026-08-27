import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  checkNow,
  getNotificationSummary,
  listNotifications,
  retryNotification,
  sendNow,
} from '../api/notifications.js';
import { EmptyState, RowsSkeleton, Spinner } from '../components/Feedback.jsx';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatClockTime, formatDate, todayISO } from '../utils/date.js';

const TYPE_TABS = [
  { value: '', label: 'All' },
  { value: 'expired', label: 'Expired' },
  { value: 'near_expiry', label: 'Near expiry' },
];

/** '0 8 * * *' -> 'every day at 08:00'. Anything else is shown as written. */
function describeCron(expr) {
  const daily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(expr ?? '');
  if (!daily) return expr || 'not configured';
  const [, minute, hour] = daily;
  return `every day at ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
}

/**
 * How this alert was delivered, in one chip.
 *
 * `in_app` rows are written as already sent -- being in this list *is* the
 * delivery -- so they get a neutral chip rather than a success one, which would
 * wrongly imply a message went out.
 */
function delivery(n) {
  if (n.channel !== 'whatsapp') return { label: 'In app', tone: 'consumed', icon: 'inbox' };
  if (n.status === 'sent') return { label: 'WhatsApp · sent', tone: 'fresh', icon: 'check' };
  if (n.status === 'failed') return { label: 'WhatsApp · failed', tone: 'expired', icon: 'warning' };
  return { label: 'WhatsApp · queued', tone: 'near', icon: 'clock' };
}

/** Alerts arrive newest-first, so pushing in order keeps each day's group sorted. */
function groupByDay(list) {
  const days = [];
  for (const n of list) {
    const last = days.at(-1);
    if (last && last.date === n.notifyDate) last.items.push(n);
    else days.push({ date: n.notifyDate, items: [n] });
  }
  return days;
}

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

export default function Alerts() {
  const { user } = useAuth();
  const toast = useToast();

  const [notifications, setNotifications] = useState(null); // null = still loading
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [retryingId, setRetryingId] = useState(null);

  const [type, setType] = useState('');
  const [todayOnly, setTodayOnly] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [listRes, summaryRes] = await Promise.all([
        listNotifications({ type, date: todayOnly ? todayISO() : '', limit: 100 }),
        getNotificationSummary(),
      ]);
      setNotifications(listRes.notifications);
      setSummary(summaryRes.summary);
    } catch (err) {
      setError(err.message);
      setNotifications((current) => current ?? []);
    }
  }, [type, todayOnly]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCheck() {
    setChecking(true);
    try {
      const { result } = await checkNow();
      if (result.created === 0) {
        toast.success(
          result.scanned === 0
            ? 'Already up to date — nothing new to alert'
            : `Checked ${result.scanned} item(s), no new alerts`
        );
      } else {
        toast.success(`${result.created} new alert${result.created === 1 ? '' : 's'}`);
      }
      // The response already carries a list, but it ignores the filters on this
      // page -- reloading keeps what is on screen consistent with the pills.
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setChecking(false);
    }
  }

  /**
   * Flushes the WhatsApp queue on demand (Phase 8).
   *
   * A refused message comes back with 200 and a reason, so a non-empty
   * `result.errors` is reported as a warning here rather than thrown -- the send
   * did happen, the provider just did not accept it.
   */
  async function handleSend() {
    setSending(true);
    try {
      const { result } = await sendNow();
      if (result.queued === 0) {
        toast.success('Nothing is waiting to be sent');
      } else if (result.alertsSent > 0) {
        toast.success(
          `${result.alertsSent} alert${result.alertsSent === 1 ? '' : 's'} sent in ` +
            `${result.messagesSent} message${result.messagesSent === 1 ? '' : 's'}` +
            (result.dryRun ? ' (simulated)' : '')
        );
      } else if (result.errors.length > 0) {
        toast.error(result.errors[0].error);
      } else {
        toast.success('Queue processed — nothing could be sent yet');
      }
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  }

  async function handleRetry(n) {
    setRetryingId(n.id);
    try {
      const { notification } = await retryNotification(n.id);
      if (notification.status === 'sent') toast.success('Alert resent');
      else if (notification.status === 'failed') toast.error(notification.errorMessage || 'Still failing');
      else toast.success('Back in the queue');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRetryingId(null);
    }
  }

  const days = groupByDay(notifications ?? []);
  const filtersActive = Boolean(type || todayOnly);
  const dryRun = summary?.delivery?.dryRun ?? false;
  const queued = summary?.pending ?? 0;

  return (
    <div className="stack">
      <div className="spread page-head">
        <div>
          <h1>Alerts</h1>
          <p>
            {summary?.schedule?.enabled
              ? `Your kitchen is checked ${describeCron(summary.schedule.cron)} (${
                  summary.schedule.timezone
                }).`
              : 'Automatic checks are turned off — use the button to check manually.'}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-primary" onClick={handleCheck} disabled={checking}>
            {checking ? <Spinner label="Checking" /> : <Icon name="refresh" size={16} />}
            Check now
          </button>
          {/* Only offered when there is something to flush -- a button that can
              only ever say "nothing queued" is noise. */}
          {queued > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleSend}
              disabled={sending}
            >
              {sending ? <Spinner label="Sending" /> : <Icon name="send" size={16} />}
              Send queued
              <span className="count-chip">{queued}</span>
            </button>
          )}
        </div>
      </div>

      <div className="stat-grid">
        <Stat
          label="Queued"
          value={summary?.pending ?? '—'}
          note="waiting to send"
          tone="near"
          icon="clock"
          alert={queued > 0}
        />
        <Stat
          label="Sent"
          value={summary?.sent ?? '—'}
          note="delivered"
          tone="fresh"
          icon="checkCircle"
        />
        <Stat
          label="Failed"
          value={summary?.failed ?? '—'}
          note="not delivered"
          tone="expired"
          icon="warning"
        />
        <Stat label="Total" value={summary?.total ?? '—'} note="all time" tone="fresh" icon="bell" />
      </div>

      {/* Dry run must be stated out loud: without this, "sent" on a row would
          read as a message that reached a phone when none left the server. */}
      {dryRun && (
        <div className="notice notice-warn">
          <Icon name="flask" size={17} />
          <span>
            <b>Simulation mode.</b> No WhatsApp credentials are configured, so sends are recorded
            without leaving the server. Everything else behaves exactly as it will in production.
          </span>
        </div>
      )}

      {/* Explain the empty WhatsApp queue before the user wonders about it. */}
      {summary && !summary.whatsappReady && (
        <div className="notice notice-brand">
          <Icon name="phone" size={17} />
          <span>
            {user.phone
              ? 'WhatsApp alerts are switched off, so these are recorded in the app only — '
              : 'No phone number on your account, so these are recorded in the app only — '}
            <Link to="/profile">go to Profile</Link>
          </span>
        </div>
      )}

      <section className="card">
        <div className="pill-row" role="tablist" aria-label="Alert type filter">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={type === tab.value}
              className={`pill${type === tab.value ? ' active' : ''}`}
              onClick={() => setType(tab.value)}
            >
              {tab.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={todayOnly}
            className={`pill${todayOnly ? ' active' : ''}`}
            onClick={() => setTodayOnly((on) => !on)}
          >
            <Icon name="calendar" size={15} />
            Today only
          </button>
        </div>
      </section>

      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="warning" size={17} />
          <span>{error}</span>
        </div>
      )}

      {notifications === null ? (
        <div className="card">
          <RowsSkeleton count={5} label="Loading your alerts" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="card">
          {filtersActive ? (
            <EmptyState
              icon="search"
              title="No alerts match these filters"
              action={
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setType('');
                    setTodayOnly(false);
                  }}
                >
                  <Icon name="undo" size={16} />
                  Clear filters
                </button>
              }
            >
              Try widening the filters to see your full alert history.
            </EmptyState>
          ) : (
            <EmptyState icon="bell" title="No alerts yet">
              Alerts appear here once an item is within 3 days of its expiry date.
            </EmptyState>
          )}
        </div>
      ) : (
        <div className="stack">
          {days.map((day) => (
            <section key={day.date} className="card">
              <div className="card-head">
                <h2>
                  <Icon name="calendar" size={18} />
                  {day.date === todayISO() ? 'Today' : formatDate(day.date)}
                  <span className="count-chip">{day.items.length}</span>
                </h2>
              </div>

              <div className="alert-log">
                {day.items.map((n) => {
                  const chip = delivery(n);
                  const canRetry = n.channel === 'whatsapp' && n.status === 'failed';
                  return (
                    <article
                      key={n.id}
                      className={`alert-row is-${n.type === 'expired' ? 'expired' : 'near'}`}
                    >
                      <div className="alert-row-main">
                        <p className="alert-message">{n.message}</p>
                        <div className="alert-row-meta">
                          <span
                            className={`badge badge-${n.type === 'expired' ? 'expired' : 'near'}`}
                          >
                            <span className="dot" aria-hidden="true" />
                            {n.type === 'expired' ? 'Expired' : 'Near expiry'}
                          </span>
                          <span className={`badge badge-${chip.tone}`}>
                            <Icon name={chip.icon} size={12} />
                            {chip.label}
                          </span>
                          {/* Only worth showing once it means something: a first
                              attempt that worked is the normal case. */}
                          {n.attempts > 1 && (
                            <span className="chip">
                              <Icon name="refresh" size={12} />
                              {n.attempts} attempts
                            </span>
                          )}
                          {/* Null once the item is deleted -- the alert itself is kept. */}
                          {n.foodItemName === null && <span className="muted">item removed</span>}
                        </div>
                        {/* Surface the provider's reason instead of leaving it in the DB. */}
                        {n.status === 'failed' && n.errorMessage && (
                          <p className="alert-reason">{n.errorMessage}</p>
                        )}
                      </div>

                      <div className="alert-side">
                        {/* Just the clock time -- the day is already the heading. */}
                        <time className="alert-time" dateTime={n.sentAt ?? n.createdAt}>
                          {formatClockTime(n.sentAt ?? n.createdAt)}
                        </time>
                        {canRetry && (
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() => handleRetry(n)}
                            disabled={retryingId === n.id}
                          >
                            {retryingId === n.id ? (
                              <Spinner label="Retrying" />
                            ) : (
                              <Icon name="refresh" size={14} />
                            )}
                            Retry
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
