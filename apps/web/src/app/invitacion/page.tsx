'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Field, Notice, SubmitButton, TextInput } from '@/components/Form';

/**
 * Aceptar una invitación para revisar coincidencias.
 *
 * Pide dos cosas que llegaron por caminos distintos: el enlace que abrió esta
 * página y un código que alguien dictó de viva voz. Quien solo tenga una mitad
 * no entra — y esa es la única razón por la que el paso existe, porque quien
 * entra ve el documento y el teléfono de familias que reportaron a alguien.
 *
 * La contraseña la elige quien la va a usar. Nadie más la conoce, y por eso la
 * bitácora puede responder quién consultó qué.
 */

export default function InvitationPage() {
  return (
    <Suspense fallback={<Shell><p className="mt-6 text-[16px] text-ink-soft">Cargando…</p></Shell>}>
      <AcceptInvitation />
    </Suspense>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-lg px-4 py-10">
      <p className="eyebrow">Reencuentro</p>
      <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight">
        Activar tu cuenta
      </h1>
      {children}
    </main>
  );
}

interface Invitee {
  fullName: string;
  organization: string | null;
  role: 'ADMIN' | 'COORDINATOR' | 'VALIDATOR' | 'VIEWER';
}

const ROLE_TEXT: Record<Invitee['role'], string> = {
  ADMIN: 'administrar la plataforma',
  COORDINATOR: 'coordinar validaciones y fuentes de datos',
  VALIDATOR: 'revisar coincidencias entre desaparecidos y avistamientos',
  VIEWER: 'consultar el panel',
};

function AcceptInvitation() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [invitee, setInvitee] = useState<Invitee | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setLinkError('Este enlace está incompleto. Pide que te lo reenvíen.');
      return;
    }
    api
      .get<Invitee>(`/operadores/invitacion?token=${encodeURIComponent(token)}`)
      .then(setInvitee)
      .catch((err) =>
        setLinkError(
          err instanceof ApiError
            ? err.message
            : 'No se pudo comprobar el enlace. Revisa tu conexión.',
        ),
      );
  }, [token]);

  const submit = async (form: HTMLFormElement) => {
    const data = new FormData(form);
    const password = String(data.get('password') ?? '');

    if (password !== String(data.get('confirm') ?? '')) {
      setError('Las dos contraseñas no coinciden.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.post('/operadores/invitacion', {
        token,
        code: String(data.get('code') ?? ''),
        password,
      });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'No se pudo activar la cuenta.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Shell>
        <Notice tone="ok">
          Cuenta activada. Ya puedes entrar con tu correo y la contraseña que acabas de elegir.
        </Notice>
        <Link
          href="/panel"
          className="mt-6 flex min-h-[60px] w-full items-center justify-center bg-ink px-4 text-[18px] font-semibold text-paper"
        >
          Entrar al panel
        </Link>
      </Shell>
    );
  }

  if (linkError) {
    return (
      <Shell>
        <Notice tone="error">{linkError}</Notice>
        <p className="mt-4 text-[16px] leading-snug text-ink-soft">
          Las invitaciones caducan a los siete días. Quien te invitó puede generar una nueva
          desde el panel.
        </p>
      </Shell>
    );
  }

  if (!invitee) {
    return (
      <Shell>
        <p className="mt-6 text-[16px] text-ink-soft">Comprobando el enlace…</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="mt-3 text-[17px] leading-snug">
        Hola, <strong>{invitee.fullName}</strong>
        {invitee.organization && ` (${invitee.organization})`}. Te invitaron a{' '}
        {ROLE_TEXT[invitee.role]}.
      </p>

      <p className="mt-3 text-[16px] leading-snug text-ink-soft">
        Vas a manejar datos de personas desaparecidas: nombres, documentos y teléfonos de
        familias que están buscando a alguien. Trátalos como lo que son.
      </p>

      {error && <Notice tone="error">{error}</Notice>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(e.currentTarget);
        }}
      >
        <Field
          label="Código de verificación"
          required
          hint="Los seis caracteres que te dictaron por teléfono o en persona. No llegan por escrito."
        >
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              name="code"
              required
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              inputMode="text"
              maxLength={12}
              placeholder="A2C-4EF"
              aria-describedby={describedBy}
              style={{ fontSize: '22px', letterSpacing: '0.18em' }}
            />
          )}
        </Field>

        <Field
          label="Tu contraseña"
          required
          hint="Mínimo 12 caracteres. La eliges tú y nadie más la conoce, ni quien te invitó."
        >
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              name="password"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              aria-describedby={describedBy}
            />
          )}
        </Field>

        <Field label="Repite la contraseña" required>
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              name="confirm"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              aria-describedby={describedBy}
            />
          )}
        </Field>

        <SubmitButton busy={busy} busyLabel="Activando…">
          Activar mi cuenta
        </SubmitButton>
      </form>

      <p className="mt-4 text-[13px] leading-snug text-ink-faint">
        Si fallas el código cinco veces, la invitación se anula y hay que generar otra. Es a
        propósito: así, un enlace que llegue a manos ajenas no sirve de nada.
      </p>
    </Shell>
  );
}
