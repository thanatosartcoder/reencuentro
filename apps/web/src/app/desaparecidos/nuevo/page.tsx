'use client';

import { useState } from 'react';
import Link from 'next/link';
import { submit } from '@/lib/api';
import { getDeviceId, storeClaim } from '@/lib/device';
import { enqueuePhoto } from '@/lib/outbox';
import {
  ChoiceGroup,
  Field,
  Notice,
  Select,
  SubmitButton,
  TextArea,
  TextInput,
} from '@/components/Form';
import { PhotoPicker } from '@/components/PhotoPicker';
import { LocationPicker, type Coords } from '@/components/LocationPicker';

const DEPARTMENTS = [
  'Chocó',
  'Valle del Cauca',
  'Risaralda',
  'Caldas',
  'Quindío',
  'Cauca',
  'Antioquia',
  'Tolima',
  'Nariño',
  'Otro',
];

export default function NuevoReportePage() {
  // Lo esencial
  const [fullName, setFullName] = useState('');
  const [reporterName, setReporterName] = useState('');
  const [reporterPhone, setReporterPhone] = useState('');
  const [relationship, setRelationship] = useState('');

  // Si se sabe
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN' | ''>('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [department, setDepartment] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [lastSeenAt, setLastSeenAt] = useState('');
  const [lastSeenAddress, setLastSeenAddress] = useState('');
  const [coords, setCoords] = useState<Coords | null>(null);
  const [heightCm, setHeightCm] = useState('');
  const [build, setBuild] = useState('');
  const [hairColor, setHairColor] = useState('');
  const [clothing, setClothing] = useState('');
  const [marks, setMarks] = useState('');
  const [circumstances, setCircumstances] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ claimToken: string | null; queued: boolean } | null>(
    null,
  );

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const clientUuid = crypto.randomUUID();
    const parsedAge = age ? Number(age) : undefined;

    const payload: Record<string, unknown> = {
      clientUuid,
      fullName: fullName.trim(),
      reporterName: reporterName.trim(),
      reporterPhone: reporterPhone.trim() || undefined,
      reporterRelationship: relationship.trim() || undefined,
      age: Number.isFinite(parsedAge) ? parsedAge : undefined,
      sex: sex || undefined,
      documentNumber: documentNumber.trim() || undefined,
      documentType: documentNumber.trim() ? 'CC' : undefined,
      department: department && department !== 'Otro' ? department : undefined,
      municipality: municipality.trim() || undefined,
      lastSeenAt: lastSeenAt ? new Date(lastSeenAt).toISOString() : undefined,
      lastSeenAddress: lastSeenAddress.trim() || undefined,
      lastSeenLocation: coords ?? undefined,
      heightCm: heightCm ? Number(heightCm) : undefined,
      build: build.trim() || undefined,
      hairColor: hairColor.trim() || undefined,
      clothingDescription: clothing.trim() || undefined,
      distinguishingMarks: marks.trim() || undefined,
      circumstances: circumstances.trim() || undefined,
      deviceId: getDeviceId(),
    };

    try {
      const { result: created, queued } = await submit<{
        claimToken: string | null;
        report: { id: string };
      }>({
        path: '/personas/desaparecidos',
        type: 'MISSING_REPORT',
        clientUuid,
        payload,
        label: `Desaparición de ${fullName.trim()}`,
      });

      // El id del reporte en el servidor es el mismo clientUuid, así que la foto
      // se puede encolar aunque el reporte todavía no haya salido de este
      // teléfono.
      if (photo) {
        await enqueuePhoto({
          clientUuid: crypto.randomUUID(),
          ownerType: 'MISSING_REPORT',
          ownerId: clientUuid,
          blob: photo,
        });
      }

      if (created?.claimToken) {
        storeClaim({
          claimToken: created.claimToken,
          fullName: fullName.trim(),
          reportId: created.report.id,
          createdAt: new Date().toISOString(),
        });
      }

      setResult({ claimToken: created?.claimToken ?? null, queued });
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el reporte.');
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return <Confirmation claimToken={result.claimToken} queued={result.queued} name={fullName} />;
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <p className="eyebrow" style={{ color: 'var(--color-roja)' }}>
        Reporte de desaparición
      </p>
      <h1 className="mt-2 text-[clamp(1.6rem,5.5vw,2.3rem)] font-bold leading-tight tracking-tight">
        No encuentro a alguien
      </h1>
      <p className="mt-3 text-[17px] leading-snug text-ink-soft">
        Con el nombre y un teléfono de contacto es suficiente para empezar. Todo lo demás lo
        puedes agregar después, cuando lo sepas o cuando tengas mejor señal.
      </p>

      <form onSubmit={send} noValidate>
        <section className="mt-8">
          <h2 className="eyebrow">Lo indispensable</h2>

          <Field label="Nombre completo de la persona" required>
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                maxLength={200}
                autoComplete="off"
              />
            )}
          </Field>

          <Field label="Tu nombre" required>
            {({ id }) => (
              <TextInput
                id={id}
                value={reporterName}
                onChange={(e) => setReporterName(e.target.value)}
                required
                maxLength={200}
              />
            )}
          </Field>

          <Field
            label="Tu teléfono"
            hint="Es la forma en que te avisamos si aparece. Se guarda cifrado y no se publica."
          >
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                type="tel"
                inputMode="tel"
                value={reporterPhone}
                onChange={(e) => setReporterPhone(e.target.value)}
                maxLength={30}
                autoComplete="tel"
              />
            )}
          </Field>

          <Field label="Qué es tuyo" hint="Hijo, hermana, vecino, compañero de trabajo…">
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                maxLength={120}
              />
            )}
          </Field>
        </section>

        {/* El resto va detrás de un botón: quien reporta en shock no debería
            enfrentarse a veinte campos de una sola vez, y un reporte con tres
            datos vale infinitamente más que uno que nunca se envió. */}
        {!showDetails ? (
          <div className="mt-8">
            <button
              type="button"
              onClick={() => setShowDetails(true)}
              className="w-full border-2 border-ink px-4 py-3.5 text-[16px] font-semibold"
            >
              Agregar foto y más datos
            </button>
            <p className="mt-2 text-[14px] leading-snug text-ink-faint">
              Una foto y la última ubicación conocida son lo que más ayuda a encontrar a alguien.
              Si no los tienes a mano, envía el reporte ya y agrégalos después.
            </p>
          </div>
        ) : (
          <>
            <section className="mt-10">
              <h2 className="eyebrow">Cómo reconocerla</h2>

              <PhotoPicker onChange={setPhoto} />

              <div className="grid gap-x-4 sm:grid-cols-2">
                <Field label="Edad">
                  {({ id }) => (
                    <TextInput
                      id={id}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={120}
                      value={age}
                      onChange={(e) => setAge(e.target.value)}
                    />
                  )}
                </Field>

                <Field label="Estatura en cm">
                  {({ id }) => (
                    <TextInput
                      id={id}
                      type="number"
                      inputMode="numeric"
                      min={30}
                      max={250}
                      value={heightCm}
                      onChange={(e) => setHeightCm(e.target.value)}
                    />
                  )}
                </Field>
              </div>

              <ChoiceGroup
                legend="Sexo"
                value={sex}
                onChange={setSex}
                columns={2}
                options={[
                  { value: 'FEMALE', label: 'Femenino' },
                  { value: 'MALE', label: 'Masculino' },
                  { value: 'OTHER', label: 'Otro' },
                  { value: 'UNKNOWN', label: 'No sé' },
                ]}
              />

              <div className="grid gap-x-4 sm:grid-cols-2">
                <Field label="Contextura" hint="Delgada, media, robusta…">
                  {({ id, describedBy }) => (
                    <TextInput
                      id={id}
                      aria-describedby={describedBy}
                      value={build}
                      onChange={(e) => setBuild(e.target.value)}
                      maxLength={120}
                    />
                  )}
                </Field>

                <Field label="Color de cabello">
                  {({ id }) => (
                    <TextInput
                      id={id}
                      value={hairColor}
                      onChange={(e) => setHairColor(e.target.value)}
                      maxLength={120}
                    />
                  )}
                </Field>
              </div>

              <Field
                label="Señas particulares"
                hint="Cicatrices, tatuajes, lunares, prótesis. Es lo que más sirve cuando la foto no ayuda o la persona está irreconocible."
              >
                {({ id, describedBy }) => (
                  <TextArea
                    id={id}
                    aria-describedby={describedBy}
                    rows={2}
                    maxLength={2000}
                    value={marks}
                    onChange={(e) => setMarks(e.target.value)}
                  />
                )}
              </Field>

              <Field label="Cómo estaba vestida la última vez">
                {({ id }) => (
                  <TextArea
                    id={id}
                    rows={2}
                    maxLength={2000}
                    value={clothing}
                    onChange={(e) => setClothing(e.target.value)}
                  />
                )}
              </Field>

              <Field
                label="Número de documento"
                hint="Si lo tienes, es el dato que permite una identificación exacta. Se guarda cifrado."
              >
                {({ id, describedBy }) => (
                  <TextInput
                    id={id}
                    aria-describedby={describedBy}
                    inputMode="numeric"
                    value={documentNumber}
                    onChange={(e) => setDocumentNumber(e.target.value)}
                    maxLength={50}
                  />
                )}
              </Field>
            </section>

            <section className="mt-10">
              <h2 className="eyebrow">Dónde y cuándo la vieron por última vez</h2>

              <div className="grid gap-x-4 sm:grid-cols-2">
                <Field label="Departamento">
                  {({ id }) => (
                    <Select
                      id={id}
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                    >
                      <option value="">Selecciona</option>
                      {DEPARTMENTS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Field label="Municipio">
                  {({ id }) => (
                    <TextInput
                      id={id}
                      value={municipality}
                      onChange={(e) => setMunicipality(e.target.value)}
                      maxLength={120}
                    />
                  )}
                </Field>
              </div>

              <Field label="Barrio, dirección o punto de referencia">
                {({ id }) => (
                  <TextInput
                    id={id}
                    value={lastSeenAddress}
                    onChange={(e) => setLastSeenAddress(e.target.value)}
                    maxLength={500}
                  />
                )}
              </Field>

              <Field label="Fecha y hora aproximadas">
                {({ id }) => (
                  <TextInput
                    id={id}
                    type="datetime-local"
                    value={lastSeenAt}
                    onChange={(e) => setLastSeenAt(e.target.value)}
                  />
                )}
              </Field>

              <LocationPicker
                value={coords}
                onChange={setCoords}
                label="Ubicación en el mapa"
                hint="Si estás en el sitio donde la viste por última vez, tomar la ubicación aquí ayuda al sistema a cruzar tu reporte con quienes están buscando cerca."
              />

              <Field label="Qué pasó">
                {({ id }) => (
                  <TextArea
                    id={id}
                    rows={3}
                    maxLength={2000}
                    value={circumstances}
                    onChange={(e) => setCircumstances(e.target.value)}
                  />
                )}
              </Field>
            </section>
          </>
        )}

        {error && <Notice tone="error">{error}</Notice>}

        <SubmitButton busy={busy} busyLabel="Registrando…" disabled={!fullName || !reporterName}>
          Registrar el reporte
        </SubmitButton>

        <p className="mt-4 text-[14px] leading-snug text-ink-faint">
          Al enviar autorizas publicar el nombre y la foto en el listado de búsqueda, para que
          alguien pueda reconocerla. Tu teléfono y el documento nunca se publican. Puedes pedir
          que se retire el caso en cualquier momento.
        </p>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Confirmation({
  claimToken,
  queued,
  name,
}: {
  claimToken: string | null;
  queued: boolean;
  name: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <span
        aria-hidden
        className="block h-1.5 w-16"
        style={{ background: queued ? 'var(--color-naranja)' : 'var(--color-via)' }}
      />
      <h1 className="mt-4 text-[clamp(1.6rem,5.5vw,2.3rem)] font-bold leading-tight tracking-tight">
        {queued ? 'Guardado en este teléfono' : `El reporte de ${name} quedó registrado`}
      </h1>

      <p className="mt-3 text-[17px] leading-snug">
        {queued
          ? 'No hay señal en este momento. El reporte está guardado y se envía solo en cuanto vuelva la conexión. No necesitas hacer nada más.'
          : 'A partir de ahora el sistema compara este reporte con cada avistamiento que llega desde hospitales, albergues y equipos de rescate.'}
      </p>

      {/* El claim token es la única credencial del reportante y solo existe en
          esta pantalla. Si se pierde, el caso sigue vivo pero esta persona deja
          de poder seguirlo, así que la pantalla insiste. */}
      {claimToken && (
        <div className="mt-8 border-2 border-ink">
          <div className="border-b border-ink px-4 py-3">
            <h2 className="text-[18px] font-bold">Guarda este código de seguimiento</h2>
            <p className="mt-1 text-[15px] leading-snug text-ink-soft">
              Es tu llave para ver el caso y recibir el aviso si aparece. Ya quedó guardada en
              este navegador, pero anótala o compártela con alguien de tu familia: si pierdes el
              teléfono, es la única forma de volver al caso.
            </p>
          </div>

          <div className="px-4 py-4">
            <p className="num break-all bg-paper-sunk px-3 py-3 text-[15px] font-semibold">
              {claimToken}
            </p>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(claimToken).then(() => setCopied(true));
              }}
              className="mt-3 min-h-[52px] w-full border-2 border-ink px-4 text-[16px] font-semibold"
            >
              {copied ? 'Copiado' : 'Copiar el código'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/mis-reportes"
          className="flex min-h-[56px] items-center bg-ink px-5 text-[17px] font-semibold text-paper"
        >
          Ver el estado del caso
        </Link>
        <Link
          href="/desaparecidos"
          className="flex min-h-[56px] items-center border-2 border-ink px-5 text-[17px] font-semibold"
        >
          Ver otros reportes
        </Link>
      </div>

      <div className="rule mt-10 pt-6">
        <h2 className="text-[18px] font-bold">Qué pasa ahora</h2>
        <ol className="mt-3 space-y-3 text-[16px] leading-snug text-ink-soft">
          <li>
            El sistema busca coincidencias por nombre, edad, descripción física y cercanía al
            último punto conocido.
          </li>
          <li>
            Cuando encuentra una posible coincidencia,{' '}
            <strong className="text-ink">una persona la revisa antes de avisarte</strong>. Nunca
            recibirás un aviso automático: equivocarse en esto tiene un costo demasiado alto.
          </li>
          <li>
            Si la coincidencia se confirma, te llega la notificación con el lugar donde está y
            con quién comunicarte.
          </li>
        </ol>
      </div>
    </div>
  );
}
