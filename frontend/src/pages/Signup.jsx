import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client.js';
import Field from '../components/Field.jsx';
import { Spinner } from '../components/Feedback.jsx';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();

  const [values, setValues] = useState({ name: '', email: '', password: '', phone: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function set(name, value) {
    setValues((v) => ({ ...v, [name]: value }));
    if (errors[name]) setErrors((e) => ({ ...e, [name]: undefined }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setErrors({});
    setFormError('');
    setSubmitting(true);

    try {
      await signup(values);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details);
      setFormError(err.message || 'Could not create your account');
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-box stack">
        <div>
          <div className="auth-logo">
            <img src="/favicon.svg" alt="" />
            <strong>Smart Kitchen</strong>
          </div>
          <div className="auth-title">
            <h1>Create your account</h1>
            <p>Track expiry dates, get WhatsApp alerts, and discover recipes.</p>
          </div>
        </div>

        <div className="card">
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
              autoFocus
            />

            <Field
              label="Email"
              name="email"
              required
              type="email"
              value={values.email}
              onChange={(e) => set('email', e.target.value)}
              error={errors.email}
              autoComplete="email"
            />

            <Field
              label="Password"
              name="password"
              required
              type="password"
              value={values.password}
              onChange={(e) => set('password', e.target.value)}
              error={errors.password}
              autoComplete="new-password"
              hint="At least 8 characters"
            />

            <Field
              label="WhatsApp number"
              name="phone"
              type="tel"
              value={values.phone}
              onChange={(e) => set('phone', e.target.value)}
              error={errors.phone}
              autoComplete="tel"
              placeholder="+919876543210"
              hint="Used for expiry alerts. You can add it later from Profile."
            />

            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              {submitting ? (
                <Spinner label="Creating your account" />
              ) : (
                <Icon name="arrowRight" size={17} />
              )}
              Sign up
            </button>
          </form>
        </div>

        <p className="auth-legal">
          By creating an account you agree to our <Link to="/terms">Terms of
          Service</Link> and <Link to="/privacy">Privacy Policy</Link>. We collect
          only your name, email and — if you want WhatsApp alerts — a phone number.
        </p>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
