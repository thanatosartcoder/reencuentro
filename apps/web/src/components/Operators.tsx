'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Field, Notice, Select, SubmitButton, TextInput } from '@/components/Form';

/**
 * Alta de personal acreditado.
 *
 * Cada coincidencia espera a que una persona la confirme, y durante mucho
 * tiempo solo dos cuentas podían hacerlo. Sumar una tercera exigía tocar la
 * base de datos, así que el límite del sistema no era técnico: era cuánto
 * alcanzaba a revisar quien tuviera la contraseña. Esto abre esa puerta sin
 * abrirla de más.
 *
 * La invitación sale en dos piezas que hay que mandar por canales distintos.
 * Es incómodo a propósito: un enlace suelto reenviado en un grupo entrega una
 * cuenta con acceso al documento y el teléfono de familias que reportaron a un
 * desaparecido.
 */

type Role = 'ADMIN' | 'COORDINATOR' | 'VALIDATOR' | 'VIEWER';

interface OperatorRow {
  id: string;
  email: string;
  fullName: string;
  organization: string | null;
  role: Role;
  isActive: boolean;
  invitationPending: boolean;
  invitationExpiresAt: string | null;
  invitedByName: string | null;
  lastLoginAt: string | null;
}

interface Invitation {
  operator: OperatorRow;
  invitationToken: string;
  verificationCode: string;
  expiresAt: string;
}

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administra',
  COORDINATOR: 'Coordina',
  VALIDATOR: 'Valida coincidencias',
  VIEWER: 'Solo consulta',
};

/** Lo que cada rol puede hacer, en los términos de quien va a elegirlo. */
const ROLE_HELP: Record<Role, string> = {
  ADMIN: 'Todo lo anterior, y puede gestionar a otros administradores.',
  COORDINATOR: 'Valida, invita personal y actualiza las fuentes de datos.',
  VALIDATOR: 'Revisa coincidencias y decide si se avisa a la familia.',
  VIEWER: 'Ve el panel sin poder decidir nada.',
};

