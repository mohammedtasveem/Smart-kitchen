import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { cookRecipe, getRecipe, listRecipes } from '../api/recipes.js';
import { EmptyState, ItemGridSkeleton, RowsSkeleton, Spinner } from '../components/Feedback.jsx';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { expiryText } from '../utils/date.js';

/* -----------------------------------------------------------------------
   Filter defaults -- match the server defaults so the URL is clean on load
   ----------------------------------------------------------------------- */
const DEFAULT_MAX_MISSING = 3;
const SEARCH_DEBOUNCE_MS = 300;

/** Coverage ladder: 0 = only recipes you could cook right now. */
const MISSING_TABS = [
  { value: 0, label: 'Cookable now' },
  { value: 1, label: '≤ 1 missing' },
  { value: 2, label: '≤ 2 missing' },
  { value: 3, label: '≤ 3 missing' },
];

/* -----------------------------------------------------------------------
   Small pieces
   ----------------------------------------------------------------------- */

/**
 * The score bar.
 *
 * Colour is not decoration here: the score is `coverage x (0.7 + 0.3 x urgency)`,
 * so 70 is the mark where every ingredient is present. Emerald above it means
 * "you can cook this", amber below it means "you are short of something".
 */
function ScoreBar({ score, label }) {
  return (
    <div
      className="score-track"
      role="img"
      aria-label={label ?? `Match score ${score} out of 100`}
    >
      {/* A zero-width bar is invisible, so a matched-but-weak recipe would look
          identical to an unmatched one. Floor it at a sliver instead. */}
      <span
        className={`score-fill${score >= 70 ? ' is-high' : ''}`}
        style={{ width: `${score === 0 ? 0 : Math.max(score, 4)}%` }}
      />
    </div>
  );
}

/**
 * Per-ingredient urgency cue.
 *
 * The bands are the matcher's own (`URGENCY_POINTS`): 1 day, 3 days -- which is
 * also the NEAR_EXPIRY threshold in `v_food_items_status` -- then a week. A dot
 * is drawn only when there is urgency to show, so a fresh ingredient list stays
 * quiet instead of speckled.
 */
function UrgencyDot({ daysLeft }) {
  if (daysLeft === null || daysLeft === undefined || daysLeft > 7) return null;
  const tone = daysLeft <= 1 ? 'expired' : daysLeft <= 3 ? 'near' : 'fresh';
  return <span className={`urgency-dot is-${tone}`} aria-hidden="true" />;
}

/** "30 min · 3 servings". Both fields are nullable in the table. */
function RecipeMeta({ minutes, servings }) {
  if (!minutes && !servings) return null;
  return (
    <p className="recipe-meta">
      {minutes ? (
        <span>
          <Icon name="clock" size={13} />
          {minutes} min
        </span>
      ) : null}
      {servings ? (
        <span>
          <Icon name="users" size={13} />
          {servings === 1 ? '1 serving' : `${servings} servings`}
        </span>
      ) : null}
    </p>
  );
}

/* -----------------------------------------------------------------------
   Detail modal
   ----------------------------------------------------------------------- */

/**
 * One recipe, opened as a bottom sheet.
 *
 * `onClose(didCook)` -- the parent reloads the ranked list only when an item
 * was consumed, because closing a sheet the user merely read should not make
 * the whole grid flicker and re-fetch.
 */
