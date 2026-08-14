import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import { SyncBar } from '@/components/SyncBar';
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar';

export const metadata: Metadata = {
  title: 'Reencuentro · Sismo Colombia 2026',
  description:
    'Reporta a una persona desaparecida, avisa dónde viste a alguien y consulta el mapa de vías y zonas afectadas por el sismo del 10 de agosto de 2026.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#12161c',
  width: 'device-width',
  initialScale: 1,
  // Se permite el zoom: mucha gente lo necesita para leer, y bloquearlo por
  // estética es excluir a quien menos margen tiene.
  maximumScale: 5,
};

const NAV = [
  { href: '/', label: 'Situación' },
  { href: '/mapa', label: 'Mapa' },
  { href: '/desaparecidos', label: 'Desaparecidos' },
  { href: '/mis-reportes', label: 'Mis reportes' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CO">
      <body>
        <ServiceWorkerRegistrar />

        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
        >
          Saltar al contenido
        </a>

        <header className="bg-ink text-paper">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="flex items-baseline gap-2.5">
              <span className="text-[19px] font-bold tracking-tight">Reencuentro</span>
              <span className="eyebrow" style={{ color: 'var(--color-rule)' }}>
                Sismo 10 ago 2026
              </span>
            </Link>

            <nav aria-label="Principal">
              <ul className="flex flex-wrap gap-x-5 gap-y-1">
                {NAV.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="inline-block py-1.5 text-[15px] font-medium text-paper/85 underline-offset-4 hover:text-paper hover:underline"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </header>

        <SyncBar />

        <main id="contenido">{children}</main>

        <footer className="rule mt-16">
          <div className="mx-auto max-w-5xl px-4 py-8 text-[14px] leading-relaxed text-ink-soft">
            <p>
              Las cifras del evento provienen de la <strong>UNGRD</strong>, la{' '}
              <strong>Fiscalía General de la Nación</strong> y el{' '}
              <strong>Servicio Geológico Colombiano</strong>. Los reportes de personas y de
              zonas los hace la comunidad y no constituyen información oficial.
            </p>
            <p className="mt-3">
              Si tienes una emergencia en curso, llama al <strong className="num">123</strong>.
              Esta plataforma no reemplaza a las líneas de atención.
            </p>
            <p className="mt-3 text-ink-faint">
              Los datos personales se tratan conforme a la Ley 1581 de 2012. Las fotos y los
              datos de contacto se guardan cifrados y su consulta queda registrada.
            </p>
            {/* La ODbL obliga a atribuir. No es una cortesía: es la condición
                bajo la que la comunidad humanitaria libera estos datos. */}
            <p className="mt-3 text-ink-faint">
              Red vial y mapa base: datos ©{' '}
              <a
                href="https://www.openstreetmap.org/copyright"
                className="underline underline-offset-2"
                target="_blank"
                rel="noopener noreferrer"
              >
                colaboradores de OpenStreetMap
              </a>
              , licencia ODbL, con el mapeo de emergencia del Humanitarian OpenStreetMap Team.
              Sismos: <strong>USGS</strong>. Daño en edificaciones:{' '}
              <strong>Microsoft AI for Good Lab</strong> vía Humanitarian Data Exchange.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
