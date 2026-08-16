'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type PhotoRef } from '@/lib/api';
import { Field, Notice, SubmitButton, TextInput } from '@/components/Form';
import { timeAgo } from '@/components/DecayMeter';
import { Photo, PhotoPlaceholder } from '@/components/Photo';
import { ChangePassword } from '@/components/ChangePassword';
import { DataSources } from '@/components/DataSources';
import { Operators } from '@/components/Operators';
import { Backups } from '@/components/Backups';
import { Events } from '@/components/Events';

const TOKEN_KEY = 'reencuentro.operatorToken';
const MUST_CHANGE_KEY = 'reencuentro.mustChangePassword';

interface Candidate {
  id: string;
  score: number;
  tier: string;
  highPriority: boolean;
  createdAt: string;
  breakdown: {
    name: number | null;
    age: number | null;
    sex: number | null;
    geo: number | null;
    time: number | null;
    physical: number | null;
    face: number | null;
    document: number | null;
    weights: Record<string, number>;
    distanceMeters: number | null;
    hoursApart: number | null;
    reasons: string[];
  };
  missing: PersonSide & {
    circumstances: string | null;
    medicalNotes: string | null;
    reporterName: string;
    reporterRelationship: string | null;
    lastSeenAt: string | null;
    lastSeenAddress: string | null;
  };
  sighting: PersonSide & {
    kind: string;
    condition: string;
    seenAt: string;
    facilityName: string | null;
    notes: string | null;
    reporterName: string | null;
    reporterRole: string;
    reporterOrganization: string | null;
  };
}

interface PersonSide {
  id: string;
  fullName: string | null;
  age?: number | null;
  ageMin?: number | null;
  ageMax?: number | null;
  estimatedAgeMin?: number | null;
  estimatedAgeMax?: number | null;
  sex: string;
  heightCm: number | null;
  build: string | null;
  skinTone: string | null;
  hairColor: string | null;
  clothingDescription: string | null;
  distinguishingMarks: string | null;
  documentNumber: string | null;
  isMinor: boolean;
  department: string | null;
  municipality: string | null;
  photos: PhotoRef[];
}

export default function PanelPage() {
  const [token, setToken] = useState<string | null>(null);
  const [mustChange, setMustChange] = useState(false);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY));
    setMustChange(localStorage.getItem(MUST_CHANGE_KEY) === 'true');
  }, []);

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(MUST_CHANGE_KEY);
    setToken(null);
    setMustChange(false);
    setChanging(false);
  };

  const onPasswordChanged = (newToken: string) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.removeItem(MUST_CHANGE_KEY);
    setToken(newToken);
    setMustChange(false);
    setChanging(false);
  };

  if (token === null) {
    return (
      <Login
        onLogin={(newToken, needsChange) => {
          setToken(newToken);
          setMustChange(needsChange);
          if (needsChange) localStorage.setItem(MUST_CHANGE_KEY, 'true');
        }}
      />
    );
  }

  // El cambio obligatorio no es una sugerencia: el servidor rechaza cualquier
  // otra petición hasta que se haga, así que la pantalla tampoco ofrece salida.
  if (mustChange || changing) {
    return (
      <ChangePassword
        token={token}
        forced={mustChange}
        onDone={onPasswordChanged}
        onCancel={mustChange ? undefined : () => setChanging(false)}
      />
    );
  }

  return <Queue token={token} onLogout={logout} onChangePassword={() => setChanging(true)} />;
}

// ---------------------------------------------------------------------------

