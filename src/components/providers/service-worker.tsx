'use client';

import { useEffect } from 'react';

/**
 * Register the offline service worker.
 *
 * Registered from a client component rather than inline markup because the CSP
 * forbids inline scripts — this file ships as a normal hashed chunk and needs
 * no nonce.
 *
 * Deliberately silent on failure. A browser with service workers disabled, or a
 * private window, still runs the whole app online; there is nothing useful to
 * tell a rep about it mid-shift.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    // Registration competes with the first data fetches for bandwidth, and the
    // rep needs those first. Waiting for load costs nothing — the worker only
    // matters on the NEXT launch.
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);
  return null;
}
