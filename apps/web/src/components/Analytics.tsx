'use client';

import { Analytics as VercelAnalytics } from '@vercel/analytics/react';

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
        let parsed: URL;
        try {
          parsed = new URL(event.url);
        } catch {
          // Si no se puede leer la URL, no se manda el evento. Una métrica de
          // menos no le cuesta nada a nadie.
          return null;
        }

        // Solo el patrón de ruta, nunca el identificador de una persona.
        const pathname = parsed.pathname.replace(UUID, ':id');

        // Se construye de nuevo: ni query, ni fragmento, ni credenciales.
        return { ...event, url: `${parsed.origin}${pathname}` };
      }}
    />
  );
}
