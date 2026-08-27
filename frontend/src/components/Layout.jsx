import { Link, NavLink, Outlet } from 'react-router-dom';

import Icon from './Icon.jsx';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * The app shell.
 *
 * One nav list, rendered twice, because the two form factors want genuinely
 * different furniture rather than the same bar restyled:
 *
 *   desktop (>= 1024px)  a fixed dark sidebar -- a top bar would eat vertical
 *                        space that a laptop has less of than width
 *   phone   (< 1024px)   a sticky top bar for identity plus a bottom tab bar for
 *                        navigation, which is where a thumb actually reaches
 *
 * Which one is visible is decided entirely in CSS (`.sidebar` / `.topbar` /
 * `.tabbar`), not by a JS media query. Nothing here re-renders on resize, and
 * the correct shell is painted on the first frame.
 */

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/inventory', label: 'Inventory', icon: 'package' },
  { to: '/recipes', label: 'Recipes', icon: 'pot' },
  { to: '/alerts', label: 'Alerts', icon: 'bell' },
  { to: '/profile', label: 'Profile', icon: 'user' },
];

/** "Noorain Kaladgi" -> "NK". Used for the avatar when there is no photo. */
function initials(name) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="shell">
      {/* ------------------------------------------------- desktop sidebar */}
      <aside className="sidebar">
        <Link to="/" className="sidebar-brand">
          <img src="/favicon.svg" alt="" />
          <span>
            Smart Kitchen
            <small>Expiry tracker</small>
          </span>
        </Link>

        <p className="side-label">Menu</p>
        <nav className="side-nav" aria-label="Main">
          {NAV.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => `side-link${isActive ? ' active' : ''}`}
            >
              <Icon name={link.icon} size={19} />
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="side-user">
            <span className="avatar" aria-hidden="true">
              {initials(user?.name)}
            </span>
            {/* min-width:0 on the wrapper is what lets the ellipsis work on a
                long email inside a flex row. */}
            <div style={{ minWidth: 0 }}>
              <div className="side-user-name">{user?.name}</div>
              <div className="side-user-mail">{user?.email}</div>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-on-dark btn-block"
            onClick={logout}
          >
            <Icon name="logout" size={16} />
            Logout
          </button>
        </div>
      </aside>

      <div className="content">
        {/* ------------------------------------------------- phone top bar */}
        <header className="topbar">
          <Link to="/" className="topbar-brand">
            <img src="/favicon.svg" alt="" />
            Smart Kitchen
          </Link>

          <div className="row" style={{ gap: 8 }}>
            <span className="avatar avatar-sm" title={user?.email} aria-hidden="true">
              {initials(user?.name)}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={logout}
            >
              <Icon name="logout" size={18} title="Logout" />
            </button>
          </div>
        </header>

        <main className="content-inner">
          <Outlet />

          <p className="foot-note">
            AI-Powered Smart Kitchen Management, Expiry Monitoring and Recipe
            Recommendation System
            <br />
            SECAB Institute of Engineering and Technology · B.E. Electronics and
            Communication Engineering
          </p>
        </main>
      </div>

      {/* --------------------------------------------------- phone tab bar */}
      <nav className="tabbar" aria-label="Main">
        {NAV.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) => `tab-link${isActive ? ' active' : ''}`}
          >
            <span className="tab-ico">
              <Icon name={link.icon} size={20} />
            </span>
            {link.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
