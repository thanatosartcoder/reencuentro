'use client';

// La variante de Next, no la genérica de React: resuelve el **patrón** de ruta
// (`/desaparecidos/[id]`) en vez de la ruta ya resuelta, así que el
// identificador de una persona no llega siquiera a formar parte del evento. El
// saneador de abajo se queda igual, como segunda barrera.
import { Analytics as VercelAnalytics } from '@vercel/analytics/next';

/**
 * Analítica de visitas, con las URLs saneadas antes de salir del navegador.
 *
 * Vercel Analytics no usa cookies ni sigue a nadie entre sitios, pero sí manda
 * la URL de cada visita. Y en esta aplicación la URL puede llevar dos cosas que
 * no deben salir de aquí:
 *
 * - `/invitacion?token=…` lleva **media credencial viva**. Durante siete días
 *   ese token, junto al código dictado aparte, activa una cuenta con acceso al
 *   documento y el teléfono de familias que reportaron a un desaparecido.
 * - `/desaparecidos/<uuid>` lleva el identificador de **una persona concreta**.
 *   Un registro de qué fichas se consultan y cuándo es un dato sobre esa
 *   persona y sobre quien la busca, no una métrica de tráfico.
 *
 * Así que la URL se **reconstruye desde cero** en vez de limpiarse: se toman el
 * origen y la ruta redactada, y nada más. Un saneador que borra la query puede
 * fallar y dejar pasar algo; uno que solo copia lo que se nombra explícitamente
 * no tiene por dónde filtrar.
 */

/** UUID v4 en cualquier segmento de la ruta. */
const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

export function Analytics() {
  return (
    <VercelAnalytics
      beforeSend={(event) => {
        // `url` llega absoluta, pero se acepta también una ruta suelta: si el
        // paquete cambiara de forma, el saneador tiene que seguir saneando en
        // vez de dejar pasar el evento entero.
        let origin = '';
        let pathname = event.url;

        try {
          const parsed = new URL(event.url);
          origin = parsed.origin;
          pathname = parsed.pathname;
        } catch {
          // Ruta relativa: se corta a mano en el primer `?` o `#`.
          pathname = event.url.split(/[?#]/)[0];
          if (!pathname.startsWith('/')) return null;
        }

        // Se construye de nuevo: ni query, ni fragmento, ni credenciales.
        return { ...event, url: `${origin}${pathname.replace(UUID, ':id')}` };
      }}
    />
  );
}
