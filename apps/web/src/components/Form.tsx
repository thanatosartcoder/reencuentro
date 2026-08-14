'use client';

import { useId } from 'react';

/**
 * Controles de formulario.
 *
 * Campos grandes, bordes gruesos y etiquetas visibles siempre. Nada de
 * placeholders que hacen de etiqueta: desaparecen al escribir y quien está
 * llenando esto bajo presión pierde el hilo de qué le estaban preguntando.
 *
 * El texto de los campos es de 16 px como mínimo, que es el umbral por debajo
 * del cual Safari en iOS hace zoom automático al enfocar y descoloca la página.
 */

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: { id: string; describedBy?: string }) => React.ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="mt-5">
      <label htmlFor={id} className="block text-[16px] font-semibold">
        {label}
        {required && (
          <span aria-hidden className="ml-1" style={{ color: 'var(--color-roja)' }}>
            *
          </span>
        )}
        {!required && <span className="ml-2 text-[13px] font-normal text-ink-faint">opcional</span>}
      </label>

      {hint && (
        <p id={hintId} className="mb-1.5 mt-0.5 text-[14px] leading-snug text-ink-faint">
          {hint}
        </p>
      )}

      <div className={hint ? '' : 'mt-1.5'}>{children({ id, describedBy })}</div>

      {error && (
        <p id={errorId} className="mt-1.5 text-[14px] font-medium" style={{ color: 'var(--color-roja)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL =
  'w-full border-2 border-rule bg-paper px-3 py-3 text-[16px] focus:border-ink focus:outline-none';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={CONTROL} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={CONTROL} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={CONTROL} />;
}

/** Grupo de opciones como botones grandes: más fácil de acertar que un radio. */
export function ChoiceGroup<T extends string>({
  legend,
  hint,
  value,
  options,
  onChange,
  columns = 2,
}: {
  legend: string;
  hint?: string;
  value: T | '';
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  columns?: number;
}) {
  return (
    <fieldset className="mt-5">
      <legend className="text-[16px] font-semibold">{legend}</legend>
      {hint && <p className="mb-1.5 mt-0.5 text-[14px] leading-snug text-ink-faint">{hint}</p>}

      <div
        className="mt-1.5 grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={`flex min-h-[52px] cursor-pointer items-center justify-center border-2 px-3 py-2 text-center text-[15px] leading-tight ${
              value === option.value ? 'border-ink bg-ink text-paper' : 'border-rule'
            }`}
          >
            <input
              type="radio"
              name={legend}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SubmitButton({
  busy,
  disabled,
  children,
  busyLabel,
}: {
  busy: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  busyLabel: string;
}) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="mt-7 flex min-h-[60px] w-full items-center justify-center bg-ink px-4 text-[18px] font-semibold text-paper disabled:opacity-40"
    >
      {busy ? busyLabel : children}
    </button>
  );
}

/** Aviso de resultado. El tono lo fija el desenlace, no la estética. */
export function Notice({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'error';
  children: React.ReactNode;
}) {
  const color = {
    ok: 'var(--color-via)',
    warn: 'var(--color-naranja)',
    error: 'var(--color-roja)',
  }[tone];

  return (
    <div
      role="status"
      className="mt-5 border-l-4 bg-paper-sunk px-4 py-3 text-[16px] leading-snug"
      style={{ borderColor: color }}
    >
      {children}
    </div>
  );
}
