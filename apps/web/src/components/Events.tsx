'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Field, Notice, Select, SubmitButton, TextInput } from '@/components/Form';

/**
 * Alta y gestión de emergencias.
 *
 * Declarar una exigía escribir SQL contra la base de producción. Eso no es
 * sostenible para algo que ocurre justo cuando nadie tiene tiempo: una
 * emergencia empieza de madrugada y la plataforma tiene que poder cubrirla esa
 * misma mañana.
 *
 * Crear y activar están separados a propósito. Se puede preparar una
 * emergencia con calma —su epicentro, su radio, sus departamentos— y revisarla
 * antes de que el sitio entero empiece a mostrarla.
 */

type Kind = 'EARTHQUAKE' | 'FLOOD' | 'LANDSLIDE' | 'STORM' | 'OTHER';
type Status = 'ACTIVE' | 'MONITORING' | 'CLOSED';

interface EventRow {
  id: string;
  slug: string;
  nombre: string;
  tipo: Kind;
  ocurrioEl: string;
  estado: Status;
  principal: boolean;
  epicentro: { latitud: number; longitud: number } | null;
  radioKm: number | null;
  departamentos: string[];
  tieneCifrasOficiales: boolean;
}

const KIND_LABEL: Record<Kind, string> = {
  EARTHQUAKE: 'Sismo',
  FLOOD: 'Inundación',
  LANDSLIDE: 'Deslizamiento',
  STORM: 'Tormenta',
  OTHER: 'Otra',
};

const STATUS_LABEL: Record<Status, string> = {
  ACTIVE: 'en curso',
  MONITORING: 'en seguimiento',
  CLOSED: 'cerrada',
};

/** Solo los sismos tienen epicentro; el resto lo deja vacío. */
const CON_EPICENTRO: Kind[] = ['EARTHQUAKE'];

