import { PanelClient } from './PanelClient';

/**
 * Envoltorio de servidor del panel de validación.
 *
 * Existe solo para poder marcar la ruta como dinámica. El nonce de la
 * Content-Security-Policy tiene que ser distinto en cada visita —si se pudiera
 * predecir, dejaría de servir— y eso obliga a generar el HTML por petición: una
 * página prerenderizada llevaría dentro un nonce fijo, horneado en el build.
 *
 * Se hace aquí y no en toda la aplicación a propósito. Las páginas públicas —la
 * portada, el mapa, el listado de desaparecidos— siguen saliendo estáticas,
 * porque son las que el service worker guarda para que la aplicación funcione
 * sin señal. Perder eso a cambio de endurecer la CSP sería un mal negocio: quien
 * busca a un familiar desde una zona sin cobertura no está expuesto a un XSS,
 * está expuesto a no tener red.
 *
 * El panel es el caso contrario: es la única pantalla con un token de sesión en
 * el navegador y datos personales en pantalla, y nadie lo usa sin conexión.
 */
export const dynamic = 'force-dynamic';

export default function PanelPage() {
  return <PanelClient />;
}
