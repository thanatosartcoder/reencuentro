'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Field, Notice, SubmitButton, TextInput } from '@/components/Form';

const MIN_LENGTH = 12;

/**
 * Cambio de contraseña del operador.
 *
 * Se muestra de dos formas: como bloqueo obligatorio cuando la cuenta todavía
 * tiene la contraseña de la instalación —que está publicada en el repositorio,
 * así que hasta cambiarla la sesión no puede ver datos de personas— y como
 * opción normal desde el panel.
 *
 * Pide la contraseña actual aunque ya haya sesión: en una sala de crisis los
 * turnos rotan y las pantallas quedan abiertas, y un tercero no debería poder
 * apropiarse de una cuenta con dos clics.
 */
export function ChangePassword({
  token,
  forced,
  onDone,
  onCancel,
}: {
  token: string;
  forced: boolean;
  onDone: (newToken: string) => void;
  onCancel?: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = repeat.length > 0 && next !== repeat;
  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const canSubmit = current.length > 0 && next.length >= MIN_LENGTH && next === repeat;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await api.post<{ accessToken: string }>(
        '/auth/password',
        { currentPassword: current, newPassword: next },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      // El cambio invalida los tokens anteriores, así que se guarda el nuevo:
      // sin eso, quien acaba de hacer lo correcto se quedaría sin sesión.
      onDone(response.accessToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cambiar la contraseña.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      {forced ? (
        <>
          <span
            aria-hidden
            className="block h-1.5 w-16"
            style={{ background: 'var(--color-roja)' }}
          />
          <p className="eyebrow mt-3" style={{ color: 'var(--color-roja)' }}>
            Cambio obligatorio
          </p>
          <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-tight">
            Cambia tu contraseña antes de continuar
          </h1>
          <p className="mt-3 text-[16px] leading-snug text-ink-soft">
            Tu cuenta sigue con la contraseña que trae la instalación, y esa clave está
            publicada en el repositorio del proyecto. Cualquiera podría entrar y ver datos
            completos de personas desaparecidas, incluidos menores de edad.
          </p>
        </>
      ) : (
        <>
          <p className="eyebrow">Tu cuenta</p>
          <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-tight">
            Cambiar contraseña
          </h1>
        </>
      )}

      <form onSubmit={submit} noValidate>
        <Field label="Contraseña actual" required>
          {({ id }) => (
            <TextInput
              id={id}
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          )}
        </Field>

        <Field
          label="Contraseña nueva"
          hint={`Al menos ${MIN_LENGTH} caracteres. Una frase que recuerdes es más segura que algo corto y complicado.`}
          error={tooShort ? `Faltan ${MIN_LENGTH - next.length} caracteres` : undefined}
          required
        >
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
          )}
        </Field>

        <Field
          label="Repite la contraseña nueva"
          error={mismatch ? 'Las dos contraseñas no coinciden' : undefined}
          required
        >
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              aria-describedby={describedBy}
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              required
            />
          )}
        </Field>

        {error && <Notice tone="error">{error}</Notice>}

        <SubmitButton busy={busy} busyLabel="Cambiando…" disabled={!canSubmit}>
          Cambiar contraseña
        </SubmitButton>

        {!forced && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="mt-3 w-full text-[15px] underline underline-offset-4"
          >
            Volver al panel
          </button>
        )}
      </form>

      <p className="mt-6 text-[13px] leading-snug text-ink-faint">
        Al cambiarla, cualquier otra sesión abierta con tu cuenta queda cerrada. El cambio
        queda registrado en la bitácora, nunca la contraseña.
      </p>
    </div>
  );
}
