import React, { useCallback, useEffect, useState } from 'react';
import { subscribe } from '../utils/toastStore';

function Toast({ toast, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  // Errors + warnings interrupt assistive-tech reading. Info /
  // success are polite — they announce when the reader is idle.
  const live = toast.type === 'error' || toast.type === 'warning' ? 'assertive' : 'polite';
  return (
    <div
      className={`toast toast-${toast.type}`}
      role={live === 'assertive' ? 'alert' : 'status'}
      aria-live={live}
      onClick={() => onDismiss(toast.id)}
    >
      <span className="toast-icon" aria-hidden>
        {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : toast.type === 'warning' ? '⚠' : 'ℹ'}
      </span>
      <span className="toast-message">{toast.message}</span>
    </div>
  );
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    return subscribe((toast) => {
      setToasts((prev) => [...prev.slice(-4), toast]); // max 5 visible
    });
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-label="Notifications">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}
