import type { Metadata } from 'next';
import Link from 'next/link';

/**
 * Política de tratamiento de datos personales.
 *
 * La Ley 1581 de 2012 la exige, pero eso no es lo que la hace necesaria. Aquí
 * la gente entrega el documento de su hija, su propio teléfono y una foto, en
 * el peor momento de su vida y con prisa. Merecen saber exactamente qué se
 * publica, qué no sale nunca y a quién reclamarle — antes de escribirlo, no
 * después.
 *
 * Por eso el texto es **específico**: dice qué campo se cifra, qué se ve en el
 * listado público y qué pasa con la ubicación de un menor. Una política escrita
 * en genérico se puede firmar sin entenderla, y entonces el consentimiento que
 * documenta no significa nada.
 */

// ---------------------------------------------------------------------------
// PENDIENTE DE COMPLETAR antes de anunciar la plataforma.
//
// La ley exige identificar al responsable con nombre, domicilio y un canal de
// atención. Sin esto, quien entrega los datos de su hija no tiene a quién
// reclamarle, y esa es justamente la garantía que la norma protege.
// ---------------------------------------------------------------------------
const RESPONSABLE = {
  nombre: 'Roibert David Peñaloza Valencia',
  correo: 'roibert@suitedynamics.io',
  /** Ciudad y dirección de notificación. Requisito del artículo 13 del Decreto 1377. */
  domicilio: 'Barranquilla, Colombia',
};

const ACTUALIZADA = '15 de agosto de 2026';

export const metadata: Metadata = {
  title: 'Política de tratamiento de datos · Reencuentro',
  description:
    'Qué datos personales recoge Reencuentro, qué se publica, qué nunca sale, cuánto se conservan y cómo pedir su corrección o eliminación.',
};