export function Events({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<EventRow[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [kind, setKind] = useState<Kind>('EARTHQUAKE');
  const [busy, setBusy] = useState(false);
  const [mensaje, setMensaje] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(
    null,
  );

  const auth = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      setRows(await api.get<EventRow[]>('/eventos'));
    } catch {
      setMensaje({ tone: 'error', text: 'No se pudo cargar la lista de emergencias.' });
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const crear = async (form: HTMLFormElement) => {
    const d = new FormData(form);
    const lat = String(d.get('lat') ?? '').trim();
    const lon = String(d.get('lon') ?? '').trim();
    const radio = String(d.get('radio') ?? '').trim();

    setBusy(true);
    setMensaje(null);
    try {
      await api.post(
        '/admin/eventos',
        {
          slug: String(d.get('slug') ?? '').trim(),
          name: String(d.get('name') ?? '').trim(),
          kind: d.get('kind'),
          occurredAt: new Date(String(d.get('occurredAt'))).toISOString(),
          epicenter: lat && lon ? { latitude: Number(lat), longitude: Number(lon) } : null,
          searchRadiusKm: radio ? Number(radio) : null,
          departments: String(d.get('departments') ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        },
        { headers: auth },
      );
      setMensaje({
        tone: 'ok',
        text: 'Emergencia creada. Todavía no se muestra: actívala cuando esté lista.',
      });
      setShowForm(false);
      form.reset();
      await load();
    } catch (err) {
      setMensaje({
        tone: 'error',
        text: err instanceof ApiError ? err.message : 'No se pudo crear.',
      });
    } finally {
      setBusy(false);
    }
  };

  const activar = async (row: EventRow) => {
    // Cambia lo que ve cualquiera que entre al sitio. Se confirma.
    const ok = window.confirm(
      `Activar "${row.nombre}".\n\n` +
        'Todo el sitio pasa a mostrar esta emergencia: la portada, el mapa y las ' +
        'fuentes de datos. Los reportes nuevos se le atribuirán a ella.\n\n' +
        '¿Continuar?',
    );
    if (!ok) return;

    setBusy(true);
    setMensaje(null);
    try {
      await api.post(`/admin/eventos/${row.slug}/activar`, {}, { headers: auth });
      setMensaje({ tone: 'ok', text: `"${row.nombre}" es ahora la emergencia en curso.` });
      await load();
    } catch (err) {
      setMensaje({
        tone: 'error',
        text: err instanceof ApiError ? err.message : 'No se pudo activar.',
      });
    } finally {
      setBusy(false);
    }
  };

  const cambiarEstado = async (row: EventRow, estado: Status) => {
    setBusy(true);
    setMensaje(null);
    try {
      await api.patch(`/admin/eventos/${row.slug}`, { status: estado }, { headers: auth });
      await load();
    } catch (err) {
      setMensaje({
        tone: 'error',
        text: err instanceof ApiError ? err.message : 'No se pudo cambiar el estado.',
      });
    } finally {
      setBusy(false);
    }
  };

  const borrar = async (row: EventRow) => {
    if (!window.confirm(`Borrar "${row.nombre}". Solo funciona si no tiene datos. ¿Seguir?`)) {
      return;
    }
    setBusy(true);
    setMensaje(null);
    try {
      await api.del(`/admin/eventos/${row.slug}`, { headers: auth });
      setMensaje({ tone: 'ok', text: 'Emergencia borrada.' });
      await load();
    } catch (err) {
      setMensaje({
        tone: 'error',
        text: err instanceof ApiError ? err.message : 'No se pudo borrar.',
      });
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
          <span className="text-[16px] font-semibold">Emergencias cubiertas</span>
          <span className="text-[13px] text-ink-faint">ver y declarar →</span>
        </span>
      </button>
    );
  }

  return (
    <section className="mt-6 border-2 border-rule p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-semibold">Emergencias cubiertas</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[15px] underline underline-offset-4"
        >
          Cerrar
        </button>
      </div>

      <p className="mt-1 text-[14px] leading-snug text-ink-soft">
        La que esté activa es la que muestra todo el sitio. Crear no activa: puedes preparar una
        con calma y revisarla antes.
      </p>

      {mensaje && <Notice tone={mensaje.tone}>{mensaje.text}</Notice>}

      {rows && (
        <ul className="mt-4">
          {rows.map((row) => (
            <li key={row.slug} className="rule py-3 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-[16px] font-semibold">
                  {row.nombre}
                  {row.principal && (
                    <span
                      className="stamp ml-2"
                      style={{ color: 'var(--color-roja)' }}
                    >
                      en curso
                    </span>
                  )}
                </span>
                <span className="stamp text-ink-faint">{KIND_LABEL[row.tipo]}</span>
              </div>

              <p className="num mt-1 flex flex-wrap gap-x-3 text-[13px] text-ink-faint">
                <span>{new Date(row.ocurrioEl).toLocaleDateString('es-CO')}</span>
                <span>{STATUS_LABEL[row.estado]}</span>
                {row.epicentro && (
                  <span>
                    {row.epicentro.latitud.toFixed(2)}, {row.epicentro.longitud.toFixed(2)}
                  </span>
                )}
                {row.radioKm && <span>radio {row.radioKm} km</span>}
                {!row.tieneCifrasOficiales && <span>sin balance oficial</span>}
              </p>

              {row.departamentos.length > 0 && (
                <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">
                  {row.departamentos.join(' · ')}
                </p>
              )}

              <div className="mt-2 flex flex-wrap gap-3 text-[14px]">
                {!row.principal && row.estado !== 'CLOSED' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void activar(row)}
                    className="underline underline-offset-4 disabled:opacity-40"
                  >
                    Activar
                  </button>
                )}
                {!row.principal && row.estado !== 'CLOSED' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void cambiarEstado(row, 'CLOSED')}
                    className="underline underline-offset-4 disabled:opacity-40"
                  >
                    Cerrar
                  </button>
                )}
                {row.estado === 'CLOSED' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void cambiarEstado(row, 'ACTIVE')}
                    className="underline underline-offset-4 disabled:opacity-40"
                  >
                    Reabrir
                  </button>
                )}
                {!row.principal && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void borrar(row)}
                    className="underline underline-offset-4 disabled:opacity-40"
                    style={{ color: 'var(--color-roja)' }}
                  >
                    Borrar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {showForm ? (
        <form
          className="mt-5 border-2 border-rule p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void crear(e.currentTarget);
          }}
        >
          <p className="eyebrow">Declarar una emergencia</p>

          <Field label="Nombre" required hint="Como debe aparecer en la portada.">
            {({ id }) => (
              <TextInput id={id} name="name" required placeholder="Inundación del bajo Magdalena" />
            )}
          </Field>

          <Field
            label="Identificador"
            required
            hint="Aparece en las URL y no se puede cambiar después. Se limpian tildes y espacios."
          >
            {({ id }) => (
              <TextInput
                id={id}
                name="slug"
                required
                placeholder="inundacion-bajo-magdalena-2027"
              />
            )}
          </Field>

          <Field label="Tipo" required>
            {({ id }) => (
              <Select
                id={id}
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
              >
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Cuándo ocurrió" required>
            {({ id }) => <TextInput id={id} name="occurredAt" type="datetime-local" required />}
          </Field>

          {/* El epicentro solo se pide para lo que lo tiene. Una inundación no
              tiene un punto de origen, y pedirlo invitaría a inventarlo. */}
          {CON_EPICENTRO.includes(kind) && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Latitud del epicentro">
                  {({ id }) => (
                    <TextInput id={id} name="lat" inputMode="decimal" placeholder="4.99" />
                  )}
                </Field>
                <Field label="Longitud">
                  {({ id }) => (
                    <TextInput id={id} name="lon" inputMode="decimal" placeholder="-76.29" />
                  )}
                </Field>
              </div>

              <Field
                label="Radio de réplicas (km)"
                hint="Acota la búsqueda de sismos en el USGS. Si se deja vacío, 300."
              >
                {({ id }) => (
                  <TextInput id={id} name="radio" inputMode="numeric" placeholder="300" />
                )}
              </Field>
            </>
          )}

          <Field label="Departamentos" hint="Separados por comas.">
            {({ id }) => (
              <TextInput id={id} name="departments" placeholder="Atlántico, Magdalena, Bolívar" />
            )}
          </Field>

          <div className="mt-3 flex items-center gap-3">
            <SubmitButton busy={busy} busyLabel="Creando…">
              Crear
            </SubmitButton>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-[15px] underline underline-offset-4"
            >
              Cancelar
            </button>
          </div>

          <p className="mt-3 text-[13px] leading-snug text-ink-faint">
            Las cifras oficiales y los datasets de daño de cada emergencia se declaran en el
            código, no aquí: vienen de terceros y cada cambio tiene que quedar auditable con su
            fuente.
          </p>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mt-5 min-h-[44px] w-full border-2 border-ink px-3 text-[15px] font-semibold"
        >
          Declarar una emergencia
        </button>
      )}
    </section>
  );
}