function Login({
  onLogin,
}: {
  onLogin: (token: string, mustChangePassword: boolean) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await api.post<{ accessToken: string; mustChangePassword: boolean }>(
        '/auth/login',
        { email, password },
      );
      localStorage.setItem(TOKEN_KEY, response.accessToken);
      onLogin(response.accessToken, Boolean(response.mustChangePassword));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <p className="eyebrow">Acceso restringido</p>
      <h1 className="mt-2 text-[28px] font-bold leading-tight tracking-tight">
        Panel de validación
      </h1>
      <p className="mt-3 text-[16px] leading-snug text-ink-soft">
        Para personal acreditado. Aquí se decide si dos reportes corresponden a la misma persona
        antes de avisarle a una familia.
      </p>

      <form onSubmit={submitLogin}>
        <Field label="Correo" required>
          {({ id }) => (
            <TextInput
              id={id}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          )}
        </Field>
        <Field label="Contraseña" required>
          {({ id }) => (
            <TextInput
              id={id}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}
        </Field>

        {error && <Notice tone="error">{error}</Notice>}

        <SubmitButton busy={busy} busyLabel="Entrando…">
          Entrar
        </SubmitButton>
      </form>

      {/*
        Una cuenta recién invitada todavía no tiene contraseña, y el login
        responde "credenciales inválidas" a propósito: decir "esa cuenta existe
        pero está pendiente" convertiría esta pantalla en una forma de averiguar
        qué correos son de personal acreditado. Este aviso da la salida sin
        confirmar nada sobre ninguna cuenta.
      */}
      <p className="mt-6 text-[14px] leading-snug text-ink-faint">
        ¿Te invitaron y aún no has entrado nunca? Usa el enlace de invitación que te
        enviaron: ahí eliges tu contraseña.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Queue({
  token,
  onLogout,
  onChangePassword,
}: {
  token: string;
  onLogout: () => void;
  onChangePassword: () => void;
}) {
  const [items, setItems] = useState<Candidate[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const auth = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<{ items: Candidate[]; total: number }>('/matches/cola', {
        headers: auth,
      });
      setItems(response.items);
      setTotal(response.total);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onLogout();
      else setError('No se pudo cargar la cola.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="eyebrow">Revisión humana</p>
          <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight">
            Coincidencias por verificar
          </h1>
        </div>
        <div className="flex gap-4">
          <button
            type="button"
            onClick={onChangePassword}
            className="text-[15px] underline underline-offset-4"
          >
            Cambiar contraseña
          </button>
          <button type="button" onClick={onLogout} className="text-[15px] underline underline-offset-4">
            Salir
          </button>
        </div>
      </div>

      <p className="mt-3 max-w-2xl text-[16px] leading-snug text-ink-soft">
        Ninguna familia recibe un aviso hasta que alguien confirme aquí. Si tienes dudas,
        recházala: un rechazo no le llega a nadie, una confirmación equivocada sí.
      </p>

      <Events token={token} />

      <Operators token={token} />

      <DataSources token={token} />

      <Backups token={token} />

      <PfifExport token={token} />

      <p className="eyebrow mt-8">
        {loading ? 'Cargando…' : `${total} pendiente${total === 1 ? '' : 's'}`}
      </p>

      {error && <Notice tone="error">{error}</Notice>}

      {!loading && items.length === 0 && (
        <div className="mt-4 border-2 border-rule px-4 py-6">
          <p className="text-[17px] font-semibold">No hay nada por revisar</p>
          <p className="mt-2 text-[16px] text-ink-soft">
            Cuando el motor proponga una coincidencia, aparecerá aquí ordenada por prioridad.
          </p>
        </div>
      )}

      <ul className="mt-4 space-y-8">
        {items.map((candidate) => (
          <CandidateCard key={candidate.id} candidate={candidate} auth={auth} onDone={load} />
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Entrega hacia los registros oficiales.
 *
 * No hay una API colombiana en vivo contra la cual sincronizar: el catálogo de
 * emergencias de la UNGRD en datos.gov.co llega hasta 2022 y el de
 * desaparecidos se publica por lotes mensuales. Así que la entrega es un
 * archivo — pero en un estándar internacional, no en un CSV improvisado, para
 * que la entidad receptora pueda cargarlo sin acordar un formato nuevo.
 */
function PfifExport({ token }: { token: string }) {
  const [summary, setSummary] = useState<{
    registros: { desaparecidos: number; avistamientos: number; total: number };
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ registros: { desaparecidos: number; avistamientos: number; total: number } }>(
        '/export/pfif/resumen',
        { headers: { Authorization: `Bearer ${token}` } },
      )
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [token]);

  const download = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/export/pfif', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('No se pudo generar la exportación');

      // La descarga se hace desde un blob y no con un enlace directo porque el
      // endpoint exige la cabecera de autorización.
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `reencuentro-pfif-${new Date().toISOString().slice(0, 10)}.xml`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  if (!summary) return null;

  return (
    <section className="mt-8 border-2 border-rule p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-semibold">Entregar a un registro oficial</h2>
        <span className="stamp text-ink-faint">PFIF 1.4</span>
      </div>

      <p className="mt-2 text-[15px] leading-snug text-ink-soft">
        Exporta {summary.registros.desaparecidos} reportes de desaparición y{' '}
        {summary.registros.avistamientos} avistamientos en People Finder Interchange Format, el
        estándar que usan los registros de desaparecidos entre sí desde Katrina 2005.
      </p>

      <button
        type="button"
        onClick={download}
        disabled={busy}
        className="mt-3 min-h-[52px] w-full border-2 border-ink px-4 text-[16px] font-semibold disabled:opacity-50"
      >
        {busy ? 'Generando…' : `Descargar ${summary.registros.total} registros`}
      </button>

      <p className="mt-2 text-[13px] leading-snug text-ink-faint">
        Incluye solo los casos cuyo autor autorizó la publicación, y omite teléfonos, correos y
        documentos. La exportación con datos de contacto requiere rol de administrador y un
        acuerdo de tratamiento de datos con la entidad receptora. Cada descarga queda en
        bitácora.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------

function CandidateCard({
  candidate,
  auth,
  onDone,
}: {
  candidate: Candidate;
  auth: Record<string, string>;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const decide = async (action: 'confirmar' | 'rechazar') => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/matches/${candidate.id}/${action}`, { notes: notes || undefined }, {
        headers: auth,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo registrar la decisión.');
      setBusy(false);
    }
  };

  const { missing, sighting, breakdown } = candidate;

  return (
    <li className="border-2 border-ink">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="num text-[30px] font-bold leading-none tracking-tight">
            {(candidate.score * 100).toFixed(0)}
            <span className="text-[16px] font-normal text-ink-faint">/100</span>
          </span>
          <span className="stamp">{tierLabel(candidate.tier)}</span>
          {candidate.highPriority && (
            <span className="stamp" style={{ color: 'var(--color-roja)' }}>
              prioridad alta
            </span>
          )}
          {missing.isMinor && (
            <span className="stamp" style={{ color: 'var(--color-roja)' }}>
              menor de edad
            </span>
          )}
        </div>
        <span className="num text-[13px] text-ink-faint">
          propuesta {timeAgo(candidate.createdAt)}
        </span>
      </header>

      {/* Las dos fichas lado a lado: el trabajo del validador es comparar, así
          que la pantalla se organiza para comparar, no para leer en secuencia. */}
      <div className="grid sm:grid-cols-2">
        <Side
          title="Reportada como desaparecida"
          accent="var(--color-roja)"
          person={missing}
          extra={[
            ['Vista por última vez', formatDate(missing.lastSeenAt)],
            ['Dirección', missing.lastSeenAddress],
            ['Circunstancias', missing.circumstances],
            ['Notas médicas', missing.medicalNotes],
            [
              'Reportó',
              [missing.reporterName, missing.reporterRelationship].filter(Boolean).join(' · '),
            ],
          ]}
          age={formatAge(missing.age, missing.ageMin, missing.ageMax)}
        />
        <Side
          title="Reportada como vista"
          accent="var(--color-via)"
          person={sighting}
          className="border-t-2 border-ink sm:border-l-2 sm:border-t-0"
          extra={[
            ['Vista', formatDate(sighting.seenAt)],
            ['Lugar', sighting.facilityName],
            ['Estado', conditionLabel(sighting.condition)],
            ['Notas', sighting.notes],
            [
              'Reportó',
              [sighting.reporterName, sighting.reporterOrganization].filter(Boolean).join(' · '),
            ],
          ]}
          age={formatAge(null, sighting.estimatedAgeMin, sighting.estimatedAgeMax)}
        />
      </div>

      {/* Por qué el motor lo propuso. El validador tiene que poder ver en qué
          se apoya el número y en qué no, o estaría obedeciendo a una caja negra. */}
      <div className="border-t-2 border-ink px-4 py-4">
        <p className="eyebrow">En qué se basa la propuesta</p>

        <ul className="mt-2 space-y-1">
          {breakdown.reasons.map((reason) => (
            <li key={reason} className="text-[16px] leading-snug">
              {reason}
            </li>
          ))}
        </ul>

        <table className="num mt-4 w-full text-[13px]">
          <thead>
            <tr className="text-left text-ink-faint">
              <th className="font-normal">señal</th>
              <th className="font-normal">coincidencia</th>
              <th className="font-normal">peso</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ['nombre', breakdown.name, 'name'],
                ['edad', breakdown.age, 'age'],
                ['sexo', breakdown.sex, 'sex'],
                ['geografía', breakdown.geo, 'geo'],
                ['tiempo', breakdown.time, 'time'],
                ['descripción física', breakdown.physical, 'physical'],
                ['rostro', breakdown.face, 'face'],
                ['documento', breakdown.document, 'document'],
              ] as [string, number | null, string][]
            )
              .filter(([, value]) => value !== null)
              .map(([label, value, key]) => (
                <tr key={key} className="border-t border-rule">
                  <td className="py-1">{label}</td>
                  <td className="py-1">{((value as number) * 100).toFixed(0)}%</td>
                  <td className="py-1 text-ink-faint">
                    {breakdown.weights[key] !== undefined
                      ? `${(breakdown.weights[key] * 100).toFixed(0)}%`
                      : '—'}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>

        {breakdown.distanceMeters !== null && (
          <p className="num mt-2 text-[13px] text-ink-faint">
            {(breakdown.distanceMeters / 1000).toFixed(1)} km de separación ·{' '}
            {breakdown.hoursApart?.toFixed(0)} h de diferencia
          </p>
        )}
      </div>

      <div className="border-t-2 border-ink px-4 py-4">
        <label className="block text-[16px] font-semibold" htmlFor={`notas-${candidate.id}`}>
          Cómo lo verificaste
        </label>
        <p className="mb-1.5 mt-0.5 text-[14px] text-ink-faint">
          Queda en la bitácora del caso y se le muestra a la familia si confirmas.
        </p>
        <textarea
          id={`notas-${candidate.id}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={1000}
          className="w-full border-2 border-rule bg-paper px-3 py-2.5 text-[16px] focus:border-ink focus:outline-none"
        />

        {error && <Notice tone="error">{error}</Notice>}

        {confirming ? (
          <div
            className="mt-4 border-l-4 bg-paper-sunk px-4 py-3"
            style={{ borderColor: 'var(--color-roja)' }}
          >
            <p className="text-[17px] font-semibold">
              Se le va a avisar a la familia de {missing.fullName}
            </p>
            <p className="mt-1 text-[16px] leading-snug text-ink-soft">
              Esta acción no se puede deshacer. Confirma solo si verificaste la identidad, no
              solo si el puntaje es alto.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => decide('confirmar')}
                className="min-h-[52px] flex-1 px-4 text-[16px] font-semibold text-paper disabled:opacity-50"
                style={{ background: 'var(--color-roja)' }}
              >
                {busy ? 'Confirmando…' : 'Sí, es la misma persona'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(false)}
                className="min-h-[52px] border-2 border-ink px-4 text-[16px] font-semibold"
              >
                Volver
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(true)}
              className="min-h-[56px] px-4 text-[17px] font-semibold text-paper disabled:opacity-50"
              style={{ background: 'var(--color-via)' }}
            >
              Es la misma persona
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => decide('rechazar')}
              className="min-h-[56px] border-2 border-ink px-4 text-[17px] font-semibold disabled:opacity-50"
            >
              No es
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function Side({
  title,
  accent,
  person,
  extra,
  age,
  className = '',
}: {
  title: string;
  accent: string;
  person: PersonSide;
  extra: [string, string | null | undefined][];
  age: string | null;
  className?: string;
}) {
  return (
    <div className={`px-4 py-4 ${className}`}>
      <span aria-hidden className="block h-1 w-10" style={{ background: accent }} />
      <p className="eyebrow mt-2">{title}</p>

      <div className="mt-3 flex gap-3">
        {person.photos[0] ? (
          <Photo
            photo={person.photos[0]}
            alt=""
            className="h-24 w-24 shrink-0 border border-rule object-cover"
            eager
          />
        ) : (
          <PhotoPlaceholder className="h-24 w-24 shrink-0" />
        )}
        <div className="min-w-0">
          <p className="text-[19px] font-bold leading-tight">
            {person.fullName ?? 'Sin nombre conocido'}
          </p>
          <p className="mt-1 text-[15px] leading-snug text-ink-soft">
            {[age, sexLabel(person.sex), person.heightCm ? `${person.heightCm} cm` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="mt-0.5 text-[15px] text-ink-soft">
            {[person.municipality, person.department].filter(Boolean).join(', ')}
          </p>
          {person.documentNumber && (
            <p className="num mt-1 text-[13px]">doc. {person.documentNumber}</p>
          )}
        </div>
      </div>

      <dl className="mt-3">
        <Row label="Contextura" value={person.build} />
        <Row label="Cabello" value={person.hairColor} />
        <Row label="Piel" value={person.skinTone} />
        <Row label="Señas" value={person.distinguishingMarks} />
        <Row label="Ropa" value={person.clothingDescription} />
        {extra.map(([label, value]) => (
          <Row key={label} label={label} value={value ?? null} />
        ))}
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="mt-2">
      <dt className="eyebrow">{label}</dt>
      <dd className="text-[16px] leading-snug">{value}</dd>
    </div>
  );
}

function tierLabel(tier: string): string {
  return (
    { DETERMINISTIC: 'documento', BIOMETRIC: 'rostro', HEURISTIC: 'descripción' }[tier] ?? tier
  );
}

function sexLabel(sex: string): string | null {
  return { MALE: 'masculino', FEMALE: 'femenino', OTHER: 'otro', UNKNOWN: null }[sex] ?? null;
}

function conditionLabel(condition: string): string | null {
  return (
    {
      STABLE: 'Estable',
      INJURED: 'Herida',
      CRITICAL: 'Estado crítico',
      DECEASED: 'Fallecida',
      UNKNOWN: 'Sin determinar',
    }[condition] ?? null
  );
}

function formatAge(
  age?: number | null,
  min?: number | null,
  max?: number | null,
): string | null {
  if (age !== null && age !== undefined) return `${age} años`;
  if (min !== null && min !== undefined && max !== null && max !== undefined)
    return `${min}–${max} años`;
  return null;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}