export function Operators({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<OperatorRow[] | null>(null);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const auth = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      setRows(await api.get<OperatorRow[]>('/operadores', { headers: auth }));
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'Necesitas rol de coordinador para gestionar cuentas.'
          : 'No se pudo cargar la lista.',
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const invite = async (form: HTMLFormElement) => {
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<Invitation>(
        '/operadores',
        {
          email: String(data.get('email') ?? '').trim(),
          fullName: String(data.get('fullName') ?? '').trim(),
          organization: String(data.get('organization') ?? '').trim() || undefined,
          role: data.get('role'),
        },
        { headers: auth },
      );
      setInvitation(result);
      setShowForm(false);
      form.reset();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo crear la invitación.');
    } finally {
      setBusy(false);
    }
  };

  const reinvite = async (row: OperatorRow) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<Omit<Invitation, 'operator'>>(
        `/operadores/${row.id}/reinvitar`,
        {},
        { headers: auth },
      );
      setInvitation({ ...result, operator: row });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo reenviar.');
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (row: OperatorRow, activo: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/operadores/${row.id}/estado`, { activo }, { headers: auth });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo cambiar el estado.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 w-full border-2 border-rule px-4 py-3 text-left hover:border-ink"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-[16px] font-semibold">Quién puede validar</span>
          <span className="text-[13px] text-ink-faint">ver e invitar →</span>
        </span>
      </button>
    );
  }

  const activos = rows?.filter((r) => r.isActive && !r.invitationPending).length ?? 0;

  return (
    <section className="mt-6 border-2 border-rule p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-semibold">Quién puede validar</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[15px] underline underline-offset-4"
        >
          Cerrar
        </button>
      </div>

      <p className="mt-1 text-[14px] leading-snug text-ink-soft">
        Cada coincidencia espera a que alguien la confirme. Cuantas menos personas revisen,
        más tiempo espera una familia.
      </p>

      {error && <Notice tone="error">{error}</Notice>}

      {invitation && (
        <InvitationHandoff
          invitation={invitation}
          onDone={() => setInvitation(null)}
        />
      )}

      {rows && (
        <ul className="mt-4">
          {rows.map((row) => (
            <li key={row.id} className="rule py-3 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-[16px] font-semibold">{row.fullName}</span>
                <span className="stamp text-ink-faint">{ROLE_LABEL[row.role]}</span>
              </div>

              <p className="mt-0.5 text-[14px] leading-snug text-ink-soft">
                {row.email}
                {row.organization && ` · ${row.organization}`}
              </p>

              <p className="num mt-1 flex flex-wrap gap-x-3 text-[13px] text-ink-faint">
                {row.invitationPending ? (
                  <span style={{ color: 'var(--color-naranja)' }}>
                    invitación sin aceptar
                  </span>
                ) : !row.isActive ? (
                  <span style={{ color: 'var(--color-roja)' }}>desactivada</span>
                ) : row.lastLoginAt ? (
                  <span>última entrada {new Date(row.lastLoginAt).toLocaleDateString('es-CO')}</span>
                ) : (
                  <span>sin entrar todavía</span>
                )}
                {row.invitedByName && <span>invitó {row.invitedByName}</span>}
              </p>

              <div className="mt-2 flex flex-wrap gap-3 text-[14px]">
                {row.invitationPending && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void reinvite(row)}
                    className="underline underline-offset-4 disabled:opacity-40"
                  >
                    Generar invitación nueva
                  </button>
                )}
                {!row.invitationPending && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void setActive(row, !row.isActive)}
                    className="underline underline-offset-4 disabled:opacity-40"
                  >
                    {row.isActive ? 'Desactivar' : 'Reactivar'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {activos === 1 && (
        <p
          className="mt-4 border-l-4 pl-2.5 text-[13px] leading-snug"
          style={{ borderColor: 'var(--color-naranja)' }}
        >
          Solo hay una cuenta activa para revisar. Si esa persona no está disponible, las
          coincidencias se acumulan sin que nadie avise a las familias.
        </p>
      )}

      {showForm ? (
        <form
          className="mt-5 border-2 border-rule p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void invite(e.currentTarget);
          }}
        >
          <p className="eyebrow">Invitar</p>

          <Field label="Nombre y apellido" required>
            {({ id }) => (
              <TextInput id={id} name="fullName" required autoComplete="off" />
            )}
          </Field>

          <Field label="Correo" required>
            {({ id }) => (
              <TextInput id={id} name="email" type="email" required autoComplete="off" />
            )}
          </Field>

          <Field label="Organización" hint="Aparece junto a cada decisión que tome.">
            {({ id }) => <TextInput id={id} name="organization" autoComplete="off" />}
          </Field>

          <Field label="Qué podrá hacer" required>
            {({ id }) => (
            <Select id={id} name="role" defaultValue="VALIDATOR">
              <option value="VALIDATOR">{ROLE_HELP.VALIDATOR}</option>
              <option value="COORDINATOR">{ROLE_HELP.COORDINATOR}</option>
              <option value="VIEWER">{ROLE_HELP.VIEWER}</option>
            </Select>
            )}
          </Field>

          <div className="mt-3 flex items-center gap-3">
            <SubmitButton busy={busy} busyLabel="Creando…">
              Crear invitación
            </SubmitButton>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-[15px] underline underline-offset-4"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mt-5 min-h-[44px] w-full border-2 border-ink px-3 text-[15px] font-semibold"
        >
          Invitar a alguien
        </button>
      )}
    </section>
  );
}

/**
 * Entrega de la invitación recién creada.
 *
 * Las dos piezas se muestran juntas una sola vez y no se pueden recuperar
 * después. Se presentan separadas, con su canal indicado, porque el error
 * natural es pegar ambas en el mismo mensaje — y eso deshace justo lo que la
 * partición conseguía.
 */
function InvitationHandoff({
  invitation,
  onDone,
}: {
  invitation: Invitation;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);

  const link =
    typeof window !== 'undefined'
      ? `${window.location.origin}/invitacion?token=${invitation.invitationToken}`
      : '';

  const copy = async (what: 'link' | 'code', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Sin portapapeles (contexto no seguro): el texto está a la vista para
      // seleccionarlo a mano.
    }
  };

  return (
    <div className="mt-4 border-2 border-ink p-3">
      <p className="eyebrow">Invitación para {invitation.operator.fullName}</p>

      <p className="mt-2 text-[15px] leading-snug">
        Mándale las dos piezas <strong>por canales distintos</strong>. Si van en el mismo
        mensaje, quien reenvíe ese chat entra con su cuenta.
      </p>

      <div className="mt-3">
        <p className="stamp text-ink-faint">1 · Por escrito (correo, chat)</p>
        <p className="num mt-1 break-all border-2 border-rule p-2 text-[13px]">{link}</p>
        <button
          type="button"
          onClick={() => void copy('link', link)}
          className="mt-1 text-[14px] underline underline-offset-4"
        >
          {copied === 'link' ? 'Copiado' : 'Copiar enlace'}
        </button>
      </div>

      <div className="mt-3">
        <p className="stamp text-ink-faint">2 · Por voz (llamada, radio, en persona)</p>
        <p className="num mt-1 border-2 border-rule p-2 text-[28px] font-bold tracking-[0.2em]">
          {invitation.verificationCode}
        </p>
        <button
          type="button"
          onClick={() => void copy('code', invitation.verificationCode)}
          className="mt-1 text-[14px] underline underline-offset-4"
        >
          {copied === 'code' ? 'Copiado' : 'Copiar código'}
        </button>
      </div>

      <p className="mt-3 text-[13px] leading-snug text-ink-faint">
        Caduca el {new Date(invitation.expiresAt).toLocaleDateString('es-CO')}. No se guarda en
        ningún lado: al cerrar esto desaparece, y si se pierde hay que generar otra.
      </p>

      <button
        type="button"
        onClick={onDone}
        className="mt-3 min-h-[44px] w-full border-2 border-ink px-3 text-[15px] font-semibold"
      >
        Ya la envié
      </button>
    </div>
  );
}
