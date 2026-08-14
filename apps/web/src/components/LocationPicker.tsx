'use client';

import { useState } from 'react';

export interface Coords {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
}

/**
 * Captura de la ubicación desde el GPS del dispositivo.
 *
 * Se guarda la precisión reportada por el navegador, no solo las coordenadas.
 * Bajo escombros o en zona montañosa la lectura puede errar cientos de metros,
 * y el motor de matching tiene que saber si está comparando contra un punto
 * exacto o contra una nube difusa.
 */
export function LocationPicker({
  value,
  onChange,
  label,
  hint,
}: {
  value: Coords | null;
  onChange: (coords: Coords | null) => void;
  label: string;
  hint: string;
}) {
  const [status, setStatus] = useState<'idle' | 'locating' | 'denied' | 'unavailable'>('idle');

  const locate = () => {
    if (!navigator.geolocation) {
      setStatus('unavailable');
      return;
    }

    setStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Math.round(position.coords.accuracy),
        });
        setStatus('idle');
      },
      (error) => setStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  };

  return (
    <div className="mt-5">
      <p className="text-[16px] font-semibold">
        {label}
        <span className="ml-2 text-[13px] font-normal text-ink-faint">opcional</span>
      </p>
      <p className="mb-1.5 mt-0.5 text-[14px] leading-snug text-ink-faint">{hint}</p>

      {value ? (
        <div className="mt-1.5 border-2 border-ink px-3 py-3">
          <p className="num text-[15px] font-semibold">
            {value.latitude.toFixed(5)} N {Math.abs(value.longitude).toFixed(5)} W
          </p>
          {value.accuracyMeters !== undefined && (
            <p className="num mt-0.5 text-[13px] text-ink-faint">
              precisión ±{value.accuracyMeters} m
            </p>
          )}
          <button
            type="button"
            onClick={() => onChange(null)}
            className="mt-2 text-[15px] underline underline-offset-4"
          >
            Quitar ubicación
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={locate}
          disabled={status === 'locating'}
          className="mt-1.5 flex min-h-[56px] w-full items-center justify-center border-2 border-ink px-4 text-[16px] font-medium disabled:opacity-50"
        >
          {status === 'locating' ? 'Buscando tu ubicación…' : 'Usar mi ubicación actual'}
        </button>
      )}

      {status === 'denied' && (
        <p className="mt-2 text-[14px]" style={{ color: 'var(--color-naranja)' }}>
          El navegador bloqueó el acceso a la ubicación. Puedes continuar sin ella y describir el
          sitio con palabras más abajo.
        </p>
      )}
      {status === 'unavailable' && (
        <p className="mt-2 text-[14px]" style={{ color: 'var(--color-naranja)' }}>
          No se pudo obtener la ubicación. Describe el sitio con palabras más abajo.
        </p>
      )}
    </div>
  );
}
