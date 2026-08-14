'use client';

import { useEffect, useState } from 'react';

/**
 * Tiempo transcurrido desde el sismo, contando en vivo.
 *
 * Es lo único que se mueve en toda la interfaz, y es deliberado: en búsqueda y
 * rescate el tiempo transcurrido no es un adorno, es la variable que define las
 * probabilidades. Poner ese número arriba de todo y dejarlo correr dice lo que
 * la página tiene que decir sin escribir una sola frase dramática.
 *
 * Con `prefers-reduced-motion` el contador baja a granularidad de minutos: la
 * información sigue ahí, deja de parpadear.
 */
export function ElapsedSince({ iso }: { iso: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const period = reduced ? 60_000 : 1_000;

    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), period);
    return () => window.clearInterval(timer);
  }, []);

  // Hasta que monte en el cliente no se renderiza el valor: el reloj del
  // servidor y el del navegador no coinciden y produciría un error de
  // hidratación.
  if (now === null) {
    return <span className="num tabular-nums opacity-0">0 d 00 h 00 m 00 s</span>;
  }

  const totalSeconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return (
    <span className="num tabular-nums">
      {days} d {String(hours).padStart(2, '0')} h {String(minutes).padStart(2, '0')} m{' '}
      {String(seconds).padStart(2, '0')} s
    </span>
  );
}
