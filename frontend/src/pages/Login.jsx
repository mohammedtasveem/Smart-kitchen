import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client.js';
import Field from '../components/Field.jsx';
import { Spinner } from '../components/Feedback.jsx';
import Icon from '../components/Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [values, setValues] = useState({ email: '', password: '' });
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
      await login(values.email, values.password);
      // Back to whatever page bounced them here, or the dashboard.
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details);
      setFormError(err.message || 'Could not sign you in');
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
            <h1>Welcome back</h1>
            <p>Sign in to see your kitchen inventory.</p>
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
              label="Email"
              name="email"
              required
              type="email"
              value={values.email}
              onChange={(e) => set('email', e.target.value)}
              error={errors.email}
              autoComplete="email"
              autoFocus
            />

            <Field
              label="Password"
              name="password"
              required
              type="password"
              value={values.password}
              onChange={(e) => set('password', e.target.value)}
              error={errors.password}
              autoComplete="current-password"
            />

            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              {submitting ? <Spinner label="Signing in" /> : <Icon name="arrowRight" size={17} />}
              Login
            </button>
          </form>
        </div>

        <p className="auth-switch">
          New here? <Link to="/signup">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
