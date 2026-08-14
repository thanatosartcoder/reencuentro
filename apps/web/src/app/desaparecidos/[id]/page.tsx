import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverGet } from '@/lib/server-api';
import type { MissingPerson } from '@/lib/api';
import { Photo, PhotoPlaceholder } from '@/components/Photo';

const STATUS: Record<string, { label: string; color: string; detail: string }> = {
  ACTIVE: {
    label: 'En búsqueda',
    color: 'var(--color-roja)',
    detail: 'El sistema sigue cruzando este reporte con cada avistamiento que llega.',
  },
  FOUND_ALIVE: {
    label: 'Localizada con vida',
    color: 'var(--color-via)',
    detail: 'Un validador confirmó la coincidencia y se avisó a quien reportó.',
  },
  FOUND_DECEASED: {
    label: 'Caso cerrado',
    color: 'var(--color-ink-soft)',
    detail: 'Hay información confirmada. La familia fue contactada por la entidad correspondiente.',
  },
  MATCHED: {
    label: 'Posible coincidencia en revisión',
    color: 'var(--color-naranja)',
    detail: 'Una persona está verificando la coincidencia antes de dar cualquier aviso.',
  },
};

export default async function DetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const person = await serverGet<MissingPerson>(`/personas/desaparecidos/${id}`, {
    revalidate: 15,
  });

  if (!person) notFound();

  const status = STATUS[person.status] ?? STATUS.ACTIVE;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/desaparecidos" className="text-[15px] underline underline-offset-4">
        ← Todos los reportes
      </Link>

      <div className="mt-5 flex flex-wrap items-start gap-5">
        {person.photos[0] ? (
          <Photo
            photo={person.photos[0]}
            alt={`Fotografía de ${person.fullName}`}
            className="h-44 w-44 border-2 border-ink object-cover"
            eager
          />
        ) : (
          <PhotoPlaceholder className="h-44 w-44 border-2" />
        )}

        <div className="min-w-0 flex-1">
          <span className="stamp" style={{ color: status.color }}>
            {status.label}
          </span>
          <h1 className="mt-2 text-[clamp(1.5rem,5vw,2.1rem)] font-bold leading-tight tracking-tight">
            {person.fullName}
          </h1>
          {person.aliases.length > 0 && (
            <p className="mt-1 text-[16px] text-ink-soft">
              También conocida como {person.aliases.join(', ')}
            </p>
          )}
          <p className="mt-3 text-[16px] leading-snug text-ink-soft">{status.detail}</p>
        </div>
      </div>

      <section className="mt-9">
        <h2 className="eyebrow">Descripción</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 sm:grid-cols-3">
          <Detail label="Edad" value={person.age !== null ? `${person.age} años` : null} />
          <Detail label="Sexo" value={sexLabel(person.sex)} />
          <Detail label="Estatura" value={person.heightCm ? `${person.heightCm} cm` : null} />
          <Detail label="Contextura" value={person.build} />
          <Detail label="Cabello" value={person.hairColor} />
          <Detail label="Piel" value={person.skinTone} />
        </dl>

        {person.distinguishingMarks && (
          <Block label="Señas particulares" value={person.distinguishingMarks} />
        )}
        {person.clothingDescription && (
          <Block label="Cómo estaba vestida" value={person.clothingDescription} />
        )}
      </section>

      <section className="mt-9">
        <h2 className="eyebrow">Última vez que la vieron</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-6">
          <Detail
            label="Lugar"
            value={[person.municipality, person.department].filter(Boolean).join(', ') || null}
          />
          <Detail
            label="Fecha"
            value={
              person.lastSeenAt
                ? new Date(person.lastSeenAt).toLocaleString('es-CO', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })
                : null
            }
          />
        </dl>
        {person.circumstances && <Block label="Qué pasó" value={person.circumstances} />}
      </section>

      {person.status === 'ACTIVE' && (
        <section className="mt-10 border-2 border-ink p-5">
          <h2 className="text-[20px] font-bold leading-tight tracking-tight">
            ¿La has visto?
          </h2>
          <p className="mt-2 text-[16px] leading-snug text-ink-soft">
            Si la viste, si está en un albergue o si la atendieron en un puesto médico, repórtalo.
            Un validador compara tu reporte con este antes de avisarle a la familia: no vas a
            darle una noticia falsa a nadie.
          </p>
          <Link
            href="/avistamientos/nuevo"
            className="mt-4 flex min-h-[56px] items-center justify-center bg-ink px-5 text-[17px] font-semibold text-paper"
          >
            Reportar que la vi
          </Link>
        </section>
      )}

      <p className="mt-8 text-[14px] leading-snug text-ink-faint">
        Los datos de contacto de quien reportó, el documento de identidad y las notas médicas no
        se publican. La ubicación exacta de los menores de edad tampoco.
      </p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="mt-3">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 text-[17px]">{value}</dd>
    </div>
  );
}

function Block({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-5">
      <p className="eyebrow">{label}</p>
      <p className="mt-1 text-[17px] leading-snug">{value}</p>
    </div>
  );
}

function sexLabel(sex: string): string | null {
  return (
    { MALE: 'Masculino', FEMALE: 'Femenino', OTHER: 'Otro', UNKNOWN: null }[sex] ?? null
  );
}
