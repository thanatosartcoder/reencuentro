const CONFIDENCE_COLORS = [
  { min: 0.7, color: 'var(--color-via)', label: 'confirmado' },
  { min: 0.4, color: 'var(--color-amarilla)', label: 'sin confirmar hace rato' },
  { min: 0, color: 'var(--color-naranja)', label: 'puede estar vencido' },
] as const;

export function confidenceTone(confidence: number) {
  return CONFIDENCE_COLORS.find((c) => confidence >= c.min) ?? CONFIDENCE_COLORS[2];
}

/** "hace 45 min", "hace 6 h", "hace 2 d" — la unidad más gruesa que sigue siendo útil. */
export function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `hace ${hours} h`;

  return `hace ${Math.round(hours / 24)} d`;
}

/**
 * Medidor de decaimiento — el elemento firma de la interfaz.
 *
 * Todo dato de este sistema caduca, y el modo de fallo más peligroso es
 * confiar en información vencida: mandar a alguien por una vía que dejó de
 * estar despejada hace seis horas. El medidor pone la edad del dato en el mismo
 * renglón donde se lee el dato, en lugar de dejarla en una marca de tiempo que
 * nadie interpreta.
 *
 * La barra es de bandas duras y no de degradado: el degradado sugiere una
 * transición suave cuando lo que se comunica es un umbral.
 */
export function DecayMeter({
  confidence,
  lastConfirmedAt,
  halfLifeMinutes,
  confirmations,
  refutations,
  compact = false,
}: {
  confidence: number;
  lastConfirmedAt: string;
  halfLifeMinutes?: number;
  confirmations?: number;
  refutations?: number;
  compact?: boolean;
}) {
  const tone = confidenceTone(confidence);
  const pct = Math.round(confidence * 100);

  return (
    <div>
      <div
        className="decay"
        style={{ color: tone.color }}
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Confianza ${pct} por ciento, ${tone.label}`}
      >
        <div className="decay-fill" style={{ width: `${Math.max(2, pct)}%` }} />
      </div>

      {!compact && (
        <div className="num mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-ink-faint">
          <span style={{ color: tone.color }} className="font-semibold">
            {confidence.toFixed(2)}
          </span>
          <span aria-hidden>·</span>
          <span>{timeAgo(lastConfirmedAt)}</span>
          {halfLifeMinutes !== undefined && (
            <>
              <span aria-hidden>·</span>
              <span>media vida {formatHalfLife(halfLifeMinutes)}</span>
            </>
          )}
          {(confirmations ?? 0) > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>{confirmations} confirman</span>
            </>
          )}
          {(refutations ?? 0) > 0 && (
            <>
              <span aria-hidden>·</span>
              <span style={{ color: 'var(--color-roja)' }}>{refutations} refutan</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function formatHalfLife(minutes: number): string {
  if (minutes < 120) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}
