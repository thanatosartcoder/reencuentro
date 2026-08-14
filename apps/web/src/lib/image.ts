const MAX_DIMENSION = 1280;
const QUALITY = 0.78;

/**
 * Comprime una foto en el dispositivo antes de guardarla o subirla.
 *
 * Una foto de la cámara de un teléfono pesa entre 4 y 12 MB. Subir eso por una
 * red saturada tarda minutos y a veces no termina nunca; y si el reporte se hizo
 * sin señal, ese archivo se queda ocupando el almacenamiento del teléfono, que
 * es el recurso que primero se agota en campo. Comprimir aquí baja el archivo a
 * unos 150 KB sin perder lo que importa: que la cara sea reconocible.
 *
 * Volver a dibujar la imagen en un canvas descarta además los metadatos EXIF,
 * que en una foto de teléfono suelen llevar las coordenadas GPS exactas de
 * dónde se tomó. Ese dato no puede viajar dentro de una imagen que va a un
 * listado público.
 */
export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    // Sin canvas se sube el original: peor, pero mejor que perder la foto.
    return file;
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return new Promise<Blob>((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', QUALITY);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
