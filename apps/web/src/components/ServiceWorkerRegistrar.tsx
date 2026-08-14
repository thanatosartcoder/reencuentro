'use client';

import { useEffect } from 'react';

/** Registra el service worker que hace que la app abra sin conexión. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // En desarrollo el service worker cachearía los bundles de Next y taparía
    // los cambios en caliente.
    if (process.env.NODE_ENV !== 'production') return;

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Sin service worker la app sigue funcionando online; solo pierde la
      // capacidad de abrirse sin señal.
    });
  }, []);

  return null;
}
