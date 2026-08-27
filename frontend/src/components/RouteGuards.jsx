import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../context/AuthContext.jsx';
import { FullPageSpinner } from './Feedback.jsx';

/**
 * Wraps every logged-in route.
 *
 * Both guards below wait for `bootstrapping` to finish. Redirecting before the
 * stored token has been checked would bounce a signed-in user to the login page
 * on every refresh.
 */
export function ProtectedRoute() {
  const { user, bootstrapping } = useAuth();
  const location = useLocation();

  if (bootstrapping) return <FullPageSpinner label="Checking your session" />;

  // `state.from` lets Login send the user back where they were headed.
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return <Outlet />;
}

/** Login / signup: pointless once you are already signed in. */
export function PublicOnlyRoute() {
  const { user, bootstrapping } = useAuth();

  if (bootstrapping) return <FullPageSpinner label="Checking your session" />;
  if (user) return <Navigate to="/" replace />;

  return <Outlet />;
}
