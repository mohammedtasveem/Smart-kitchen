import { useState } from 'react';

import { ApiError } from '../api/client.js';
import Field from '../components/Field.jsx';
import { Spinner } from '../components/Feedback.jsx';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatTimestamp } from '../utils/date.js';

export default function Profile() {
  const { user, updateProfile, logout } = useAuth();
  const toast = useToast();

  const [values, setValues] = useState({
    name: user.name,
    phone: user.phone ?? '',
    whatsappOptIn: Boolean(user.whatsappOptIn),
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  function set(name, value) {
    setValues((v) => ({ ...v, [name]: value }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  }

  const dirty =
    values.name !== user.name ||
    values.phone !== (user.phone ?? '') ||
    values.whatsappOptIn !== Boolean(user.whatsappOptIn);

  async function handleSubmit(event) {
    event.preventDefault();
    setErrors({});
    setFormError('');
    setSaving(true);

    try {
      // Send the whole set; the server treats an empty phone as "remove it".
      await updateProfile({
        name: values.name,
        phone: values.phone.trim(),
        whatsappOptIn: values.whatsappOptIn,
      });
      toast.success('Profile saved');
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details);
      setFormError(err.message || 'Could not save your changes');
    } finally {
      setSaving(false);
    }
  }

  // Opting in without a number would silently send nothing in Phase 8.
  const optInWithoutPhone = values.whatsappOptIn && !values.phone.trim();

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Profile</h1>
        <p>Update your name and WhatsApp alert settings.</p>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>
            <Icon name="user" size={18} />
            Account details
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="stack" noValidate>
          {formError && (
            <div className="notice notice-error" role="alert">
              <Icon name="warning" size={17} />
              <span>{formError}</span>
            </div>
          )}

          <Field
            label="Name"
            name="name"
            required
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            error={errors.name}
            autoComplete="name"
            maxLength={100}
          />

          <div className="field">
            <span className="label">Email</span>
            <input className="input" value={user.email} readOnly disabled />
            <p className="field-hint">Your email address cannot be changed.</p>
          </div>

          <Field
            label="WhatsApp number"
            name="phone"
            type="tel"
            value={values.phone}
            onChange={(e) => set('phone', e.target.value)}
            error={errors.phone}
            autoComplete="tel"
            placeholder="+919876543210"
            hint="Must use international format, starting with +91. Leave it empty to remove your number."
          />

          <label className="checkbox-card">
            <input
              type="checkbox"
              checked={values.whatsappOptIn}
              onChange={(e) => set('whatsappOptIn', e.target.checked)}
            />
            <span>
              <strong>Send expiry alerts on WhatsApp</strong>
              <br />
              <span className="muted">
                One message a day listing the items that are about to expire.
              </span>
            </span>
          </label>
          {errors.whatsappOptIn && <p className="field-error">{errors.whatsappOptIn}</p>}

          {optInWithoutPhone && (
            <div className="notice notice-warn">
              <Icon name="phone" size={17} />
              <span>Alerts are on but no number is saved — add your WhatsApp number first.</span>
            </div>
          )}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving || !dirty}>
              {saving ? <Spinner label="Saving" /> : <Icon name="check" size={17} />}
              Save changes
            </button>
            {dirty && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setValues({
                    name: user.name,
                    phone: user.phone ?? '',
                    whatsappOptIn: Boolean(user.whatsappOptIn),
                  });
                  setErrors({});
                  setFormError('');
                }}
              >
                <Icon name="undo" size={16} />
                Reset
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>
            <Icon name="shield" size={18} />
            Session
          </h2>
        </div>
        <div className="stack">
          <p className="muted">
            Member since <b>{formatTimestamp(user.createdAt)}</b>
          </p>
          <div>
            <button type="button" className="btn btn-danger" onClick={logout}>
              <Icon name="logout" size={16} />
              Logout
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
