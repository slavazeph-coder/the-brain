/**
 * Toast Notification Store
 *
 * Lightweight pub/sub store for toast notifications.
 * Components subscribe and receive { id, type, message, duration }.
 */

let listeners = [];
let toastId = 0;

export function subscribe(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

function emit(toast) {
  listeners.forEach((fn) => fn(toast));
}

export function toast(message, type = 'info', duration = 4000) {
  const id = ++toastId;
  emit({ id, type, message, duration });
  return id;
}

export function toastSuccess(message, duration) { return toast(message, 'success', duration); }
export function toastWarning(message, duration) { return toast(message, 'warning', duration); }
export function toastError(message, duration) { return toast(message, 'error', duration); }
export function toastInfo(message, duration) { return toast(message, 'info', duration); }
