import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

/** Short confirmation messages ("Item added"), auto-dismissed. */

const ToastContext = createContext(null);

const LIFETIME_MS = 3200;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  // Timers are cleared on dismiss so a fast double-action cannot leave a stray
  // timeout writing to state after the toast is already gone.
  const timers = useRef(new Map());
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message, tone = 'success') => {
      const id = nextId.current++;
      setToasts((list) => [...list, { id, message, tone }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), LIFETIME_MS)
      );
    },
    [dismiss]
  );

  const value = useMemo(
    () => ({
      success: (message) => push(message, 'success'),
      error: (message) => push(message, 'error'),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* aria-live so a screen reader announces the confirmation too. */}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast is-${t.tone}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast() must be used inside <ToastProvider>');
  return ctx;
}
