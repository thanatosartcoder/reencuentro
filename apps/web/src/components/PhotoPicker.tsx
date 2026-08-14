'use client';

import { useState } from 'react';
import { compressImage, formatBytes } from '@/lib/image';

/**
 * Selección de foto con compresión inmediata.
 *
 * Se comprime al elegirla, no al enviarla, para que la persona vea el peso real
 * antes de comprometerse y para que el archivo que espera en la cola offline ya
 * sea pequeño.
 */
export function PhotoPicker({
  onChange,
  label = 'Foto de la persona',
  hint = 'Una foto reciente donde se le vea la cara. Ayuda mucho a que alguien la reconozca.',
}: {
  onChange: (blob: Blob | null) => void;
  label?: string;
  hint?: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [size, setSize] = useState<{ original: number; compressed: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setBusy(true);
    try {
      const blob = await compressImage(file);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(URL.createObjectURL(blob));
      setSize({ original: file.size, compressed: blob.size });
      onChange(blob);
    } catch {
      setSize(null);
      onChange(null);
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setSize(null);
    onChange(null);
  };

  return (
    <div className="mt-5">
      <p className="text-[16px] font-semibold">
        {label}
        <span className="ml-2 text-[13px] font-normal text-ink-faint">opcional</span>
      </p>
      <p className="mb-1.5 mt-0.5 text-[14px] leading-snug text-ink-faint">{hint}</p>

      {preview ? (
        <div className="mt-2 flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="Vista previa de la foto seleccionada"
            className="h-28 w-28 border-2 border-ink object-cover"
          />
          <div>
            {size && (
              <p className="num text-[13px] text-ink-faint">
                {formatBytes(size.original)} → {formatBytes(size.compressed)}
              </p>
            )}
            <button
              type="button"
              onClick={clear}
              className="mt-2 text-[15px] underline underline-offset-4"
            >
              Quitar foto
            </button>
          </div>
        </div>
      ) : (
        <label className="mt-1.5 flex min-h-[56px] cursor-pointer items-center justify-center border-2 border-dashed border-rule px-4 text-[16px] text-ink-soft">
          <input
            type="file"
            accept="image/*"
            // `capture` abre la cámara directamente en el teléfono, que es de
            // donde va a salir casi siempre la foto en campo.
            capture="environment"
            onChange={pick}
            className="sr-only"
          />
          {busy ? 'Preparando la foto…' : 'Elegir o tomar una foto'}
        </label>
      )}
    </div>
  );
}
