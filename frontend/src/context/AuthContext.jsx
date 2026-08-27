import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, clearToken, setToken, setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  // True until the stored token has been checked. Protected routes wait for
  // this -- otherwise a page reload flashes the login screen for a moment even
  // though the user is signed in.
  const [bootstrapping, setBootstrapping] = useState(true);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Ignore errors -- clear local state anyway
    }
    clearToken(); // Clear localStorage fallback
    setUser(null);
  }, []);

  // Registered before the bootstrap effect below, so a 401 from any request --
  // including the very first one -- lands here.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearToken(); // Clear localStorage fallback
      setUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      // Check if we have a token in localStorage (dev fallback) or cookie
      try {
        const data = await api.get('/auth/me');
        if (!cancelled) setUser(data.user);
      } catch {
        // Not logged in or token expired -- clear any stale token
        clearToken();
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await api.post('/auth/login', { email, password });
    // Token is in httpOnly cookie (production) AND in response body (dev fallback)
    if (data.token) setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const signup = useCallback(async (payload) => {
    const data = await api.post('/auth/signup', payload);
    // Token is in httpOnly cookie (production) AND in response body (dev fallback)
    if (data.token) setToken(data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const updateProfile = useCallback(async (patch) => {
    const data = await api.patch('/auth/me', patch);
    setUser(data.user);
    return data.user;
  }, []);

  const value = useMemo(
    () => ({ user, bootstrapping, login, signup, logout, updateProfile }),
    [user, bootstrapping, login, signup, logout, updateProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be used inside <AuthProvider>');
  return ctx;
}
