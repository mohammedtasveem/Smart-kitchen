import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createFoodItem,
  deleteFoodItem,
  getSummary,
  listFoodItems,
  setConsumed,
  updateFoodItem,
} from '../api/foodItems.js';
import { EmptyState, ItemGridSkeleton, Spinner } from '../components/Feedback.jsx';
import FoodItemCard from '../components/FoodItemCard.jsx';
import FoodItemForm from '../components/FoodItemForm.jsx';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../context/ToastContext.jsx';

const SEARCH_DEBOUNCE_MS = 300;

const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'EXPIRED', label: 'Expired', countKey: 'expired' },
  { value: 'NEAR_EXPIRY', label: 'Near expiry', countKey: 'nearExpiry' },
  { value: 'FRESH', label: 'Fresh', countKey: 'fresh' },
];

export default function Inventory() {
  const toast = useToast();

  const [items, setItems] = useState(null); // null = first load has not finished yet
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [includeConsumed, setIncludeConsumed] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Wait for a pause in typing instead of firing a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // Guards against out-of-order responses: with debounced search, an earlier
  // request can still land after a later one and overwrite fresher results.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setRefreshing(true);
    setError('');

    try {
      const [listRes, summaryRes] = await Promise.all([
        listFoodItems({ status, category, q: debouncedSearch, includeConsumed, limit: 200 }),
        getSummary(),
      ]);
      if (id !== requestId.current) return;
      setItems(listRes.items);
      setSummary(summaryRes.summary);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err.message);
      setItems((current) => current ?? []);
    } finally {
      if (id === requestId.current) setRefreshing(false);
    }
  }, [status, category, debouncedSearch, includeConsumed]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(payload) {
    // Errors are deliberately NOT caught here -- FoodItemForm needs the thrown
    // ApiError to map `details` onto its fields.
    await createFoodItem(payload);
    toast.success('Item added');
    setShowAdd(false);
    load();
  }

  async function handleUpdate(payload) {
    await updateFoodItem(editing.id, payload);
    toast.success('Item updated');
    setEditing(null);
    load();
  }

  async function handleConsume(item) {
    setBusyId(item.id);
    try {
      await setConsumed(item.id, !item.isConsumed);
      toast.success(
        item.isConsumed ? `${item.name} restored to inventory` : `${item.name} marked as used`
      );
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    const item = confirmDelete;
    setBusyId(item.id);
    setConfirmDelete(null);
    try {
      await deleteFoodItem(item.id);
      toast.success(`${item.name} deleted`);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const categories = summary?.categories ?? [];
  const filtersActive = Boolean(status || category || debouncedSearch || includeConsumed);

  return (
    <div className="stack">
      <div className="spread page-head">
        <div>
          <h1>Inventory</h1>
          <p>
            {summary
              ? `${summary.totalActive} item${summary.totalActive === 1 ? '' : 's'} in your kitchen${
                  summary.consumed ? `, ${summary.consumed} used` : ''
                }`
              : 'Loading…'}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowAdd((open) => !open)}
          aria-expanded={showAdd}
        >
          <Icon name={showAdd ? 'close' : 'plus'} size={17} />
          {showAdd ? 'Close form' : 'Add item'}
        </button>
      </div>

      {showAdd && (
        <section className="card">
          <div className="card-head">
            <h2>
              <Icon name="plus" size={18} />
              New item
            </h2>
          </div>
          <FoodItemForm
            knownCategories={categories}
            onSubmit={handleCreate}
            onCancel={() => setShowAdd(false)}
            submitLabel="Add item"
          />
        </section>
      )}

      <section className="card">
        <div className="filters" style={{ marginBottom: 16 }}>
          <div className="field search-field" style={{ flex: 1 }}>
            <label className="sr-only" htmlFor="search">
              Search items
            </label>
            {/* The magnifier is a real SVG sitting inside the field rather than an
                emoji in the placeholder, so it stays visible once text is typed. */}
            <Icon name="search" size={17} className="icon" />
            <input
              id="search"
              className="input"
              type="search"
              placeholder="Search items…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {categories.length > 0 && (
            <div className="field">
              <label className="sr-only" htmlFor="category-filter">
                Category
              </label>
              <select
                id="category-filter"
                className="select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          <label className="checkbox-card" style={{ whiteSpace: 'nowrap' }}>
            <input
              type="checkbox"
              checked={includeConsumed}
              onChange={(e) => setIncludeConsumed(e.target.checked)}
            />
            <span>Include used items</span>
          </label>
        </div>

        <div className="pill-row" role="tablist" aria-label="Status filter">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={status === tab.value}
              className={`pill${status === tab.value ? ' active' : ''}`}
              onClick={() => setStatus(tab.value)}
            >
              {tab.label}
              {tab.countKey && summary && (
                <span className="pill-count"> {summary[tab.countKey]}</span>
              )}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="warning" size={17} />
          <span>{error}</span>
        </div>
      )}

      {items === null ? (
        <ItemGridSkeleton count={6} label="Loading your items" />
      ) : items.length === 0 ? (
        <div className="card">
          {filtersActive ? (
            <EmptyState
              icon="search"
              title="No items match these filters"
              action={
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setStatus('');
                    setCategory('');
                    setSearch('');
                    setIncludeConsumed(false);
                  }}
                >
                  <Icon name="undo" size={16} />
                  Clear filters
                </button>
              }
            >
              Try a different search term, or clear the filters.
            </EmptyState>
          ) : (
            <EmptyState
              icon="package"
              title="Your inventory is empty"
              action={
                <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
                  <Icon name="plus" size={17} />
                  Add your first item
                </button>
              }
            >
              As soon as you add an item, its Fresh / Near expiry / Expired status appears
              automatically.
            </EmptyState>
          )}
        </div>
      ) : (
        <>
          {/* Filter changes reload in the background; this keeps the old list on
              screen with a quiet indicator instead of blanking the page. */}
          {refreshing && (
            <div className="row muted">
              <Spinner label="Updating" /> Updating…
            </div>
          )}
          <div className="item-grid">
            {items.map((item) => (
              <FoodItemCard
                key={item.id}
                item={item}
                busy={busyId === item.id}
                onConsume={handleConsume}
                onEdit={setEditing}
                onDelete={setConfirmDelete}
              />
            ))}
          </div>
        </>
      )}

      {editing && (
        <Modal title={`Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <FoodItemForm
            item={editing}
            knownCategories={categories}
            onSubmit={handleUpdate}
            onCancel={() => setEditing(null)}
            submitLabel="Save changes"
          />
        </Modal>
      )}

      {confirmDelete && (
        <Modal title="Delete this item?" onClose={() => setConfirmDelete(null)}>
          <div className="stack">
            <p>
              <strong>{confirmDelete.name}</strong> will be removed permanently. If you have
              finished the item, <em>“Mark used”</em> is the better choice — it keeps the item in
              your history.
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn-danger" onClick={handleDelete}>
                <Icon name="trash" size={16} />
                Yes, delete
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