function RecipeDetail({ recipeId, onClose }) {
  const toast = useToast();
  const [data, setData] = useState(null); // null = still loading
  const [error, setError] = useState('');
  const [cooking, setCooking] = useState(false);
  const [cooked, setCooked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError('');
    setCooked(false);
    getRecipe(recipeId)
      .then((res) => {
        if (!cancelled) setData(res.recipe);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [recipeId]);

  async function handleCook() {
    setCooking(true);
    try {
      const res = await cookRecipe(recipeId);
      setCooked(true);
      toast.success(
        `Marked ${res.consumedCount} item${res.consumedCount === 1 ? '' : 's'} as used`
      );
      const refreshed = await getRecipe(recipeId);
      setData(refreshed.recipe);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCooking(false);
    }
  }

  const match = data?.match;

  // Memoised because Modal keys its Escape/scroll-lock effect on `onClose` -- a
  // fresh closure every render would re-run that effect and steal focus back to
  // the dialog on every state change.
  const close = useCallback(() => onClose(cooked), [onClose, cooked]);

  return (
    <Modal title={data?.title ?? 'Recipe'} onClose={close}>
      {error ? (
        <div className="notice notice-error" role="alert">
          <Icon name="warning" size={17} />
          <span>{error}</span>
        </div>
      ) : !data ? (
        <div style={{ padding: '6px 0' }}>
          <RowsSkeleton count={5} label="Loading recipe" />
        </div>
      ) : (
        <div className="recipe-detail">
          <RecipeMeta minutes={data.readyInMinutes} servings={data.servings} />

          {/* The score, with the reason for it spelled out underneath -- a bare
              number would tell the user nothing they can act on. */}
          <div className="detail-score">
            <div className="detail-score-num">
              <b>{match.score}</b>
              <span>/100</span>
            </div>
            <div className="detail-score-body">
              <ScoreBar score={match.score} label={`Match score ${match.score} out of 100`} />
              <p className="detail-score-note">
                {match.haveCount} of {match.totalCore} core ingredient
                {match.totalCore === 1 ? '' : 's'} in your kitchen
                {match.missingCount > 0 &&
                  ` · ${match.missingCount} missing`}
                {match.expiringCount > 0 && (
                  <>
                    {' · '}
                    <b className="text-near">
                      {match.expiringCount} expire{match.expiringCount === 1 ? 's' : ''} soon
                    </b>
                  </>
                )}
              </p>
            </div>
          </div>

          {/* What you have vs. what the recipe wants. The row set is derived
              from the match block, not rebuilt here. */}
          <section>
            <h3 className="detail-section-head">Ingredients</h3>
            <ul className="ingredient-list">
              {match.have.map((h) => {
                // "Spinach -- Spinach" is noise; the second column only earns its
                // place when the item is named differently to the ingredient it
                // satisfied ("Tomato" matched by "Tomatoes").
                const sameWord = h.itemName.toLowerCase() === h.ingredient.toLowerCase();
                return (
                  // Keyed on the ingredient, not the item: one jar of yoghurt can
                  // satisfy two ingredients, so itemId is not unique here.
                  <li key={h.ingredient} className="ingredient-row is-have">
                    <UrgencyDot daysLeft={h.daysLeft} />
                    <span className="ingredient-name">{h.ingredient}</span>
                    <span className="ingredient-src">
                      {!sameWord && <span className="ingredient-item">{h.itemName}</span>}
                      {h.daysLeft !== null && h.daysLeft <= 3 && (
                        <span className="ingredient-days">{expiryText(h.daysLeft)}</span>
                      )}
                    </span>
                  </li>
                );
              })}
              {match.missing.map((m) => (
                <li key={m} className="ingredient-row is-missing">
                  <span className="dot-slot" aria-hidden="true" />
                  <span className="ingredient-name">{m}</span>
                  <span className="ingredient-src muted">not in kitchen</span>
                </li>
              ))}
            </ul>
            {match.pantry.length > 0 && (
              <p className="detail-pantry">
                Pantry (assumed): {match.pantry.join(', ')}
              </p>
            )}
          </section>

          {data.instructions && (
            <section>
              <h3 className="detail-section-head">Method</h3>
              <p className="detail-instructions">{data.instructions}</p>
            </section>
          )}

          <div className="detail-actions">
            {cooked ? (
              <div className="notice notice-brand">
                <Icon name="checkCircle" size={17} />
                <span>
                  Done — the {match.haveCount === 1 ? 'ingredient was' : `${match.haveCount} ingredients were`} marked
                  as used.
                </span>
              </div>
            ) : match.haveCount === 0 ? (
              <div className="notice notice-info">
                <Icon name="info" size={17} />
                <span>
                  Nothing here matches your kitchen yet — add the ingredients in your Inventory
                  first.
                </span>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={handleCook}
                disabled={cooking}
              >
                {cooking ? (
                  <Spinner label="Cooking" />
                ) : (
                  <Icon name="flame" size={17} />
                )}
                {cooking
                  ? 'Updating inventory…'
                  : `Cooked it — use ${match.haveCount} item${match.haveCount === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* -----------------------------------------------------------------------
   Recipe card (in the grid)
   ----------------------------------------------------------------------- */

/**
 * One recipe in the grid.
 *
 * The whole card is the hit target, so it is a button rather than a card with a
 * link buried in it -- on a phone the tap area is the card. Space is handled
 * explicitly with `preventDefault`, otherwise the key scrolls the page instead
 * of opening the sheet.
 */
function RecipeCard({ recipe, onOpen }) {
  const { match } = recipe;
  const urgent = match.expiringCount > 0;

  function open() {
    onOpen(recipe.id);
  }

  return (
    <article
      className={`recipe-card${urgent ? ' is-urgent' : ''}`}
      onClick={open}
      role="button"
      tabIndex={0}
      aria-label={`${recipe.title}, match score ${match.score} out of 100`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className="recipe-card-head">
        <span className="recipe-icon-wrap" aria-hidden="true">
          <Icon name="pot" size={21} />
        </span>
        {/* min-width:0 is what lets a long title ellipsis inside a flex row. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 className="recipe-title">{recipe.title}</h3>
          <RecipeMeta minutes={recipe.readyInMinutes} servings={recipe.servings} />
        </div>
        <span className="recipe-score">
          <b className="recipe-score-val">{match.score}</b>
          <small className="recipe-score-label">score</small>
        </span>
      </div>

      <ScoreBar score={match.score} label={`Match score ${match.score} out of 100`} />

      <div className="recipe-coverage">
        <span className="recipe-cov-have">
          <Icon name="check" size={13} />
          {match.haveCount}/{match.totalCore} ready
        </span>
        {match.missingCount > 0 && (
          <span className="recipe-cov-miss">{match.missingCount} missing</span>
        )}
        {urgent && (
          <span className="recipe-cov-urgent">
            <Icon name="flame" size={13} />
            {match.expiringCount} expiring
          </span>
        )}
      </div>

      {match.have.length > 0 && (
        // Four is enough to recognise the dish; the sheet has the full list.
        <ul className="recipe-have-list" aria-label="Ingredients you already have">
          {match.have.slice(0, 4).map((h) => (
            <li key={h.ingredient} className="recipe-have-item">
              <UrgencyDot daysLeft={h.daysLeft} />
              <span className="recipe-have-name">{h.ingredient}</span>
              {h.daysLeft !== null && h.daysLeft <= 3 && (
                <span className="recipe-have-days">{expiryText(h.daysLeft)}</span>
              )}
            </li>
          ))}
          {match.have.length > 4 && (
            <li className="recipe-have-more">+{match.have.length - 4} more</li>
          )}
        </ul>
      )}
    </article>
  );
}

/* -----------------------------------------------------------------------
   Summary bar
   ----------------------------------------------------------------------- */

/**
 * The one-line state of the kitchen above the grid.
 *
 * Expired stock is called out as *excluded* rather than silently dropped -- the
 * matcher refuses to recommend a dish around food that has gone off, and the
 * user needs to know that is why the list looks thin.
 */
function SummaryBar({ summary }) {
  if (!summary) return null;

  return (
    <p className="recipe-summary-bar">
      <span>
        <b>{summary.catalogueSize}</b> recipes
      </span>
      <span className="summary-sep" aria-hidden="true" />
      <span>
        <b>{summary.itemsUsable}</b> usable item{summary.itemsUsable === 1 ? '' : 's'}
      </span>
      {summary.itemsExpiringSoon > 0 && (
        <>
          <span className="summary-sep" aria-hidden="true" />
          <span className="text-near">
            <Icon name="flame" size={13} />
            <b>{summary.itemsExpiringSoon}</b> expiring soon
          </span>
        </>
      )}
      {summary.itemsExpired > 0 && (
        <>
          <span className="summary-sep" aria-hidden="true" />
          <span className="text-expired">
            <b>{summary.itemsExpired}</b> expired, excluded
          </span>
        </>
      )}
    </p>
  );
}

/* -----------------------------------------------------------------------
   Page
   ----------------------------------------------------------------------- */

export default function Recipes() {
  const searchRef = useRef(null);

  const [recipes, setRecipes] = useState(null); // null = first load has not finished
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [maxMissing, setMaxMissing] = useState(DEFAULT_MAX_MISSING);
  const [onlyExpiring, setOnlyExpiring] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Which recipe's detail sheet is open, by id.
  const [openId, setOpenId] = useState(null);

  // Wait for a pause in typing instead of ranking the catalogue per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // Same guard as the Inventory page: a slower earlier request must not
  // overwrite the results of a later one.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setRefreshing(true);
    setError('');
    try {
      const res = await listRecipes({
        search: debouncedSearch,
        // "Browse all" means the whole catalogue, so the missing-ingredient cap
        // has to be lifted too -- `includeUnmatched` alone only stops zero-score
        // recipes being dropped, it does not raise the cap.
        maxMissing: showAll ? 99 : maxMissing,
        onlyExpiring,
        includeUnmatched: showAll,
        limit: 30,
      });
      if (id !== requestId.current) return;
      setRecipes(res.recipes);
      setSummary(res.summary);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err.message);
      setRecipes((current) => current ?? []);
    } finally {
      if (id === requestId.current) setRefreshing(false);
    }
  }, [debouncedSearch, maxMissing, onlyExpiring, showAll]);

  useEffect(() => {
    load();
  }, [load]);

  function clearFilters() {
    setSearch('');
    setMaxMissing(DEFAULT_MAX_MISSING);
    setOnlyExpiring(false);
    setShowAll(false);
  }

  const closeSheet = useCallback(
    (didCook) => {
      setOpenId(null);
      // Only re-rank when the kitchen actually changed. Closing a sheet the user
      // only read should not make the whole grid flicker and re-fetch.
      if (didCook) load();
    },
    [load]
  );

  const filtersActive =
    Boolean(debouncedSearch) || onlyExpiring || showAll || maxMissing !== DEFAULT_MAX_MISSING;

  return (
    <div className="stack">
      <div className="spread page-head">
        <div>
          <h1>Recipes</h1>
          <p>
            Ranked by what is already in your kitchen, with items closest to their expiry date
            counting for the most.
          </p>
        </div>
        {refreshing && recipes !== null && (
          <span className="muted row" style={{ gap: 8 }}>
            <Spinner label="Updating" />
            Updating…
          </span>
        )}
      </div>

      <SummaryBar summary={summary} />

      <section className="card">
        {/* A form, so Enter in the search box submits instead of doing nothing.
            The list already reloads on every debounced change, so submitting is
            only a no-op the browser expects. */}
        <form
          className="filters"
          role="search"
          onSubmit={(event) => event.preventDefault()}
          style={{ marginBottom: 14 }}
        >
          <div className="field search-field" style={{ flex: 1 }}>
            <label htmlFor="recipe-search" className="sr-only">
              Search recipes
            </label>
            <Icon name="search" size={17} className="icon" />
            <input
              id="recipe-search"
              ref={searchRef}
              type="search"
              className="input"
              placeholder="Search recipes…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </form>

        {/* Two rows rather than one: the first answers "how much shopping am I
            willing to do", the second is a pair of independent switches. The
            first row is switched off while browsing everything, because the cap
            it sets is not being applied then and a highlighted tab would lie. */}
        <div className="pill-row" role="group" aria-label="How many missing ingredients">
          {MISSING_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              disabled={showAll}
              aria-pressed={!showAll && maxMissing === tab.value}
              className={`pill${!showAll && maxMissing === tab.value ? ' active' : ''}`}
              onClick={() => setMaxMissing(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="pill-row" style={{ marginTop: 8 }} role="group" aria-label="Extra filters">
          <button
            type="button"
            aria-pressed={onlyExpiring}
            className={`pill${onlyExpiring ? ' active' : ''}`}
            onClick={() => setOnlyExpiring((on) => !on)}
          >
            <Icon name="flame" size={15} />
            Rescues something
          </button>
          <button
            type="button"
            aria-pressed={showAll}
            className={`pill${showAll ? ' active' : ''}`}
            onClick={() => setShowAll((on) => !on)}
          >
            <Icon name="compass" size={15} />
            Browse all
          </button>
          {filtersActive && (
            <button type="button" className="pill" onClick={clearFilters}>
              <Icon name="undo" size={15} />
              Reset
            </button>
          )}
        </div>
      </section>

      {error && (
        <div className="notice notice-error" role="alert">
          <Icon name="warning" size={17} />
          <span>{error}</span>
        </div>
      )}

      {/* Expired stock is excluded from matching on purpose, and a user with a
          fridge full of expired food would otherwise see an empty page and read
          it as a bug. Say it before they wonder. */}
      {summary && summary.itemsUsable === 0 && summary.itemsExpired > 0 && (
        <div className="notice notice-warn">
          <Icon name="warning" size={17} />
          <span>
            Every item in your kitchen has expired, so nothing can be recommended safely. Clear
            them from your <Link to="/inventory">Inventory</Link> and add fresh stock.
          </span>
        </div>
      )}

      {recipes === null ? (
        <ItemGridSkeleton count={6} label="Finding recipes for your kitchen" />
      ) : recipes.length === 0 ? (
        <div className="card">
          {filtersActive ? (
            <EmptyState
              icon="search"
              title="No recipes match these filters"
              action={
                <button type="button" className="btn btn-secondary" onClick={clearFilters}>
                  <Icon name="undo" size={16} />
                  Clear filters
                </button>
              }
            >
              Allow more missing ingredients, or turn on “Browse all” to see the whole catalogue.
            </EmptyState>
          ) : summary?.catalogueSize === 0 ? (
            <EmptyState icon="pot" title="No recipes in the catalogue yet">
              The recipe catalogue has not been loaded into the database.
            </EmptyState>
          ) : (
            <EmptyState
              icon="cart"
              title="Nothing to suggest yet"
              action={
                <Link to="/inventory" className="btn btn-primary">
                  <Icon name="plus" size={17} />
                  Add an item
                </Link>
              }
            >
              Add a few ingredients to your inventory and recipes will appear here, sorted by what
              needs using up first.
            </EmptyState>
          )}
        </div>
      ) : (
        <div className="item-grid">
          {recipes.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} onOpen={setOpenId} />
          ))}
        </div>
      )}

      {openId !== null && <RecipeDetail recipeId={openId} onClose={closeSheet} />}
    </div>
  );
}