export default function PrivacidadPage() {
  return (
    <main id="contenido" className="mx-auto max-w-2xl px-4 py-10">
      <p className="eyebrow">Ley 1581 de 2012</p>
      <h1 className="mt-1 text-[30px] font-bold leading-tight tracking-tight">
        Política de tratamiento de datos personales
      </h1>
      <p className="num mt-2 text-[14px] text-ink-faint">
        Actualizada el {ACTUALIZADA}
      </p>

      <p className="mt-6 text-[17px] leading-relaxed">
        Esta plataforma existe para ayudar a encontrar personas desaparecidas tras el sismo del
        10 de agosto de 2026. Para eso necesita datos que identifican a alguien, y algunos son
        sensibles. Aquí está, sin rodeos, qué se hace con ellos.
      </p>

      <Seccion titulo="Quién responde por estos datos">
        <p>
          <strong>{RESPONSABLE.nombre}</strong>, con domicilio en {RESPONSABLE.domicilio}, actúa
          como responsable del tratamiento.
        </p>
        <p>
          Canal de atención:{' '}
          <a href={`mailto:${RESPONSABLE.correo}`} className="underline underline-offset-2">
            {RESPONSABLE.correo}
          </a>
          . Es el mismo correo para preguntar, corregir, pedir el retiro de un caso o reclamar.
        </p>
        <p className="text-ink-faint">
          Reencuentro no es una entidad oficial y no reemplaza a la UNGRD, la Fiscalía ni a las
          líneas de emergencia. Si tienes una emergencia en curso, llama al{' '}
          <strong className="num">123</strong>.
        </p>
      </Seccion>

      <Seccion titulo="Qué se recoge">
        <p>Cuando alguien reporta a una persona desaparecida:</p>
        <Lista>
          <li>Nombre, edad o rango de edad, sexo y descripción física de la persona buscada.</li>
          <li>Su número de documento, si se conoce.</li>
          <li>Fotografías, si se aportan.</li>
          <li>
            Dónde y cuándo se le vio por última vez, y las circunstancias.
          </li>
          <li>
            Notas médicas relevantes para su búsqueda —una condición que requiera medicación, por
            ejemplo—. La ley las considera <strong>datos sensibles</strong> y por eso son
            opcionales: se piden solo porque pueden salvarle la vida a quien se busca.
          </li>
          <li>
            De quien reporta: nombre, teléfono, correo y su relación con la persona buscada.
          </li>
        </Lista>
        <p>
          Cuando alguien reporta un avistamiento se recoge lo equivalente sobre la persona vista,
          más el lugar y la hora. Cuando se reporta una vía cortada o un albergue en el mapa, se
          recoge la ubicación del punto y lo que se describa, no la identidad de quien lo reporta.
        </p>
      </Seccion>

      <Seccion titulo="Para qué se usa">
        <Lista>
          <li>
            Publicar un listado de búsqueda donde alguien pueda reconocer a la persona.
          </li>
          <li>
            Cruzar reportes de desaparición con avistamientos para proponer coincidencias.
          </li>
          <li>
            Avisar a quien reportó cuando una coincidencia se confirma.
          </li>
          <li>
            Entregar la información a organismos de búsqueda y socorro cuando lo soliciten.
          </li>
        </Lista>
        <p>
          No se usa para publicidad, no se vende, no se cede a terceros con fines comerciales y no
          se usa para elaborar perfiles.
        </p>
      </Seccion>

      <Seccion titulo="Qué se publica y qué no">
        <p>
          Esta es la parte concreta. El listado público de búsqueda muestra{' '}
          <strong>el nombre, la foto, la edad aproximada, la descripción física y el municipio</strong>{' '}
          — porque sin eso nadie puede reconocer a la persona, que es el único motivo por el que
          existe el listado.
        </p>
        <p>
          <strong>Nunca se publican</strong>, en ninguna pantalla ni exportación pública:
        </p>
        <Lista>
          <li>El número de documento.</li>
          <li>El teléfono o el correo de quien reporta.</li>
          <li>Las notas médicas.</li>
          <li>
            La coordenada exacta de un menor de edad. Del listado y del mapa solo sale el
            municipio.
          </li>
        </Lista>
        <p>
          El documento, el teléfono y el correo se guardan <strong>cifrados</strong> en la base de
          datos. Quien tuviera acceso al archivo sin la clave no podría leerlos.
        </p>
      </Seccion>

      <Seccion titulo="Menores de edad">
        <p>
          La ley prohíbe tratar datos de menores salvo cuando responde a su interés superior. Aquí
          se tratan por una sola razón: encontrarlos.
        </p>
        <p>
          En consecuencia, su ubicación exacta no sale por ningún canal —ni en el listado, ni en el
          mapa, ni en las exportaciones— y los reportes sobre menores llevan una marca que obliga a
          esa redacción en todo el sistema, no solo en la pantalla.
        </p>
      </Seccion>

      <Seccion titulo="Quién puede ver los datos completos">
        <p>
          Solo personal acreditado con cuenta propia. Nadie conoce la contraseña de otra persona:
          las cuentas se crean por invitación y cada quien establece la suya.
        </p>
        <p>
          <strong>Toda consulta de datos completos queda registrada</strong> — quién, qué y cuándo.
          Ese registro existe precisamente para poder responder esa pregunta si alguien la hace.
        </p>
        <p>
          Un coordinador puede exportar los casos en formato PFIF, el estándar que usan los
          sistemas de búsqueda de personas, para entregarlos a un organismo de socorro. Esa
          exportación no es pública, requiere sesión y también queda registrada.
        </p>
      </Seccion>

      <Seccion titulo="Cuánto tiempo se conservan">
        <p>
          Mientras el caso siga abierto, y después mientras siga siendo útil para la búsqueda o
          para responder por lo que se hizo.
        </p>
        <p>
          Quien reportó puede pedir el retiro en cualquier momento y sin dar explicaciones,
          escribiendo al correo de arriba. Al retirarlo, el caso deja de aparecer en el listado
          público de inmediato.
        </p>
        <p className="text-ink-faint">
          El registro de auditoría se conserva aunque el caso se retire: es lo que permite
          demostrar quién accedió a qué, y borrarlo dejaría sin efecto la garantía que protege a
          la propia persona.
        </p>
      </Seccion>

      <Seccion titulo="Tus derechos">
        <p>Sobre tus datos y sobre los de la persona que reportaste, puedes:</p>
        <Lista>
          <li>Saber qué datos hay y de dónde salieron.</li>
          <li>Corregirlos si están mal o incompletos.</li>
          <li>Pedir que se eliminen o que el caso se retire.</li>
          <li>Revocar la autorización que diste.</li>
          <li>
            Presentar una queja ante la <strong>Superintendencia de Industria y Comercio</strong>,
            que es la autoridad de protección de datos en Colombia.
          </li>
        </Lista>
        <p>
          Para ejercerlos, escribe a{' '}
          <a href={`mailto:${RESPONSABLE.correo}`} className="underline underline-offset-2">
            {RESPONSABLE.correo}
          </a>{' '}
          indicando qué caso es y qué necesitas. Las consultas se responden en un máximo de{' '}
          <strong>diez días hábiles</strong> y los reclamos en <strong>quince</strong>, como fija
          la ley.
        </p>
      </Seccion>

      <Seccion titulo="Cómo se protegen">
        <Lista>
          <li>Documento, teléfono y correo, cifrados en la base de datos.</li>
          <li>Contraseñas guardadas de forma que no se pueden revertir.</li>
          <li>Copias de seguridad diarias, para que un fallo no borre lo que alguien contó.</li>
          <li>Registro de auditoría de cada consulta de datos completos.</li>
          <li>
            Ningún aviso sale a una familia sin que una persona confirme antes la coincidencia. El
            sistema propone; no decide.
          </li>
        </Lista>
        <p className="text-ink-faint">
          Ninguna medida es infalible y esta política no promete lo contrario. El código es
          público y puede auditarse.
        </p>
      </Seccion>

      <Seccion titulo="Cambios">
        <p>
          Si esta política cambia, la fecha de arriba cambia con ella y la versión anterior queda
          en el historial público del repositorio. Un cambio que amplíe el uso de los datos ya
          entregados se avisará antes de aplicarlo.
        </p>
      </Seccion>

      <p className="rule mt-10 pt-6 text-[15px]">
        <Link href="/" className="underline underline-offset-4">
          Volver al inicio
        </Link>
      </p>
    </main>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rule mt-8 pt-6">
      <h2 className="text-[20px] font-bold leading-tight tracking-tight">{titulo}</h2>
      <div className="mt-3 space-y-3 text-[16px] leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}

function Lista({ children }: { children: React.ReactNode }) {
  return <ul className="ml-4 list-disc space-y-1.5 marker:text-ink-faint">{children}</ul>;
}
