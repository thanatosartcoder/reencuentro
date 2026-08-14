const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:4000';

/**
 * Lectura desde un componente de servidor.
 *
 * En el servidor no existe el rewrite de `next.config.ts`, así que la URL tiene
 * que ser absoluta. Devuelve `null` en lugar de lanzar: si la API no responde,
 * la página debe renderizar con lo que tenga y decirlo, no romperse. Una
 * pantalla de error total en una app de emergencia es peor que una pantalla
 * incompleta y honesta.
 */
export async function serverGet<T>(
  path: string,
  options: { revalidate?: number } = {},
): Promise<T | null> {
  try {
    const response = await fetch(`${API_ORIGIN}/api${path}`, {
      next: { revalidate: options.revalidate ?? 30 },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
