'use client';

import { useState } from 'react';
import Link from 'next/link';
import { submit } from '@/lib/api';
import { getDeviceId } from '@/lib/device';
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

const KINDS = [
  { value: 'SIGHTING', label: 'La vi en la calle' },
  { value: 'SHELTER_INTAKE', label: 'Está en un albergue' },
  { value: 'HOSPITAL_ADMISSION', label: 'Está en un centro médico' },
  { value: 'RESCUE', label: 'La rescatamos' },
  { value: 'SELF_REPORT', label: 'Soy yo, estoy bien' },
] as const;

export default function NuevoAvistamientoPage() {
  const [kind, setKind] = useState<(typeof KINDS)[number]['value'] | ''>('');
  const [fullName, setFullName] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');
  const [sex, setSex] = useState<'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN' | ''>('');
  const [heightCm, setHeightCm] = useState('');
  const [build, setBuild] = useState('');
  const [hairColor, setHairColor] = useState('');
  const [marks, setMarks] = useState('');
  const [clothing, setClothing] = useState('');
  const [condition, setCondition] = useState<'STABLE' | 'INJURED' | 'CRITICAL' | 'UNKNOWN' | ''>(
    '',
  );
  const [facilityName, setFacilityName] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [department, setDepartment] = useState('');
  const [seenAt, setSeenAt] = useState(() => toLocalInput(new Date()));
  const [coords, setCoords] = useState<Coords | null>(null);
  const [notes, setNotes] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [reporterName, setReporterName] = useState('');
  const [reporterRole, setReporterRole] = useState('CITIZEN');
  const [reporterOrganization, setReporterOrganization] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ queued: boolean } | null>(null);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const clientUuid = crypto.randomUUID();

    try {
      const { queued } = await submit({
        path: '/personas/avistamientos',
        type: 'SIGHTING',
        clientUuid,
        payload: {
          clientUuid,
          kind: kind || 'SIGHTING',
          fullName: fullName.trim() || undefined,
          documentNumber: documentNumber.trim() || undefined,
          documentType: documentNumber.trim() ? 'CC' : undefined,
          estimatedAgeMin: ageMin ? Number(ageMin) : undefined,
          estimatedAgeMax: ageMax ? Number(ageMax) : undefined,
          sex: sex || undefined,
          heightCm: heightCm ? Number(heightCm) : undefined,
          build: build.trim() || undefined,
          hairColor: hairColor.trim() || undefined,
          distinguishingMarks: marks.trim() || undefined,
          clothingDescription: clothing.trim() || undefined,
          condition: condition || undefined,
          facilityName: facilityName.trim() || undefined,
          municipality: municipality.trim() || undefined,
          department: department.trim() || undefined,
          location: coords ?? undefined,
          seenAt: new Date(seenAt).toISOString(),
          notes: notes.trim() || undefined,
          reporterName: reporterName.trim() || undefined,
          reporterRole,
          reporterOrganization: reporterOrganization.trim() || undefined,
          deviceId: getDeviceId(),
        },
        label: `Avistamiento${fullName ? ` de ${fullName.trim()}` : ''}`,
      });

      if (photo) {
        await enqueuePhoto({
          clientUuid: crypto.randomUUID(),
          ownerType: 'SIGHTING_REPORT',
          ownerId: clientUuid,
          blob: photo,
        });
      }

      setDone({ queued });
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el avistamiento.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <span
          aria-hidden
          className="block h-1.5 w-16"
          style={{ background: done.queued ? 'var(--color-naranja)' : 'var(--color-via)' }}
        />
        <h1 className="mt-4 text-[clamp(1.6rem,5.5vw,2.3rem)] font-bold leading-tight tracking-tight">
          {done.queued ? 'Guardado en este teléfono' : 'Gracias. El reporte ya está en el sistema'}
        </h1>
        <p className="mt-3 text-[17px] leading-snug">
          {done.queued
            ? 'No hay señal. El avistamiento se envía solo en cuanto vuelva la conexión.'
            : 'El sistema lo está cruzando contra los reportes de personas desaparecidas. Si hay una coincidencia, un validador la revisa antes de avisarle a la familia.'}
        </p>
        <p className="mt-4 text-[16px] leading-snug text-ink-soft">
          No vas a recibir un aviso de esto: la notificación va a quien reportó la desaparición.
          Lo que hiciste puede ser lo que cierre esa búsqueda.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/avistamientos/nuevo"
            className="flex min-h-[56px] items-center bg-ink px-5 text-[17px] font-semibold text-paper"
            onClick={() => setDone(null)}
          >
            Reportar a otra persona
          </Link>
          <Link
            href="/mapa"
            className="flex min-h-[56px] items-center border-2 border-ink px-5 text-[17px] font-semibold"
          >
            Ir al mapa
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <p className="eyebrow" style={{ color: 'var(--color-via)' }}>
        Avistamiento
      </p>
      <h1 className="mt-2 text-[clamp(1.6rem,5.5vw,2.3rem)] font-bold leading-tight tracking-tight">
        Vi a alguien
      </h1>
      <p className="mt-3 text-[17px] leading-snug text-ink-soft">
        No necesitas saber su nombre. Si encontraste a alguien inconsciente, a un niño que no sabe
        su apellido o a una persona sin documentos, describe lo que ves: eso basta para cruzarlo
        con quien la está buscando.
      </p>

      <form onSubmit={send} noValidate>
        <ChoiceGroup
          legend="Dónde está esa persona"
          value={kind}
          onChange={setKind}
          columns={1}
          options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
        />

        <Field label="Cuándo la viste" required>
          {({ id }) => (
            <TextInput
              id={id}
              type="datetime-local"
              value={seenAt}
              onChange={(e) => setSeenAt(e.target.value)}
              required
            />
          )}
        </Field>

        <section className="mt-10">
          <h2 className="eyebrow">Cómo es la persona</h2>

          <PhotoPicker
            onChange={setPhoto}
            label="Foto"
            hint="Si puedes tomar una foto y la persona o su acompañante lo autoriza, es lo que más acelera la identificación."
          />

          <Field label="Nombre, si lo sabes" hint="Aunque sea incompleto o como te sonó">
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                maxLength={200}
              />
            )}
          </Field>

          <Field label="Número de documento" hint="Si lo tiene consigo. Es el dato más definitivo.">
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

          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label="Edad aproximada: desde">
              {({ id }) => (
                <TextInput
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={120}
                  value={ageMin}
                  onChange={(e) => setAgeMin(e.target.value)}
                />
              )}
            </Field>
            <Field label="hasta">
              {({ id }) => (
                <TextInput
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={120}
                  value={ageMax}
                  onChange={(e) => setAgeMax(e.target.value)}
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
            <Field label="Contextura">
              {({ id }) => (
                <TextInput
                  id={id}
                  value={build}
                  onChange={(e) => setBuild(e.target.value)}
                  maxLength={120}
                />
              )}
            </Field>
          </div>

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

          <Field
            label="Señas particulares"
            hint="Cicatrices, tatuajes, lunares. Es lo que identifica cuando el nombre falta."
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

          <Field label="Cómo estaba vestida">
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

          <ChoiceGroup
            legend="Cómo está"
            hint="Este dato no se publica. Lo ve el validador y define cómo se le comunica a la familia."
            value={condition}
            onChange={setCondition}
            columns={2}
            options={[
              { value: 'STABLE', label: 'Estable' },
              { value: 'INJURED', label: 'Herida' },
              { value: 'CRITICAL', label: 'Estado crítico' },
              { value: 'UNKNOWN', label: 'No sé' },
            ]}
          />
        </section>

        <section className="mt-10">
          <h2 className="eyebrow">Dónde está</h2>

          <Field label="Nombre del sitio" hint="Hospital, albergue, punto de acopio, colegio…">
            {({ id, describedBy }) => (
              <TextInput
                id={id}
                aria-describedby={describedBy}
                value={facilityName}
                onChange={(e) => setFacilityName(e.target.value)}
                maxLength={200}
              />
            )}
          </Field>

          <div className="grid gap-x-4 sm:grid-cols-2">
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
            <Field label="Departamento">
              {({ id }) => (
                <TextInput
                  id={id}
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  maxLength={100}
                />
              )}
            </Field>
          </div>

          <LocationPicker
            value={coords}
            onChange={setCoords}
            label="Ubicación en el mapa"
            hint="Si estás en el sitio, tomar la ubicación aquí es lo que más peso le da a la coincidencia."
          />

          <Field label="Algo más que ayude">
            {({ id }) => (
              <TextArea
                id={id}
                rows={3}
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </Field>
        </section>

        <section className="mt-10">
          <h2 className="eyebrow">Quién reporta</h2>

          <Field label="Tu nombre">
            {({ id }) => (
              <TextInput
                id={id}
                value={reporterName}
                onChange={(e) => setReporterName(e.target.value)}
                maxLength={200}
              />
            )}
          </Field>

          <Field label="Reportas como">
            {({ id }) => (
              <Select id={id} value={reporterRole} onChange={(e) => setReporterRole(e.target.value)}>
                <option value="CITIZEN">Ciudadano</option>
                <option value="FAMILY">Familiar</option>
                <option value="VOLUNTEER">Voluntario</option>
                <option value="RESCUER">Organismo de socorro</option>
                <option value="HEALTH_STAFF">Personal de salud</option>
                <option value="OFFICIAL">Entidad oficial</option>
              </Select>
            )}
          </Field>

          {reporterRole !== 'CITIZEN' && reporterRole !== 'FAMILY' && (
            <Field label="Institución">
              {({ id }) => (
                <TextInput
                  id={id}
                  value={reporterOrganization}
                  onChange={(e) => setReporterOrganization(e.target.value)}
                  maxLength={200}
                />
              )}
            </Field>
          )}
        </section>

        {error && <Notice tone="error">{error}</Notice>}

        <SubmitButton busy={busy} busyLabel="Registrando…" disabled={!seenAt}>
          Registrar el avistamiento
        </SubmitButton>
      </form>
    </div>
  );
}

/** Formato que espera un input datetime-local, en hora local del dispositivo. */
function toLocalInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
