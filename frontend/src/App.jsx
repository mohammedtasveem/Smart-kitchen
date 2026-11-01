import { Route, Routes } from 'react-router-dom';

import Layout from './components/Layout.jsx';
import { ProtectedRoute, PublicOnlyRoute } from './components/RouteGuards.jsx';
import Alerts from './pages/Alerts.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Inventory from './pages/Inventory.jsx';
import Login from './pages/Login.jsx';
import NotFound from './pages/NotFound.jsx';
import Privacy from './pages/Privacy.jsx';
import Terms from './pages/Terms.jsx';
import Profile from './pages/Profile.jsx';
import Recipes from './pages/Recipes.jsx';
import Signup from './pages/Signup.jsx';

/**
 * Route table.
 *
 * The two guards are layout routes, so authentication is decided once per group
 * instead of per page -- a new protected page added inside <ProtectedRoute> is
 * protected automatically, the same reason the backend uses router.use(requireAuth).
 */
export default function App() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/recipes" element={<Recipes />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
      </Route>

      {/* Public documents: outside both route guards, so they read fine for a
          logged-out visitor checking the service before signup and for a
          logged-in user following the footer link. */}
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
