import { useState } from 'react';

import { ApiError } from '../api/client.js';
import Field from './Field.jsx';
import { Spinner } from './Feedback.jsx';
import Icon from './Icon.jsx';

/**
 * Add / edit form for one food item. Shared by the Inventory page's "add" card
 * and its edit dialog, so both stay in step automatically.
 *
 * Validation is NOT duplicated here. The form submits, and if the backend
 * answers 400 the `details` map is dropped straight onto the fields. One set of
 * rules, on the server, where it cannot be bypassed.
 */

const UNITS = ['pcs', 'kg', 'g', 'litre', 'ml', 'packet', 'dozen', 'bottle', 'bunch'];

const COMMON_CATEGORIES = [
  'Dairy',
  'Vegetables',
  'Fruits',
  'Grains',
  'Pulses',
  'Spices',
  'Bakery',
  'Meat',
  'Frozen',
  'Snacks',
  'Beverages',
  'Condiments',
];

function initialState(item) {
  return {
    name: item?.name ?? '',
    category: item?.category ?? '',
    quantity: item?.quantity != null ? String(item.quantity) : '1',
    unit: item?.unit ?? 'pcs',
    // purchaseDate stays blank by default. Pre-filling today's date would
    // collide with adding an already-expired item, since purchase must not be
    // after expiry.
    purchaseDate: item?.purchaseDate ?? '',
    expiryDate: item?.expiryDate ?? '',
    notes: item?.notes ?? '',
  };
}

export default function FoodItemForm({
  item = null,
  knownCategories = [],
  onSubmit,
  onCancel = null,
  submitLabel = 'Save',
}) {
  const [values, setValues] = useState(() => initialState(item));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // The user's own categories first, then the standard list, no repeats.
  const categoryOptions = [
    ...new Set([...knownCategories, ...COMMON_CATEGORIES]),
  ];

  function set(name, value) {
    setValues((v) => ({ ...v, [name]: value }));
    // Clear the message for a field as soon as it is edited -- a stale red
    // border under a field the user just fixed is worse than none.
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setErrors({});
    setFormError('');
    setSubmitting(true);

    try {
      await onSubmit({
        name: values.name,
        category: values.category,
        // The API wants a number; an empty box becomes 0 and the server
        // rejects it with a clear message rather than silently storing 1.
        quantity: values.quantity === '' ? 0 : Number(values.quantity),
        unit: values.unit,
        purchaseDate: values.purchaseDate,
        expiryDate: values.expiryDate,
        notes: values.notes,
      });
      if (!item) setValues(initialState(null)); // adding: clear for the next item
    } catch (err) {
      if (err instanceof ApiError && err.details) {
        setErrors(err.details);
        setFormError(err.message);
      } else {
        setFormError(err.message || 'Something went wrong');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="stack" noValidate>
      {formError && (
        <div className="notice notice-error" role="alert">
          <Icon name="warning" size={17} />
          <span>{formError}</span>
        </div>
      )}

      <div className="form-grid">
        <Field
          label="Item name"
          name="name"
          required
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
          placeholder="e.g. Milk, Tomatoes, Flour"
          maxLength={150}
          autoComplete="off"
        />

        <Field
          label="Expiry date"
          name="expiryDate"
          required
          type="date"
          value={values.expiryDate}
          onChange={(e) => set('expiryDate', e.target.value)}
          error={errors.expiryDate}
          hint="The 'best before' date printed on the pack"
        />
      </div>

      <div className="form-grid cols-2">
        <Field
          label="Quantity"
          name="quantity"
          required
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          value={values.quantity}
          onChange={(e) => set('quantity', e.target.value)}
          error={errors.quantity}
        />

        <Field
          label="Unit"
          name="unit"
          required
          as="select"
          value={values.unit}
          onChange={(e) => set('unit', e.target.value)}
          error={errors.unit}
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </Field>
      </div>

      <div className="form-grid cols-2">
        <div>
          <Field
            label="Category"
            name="category"
            value={values.category}
            onChange={(e) => set('category', e.target.value)}
            error={errors.category}
            list="category-options"
            placeholder="e.g. Dairy"
            maxLength={60}
            autoComplete="off"
          />
          {/* A datalist suggests without restricting -- the column is free text. */}
          <datalist id="category-options">
            {categoryOptions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>

        <Field
          label="Purchase date"
          name="purchaseDate"
          type="date"
          value={values.purchaseDate}
          onChange={(e) => set('purchaseDate', e.target.value)}
          error={errors.purchaseDate}
        />
      </div>

      <Field
        label="Notes"
        name="notes"
        as="textarea"
        value={values.notes}
        onChange={(e) => set('notes', e.target.value)}
        error={errors.notes}
        placeholder="e.g. kept in the fridge door"
        maxLength={500}
      />

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? <Spinner label="Saving" /> : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
