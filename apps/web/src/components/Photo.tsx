export interface PhotoRef {
  id: string;
  url: string;
  urlAvif?: string | null;
  width?: number | null;
  height?: number | null;
}

/**
 * Foto de una persona, con selección de formato en el navegador.
 *
 * El servidor guarda la misma imagen en WebP y en AVIF y ofrece las dos; el
 * navegador se queda con la primera que sabe decodificar. Negociar en el
 * servidor mirando la cabecera `Accept` costaría una consulta a la base por
 * cada imagen y obligaría a marcar la respuesta con `Vary`, que fragmenta la
 * caché del CDN. Esto no cuesta nada y cachea perfecto.
 *
 * `loading="lazy"` importa más de lo habitual aquí: el listado de desaparecidos
 * puede traer decenas de caras y quien lo abre suele estar en una red mala.
 * Descargar solo lo que se ve es la diferencia entre una lista usable y una que
 * no termina de cargar.
 */
export function Photo({
  photo,
  alt,
  className,
  eager = false,
}: {
  photo: PhotoRef | undefined | null;
  alt: string;
  className?: string;
  /** Para la foto principal de una ficha, que sí conviene cargar de inmediato. */
  eager?: boolean;
}) {
  if (!photo) return null;

  return (
    <picture>
      {photo.urlAvif && <source srcSet={photo.urlAvif} type="image/avif" />}
      <source srcSet={photo.url} type="image/webp" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.url}
        alt={alt}
        className={className}
        width={photo.width ?? undefined}
        height={photo.height ?? undefined}
        loading={eager ? 'eager' : 'lazy'}
        // Reservar el espacio antes de que llegue la imagen evita que el
        // listado salte mientras carga, que en una lista de caras es
        // desorientador justo cuando alguien la está escaneando.
        decoding="async"
      />
    </picture>
  );
}

/** Marco del mismo tamaño para cuando el reporte no trae foto. */
export function PhotoPlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-center border border-rule bg-paper-sunk ${className ?? ''}`}
    >
      <span className="eyebrow text-center leading-tight">
        sin
        <br />
        foto
      </span>
    </div>
  );
}
