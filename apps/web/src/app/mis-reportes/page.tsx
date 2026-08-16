'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getStoredClaims, storeClaim, type StoredClaim } from '@/lib/device';
import { useRealtime } from '@/lib/realtime';
import { timeAgo } from '@/components/DecayMeter';
import { Notice } from '@/components/Form';

interface OwnerReport {
  id: string;
  fullName: string;
  status: string;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  reportedAt: string;
  municipality: string | null;
  department: string | null;
}

interface StoredNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  createdAt: string;
}

export default function MisReportesPage() {
  const [claims, setClaims] = useState<StoredClaim[]>([]);
  const [reports, setReports] = useState<Record<string, OwnerReport>>({});
  const [notifications, setNotifications] = useState<Record<string, StoredNotification[]>>({});
  const [manualToken, setManualToken] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const tokens = useMemo(() => claims.map((c) => c.claimToken), [claims]);
  // El canal en vivo cubre a quien tiene esta pantalla abierta esperando.
  const { connected, notifications: live } = useRealtime(tokens);

  const loadClaim = useCallback(async (claim: StoredClaim) => {
    try {
      const [report, history] = await Promise.all([
        api.get<OwnerReport>(
          `/personas/mis-reportes?claimToken=${encodeURIComponent(claim.claimToken)}`,
        ),
        api.get<{ items: StoredNotification[] }>(
          `/notifications?claimToken=${encodeURIComponent(claim.claimToken)}`,
        ),
      ]);
      setReports((current) => ({ ...current, [claim.claimToken]: report }));
      setNotifications((current) => ({ ...current, [claim.claimToken]: history.items }));
    } catch {
      // Sin conexión se muestra lo que hay guardado localmente.
    }
  }, []);

  useEffect(() => {
    // Solo desapariciones. Un avistamiento también guarda su claim token —lo
    // necesita para adjuntar su foto— pero esta pantalla consulta el seguimiento
    // de un caso, y ese endpoint solo conoce reportes de desaparición.
    const stored = getStoredClaims().filter((claim) => claim.kind !== 'SIGHTING');
    setClaims(stored);
    stored.forEach((claim) => void loadClaim(claim));
  }, [loadClaim]);

  // Al llegar un aviso en vivo se recarga el caso: el estado del reporte
  // cambió al mismo tiempo que la notificación.
  useEffect(() => {
    if (live.length) claims.forEach((claim) => void loadClaim(claim));
  }, [live.length, claims, loadClaim]);

  const addToken = async (event: React.FormEvent) => {
    event.preventDefault();
    setManualError(null);
    const token = manualToken.trim();
    if (!token) return;

    try {
      const report = await api.get<OwnerReport>(
        `/personas/mis-reportes?claimToken=${encodeURIComponent(token)}`,
      );
      const claim: StoredClaim = {
        claimToken: token,
        fullName: report.fullName,
        reportId: report.id,
        createdAt: report.reportedAt,
      };
      storeClaim(claim);
      setClaims(getStoredClaims());
      setReports((current) => ({ ...current, [token]: report }));
      setManualToken('');
    } catch {
      setManualError('Ese código no corresponde a ningún reporte. Revisa que esté completo.');
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-[clamp(1.6rem,5.5vw,2.3rem)] font-bold leading-tight tracking-tight">
        Mis reportes
      </h1>
      <p className="mt-3 text-[17px] leading-snug text-ink-soft">
        Los casos que reportaste desde este dispositivo.
        {connected && ' Estás conectado: si hay una novedad, aparece aquí al instante.'}
      </p>

      {live.length > 0 && (
        <div className="mt-6 border-2 border-ink">
          <div
            className="px-4 py-2.5 text-[15px] font-semibold text-paper"
            style={{ background: 'var(--color-via)' }}
          >
            Novedad
          </div>
          <ul>
            {live.map((notification) => (
              <li key={notification.id} className="rule px-4 py-3 first:border-t-0">
                <p className="text-[17px] font-semibold">{notification.title}</p>
                <p className="mt-1 text-[16px] leading-snug">{notification.body}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {claims.length === 0 ? (
        <div className="mt-8 border-2 border-rule px-4 py-6">
          <p className="text-[17px] font-semibold">Todavía no tienes reportes aquí</p>
          <p className="mt-2 text-[16px] leading-snug text-ink-soft">
            Si reportaste desde otro teléfono o borraste los datos del navegador, puedes
            recuperar el caso con el código de seguimiento que te dimos al registrarlo.
          </p>
          <Link
            href="/desaparecidos/nuevo"
            className="mt-4 flex min-h-[56px] items-center justify-center bg-ink px-5 text-[17px] font-semibold text-paper"
          >
            Reportar una desaparición
          </Link>
        </div>
      ) : (
        <ul className="mt-8 space-y-5">
          {claims.map((claim) => {
            const report = reports[claim.claimToken];
            const history = notifications[claim.claimToken] ?? [];

            return (
              <li key={claim.claimToken} className="border-2 border-ink">
                <div className="border-b border-ink px-4 py-3">
                  <p className="text-[19px] font-bold leading-tight">
                    {report?.fullName ?? claim.fullName}
                  </p>
                  <p className="num mt-1 text-[13px] text-ink-faint">
                    reportado {timeAgo(report?.reportedAt ?? claim.createdAt)}
                    {report?.municipality ? ` · ${report.municipality}` : ''}
                  </p>
                </div>

                <div className="px-4 py-4">
                  <StatusBlock status={report?.status ?? 'ACTIVE'} notes={report?.resolutionNotes} />

                  {history.length > 0 && (
                    <div className="mt-5">
                      <p className="eyebrow">Historial</p>
                      <ul className="mt-2 space-y-2">
                        {history.map((item) => (
                          <li key={item.id} className="border-l-2 border-rule pl-3">
                            <p className="text-[16px] font-semibold leading-snug">{item.title}</p>
                            <p className="mt-0.5 text-[15px] leading-snug text-ink-soft">
                              {item.body}
                            </p>
                            <p className="num mt-0.5 text-[12px] text-ink-faint">
                              {timeAgo(item.createdAt)}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <details className="mt-5">
                    <summary className="cursor-pointer text-[15px] underline underline-offset-4">
                      Ver mi código de seguimiento
                    </summary>
                    <p className="num mt-2 break-all bg-paper-sunk px-3 py-2.5 text-[14px]">
                      {claim.claimToken}
                    </p>
                  </details>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section className="rule mt-10 pt-6">
        <h2 className="text-[18px] font-bold">Recuperar un caso con su código</h2>
        <p className="mt-1 text-[16px] leading-snug text-ink-soft">
          Pega aquí el código que recibiste al registrar el reporte.
        </p>
        <form onSubmit={addToken} className="mt-3">
          <input
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
            className="num w-full border-2 border-rule bg-paper px-3 py-3 text-[15px] focus:border-ink focus:outline-none"
            placeholder=""
            aria-label="Código de seguimiento"
          />
          <button
            type="submit"
            className="mt-2 min-h-[56px] w-full border-2 border-ink px-4 text-[17px] font-semibold"
          >
            Recuperar el caso
          </button>
        </form>
        {manualError && <Notice tone="error">{manualError}</Notice>}
      </section>
    </div>
  );
}

function StatusBlock({ status, notes }: { status: string; notes?: string | null }) {
  const config: Record<string, { label: string; color: string; detail: string }> = {
    ACTIVE: {
      label: 'En búsqueda',
      color: 'var(--color-roja)',
      detail:
        'El sistema compara este reporte con cada avistamiento que llega. Te avisamos apenas un validador confirme una coincidencia.',
    },
    MATCHED: {
      label: 'Coincidencia en revisión',
      color: 'var(--color-naranja)',
      detail: 'Una persona está verificando una posible coincidencia. Te avisamos al terminar.',
    },
    FOUND_ALIVE: {
      label: 'Localizada con vida',
      color: 'var(--color-via)',
      detail: 'Un validador confirmó dónde está.',
    },
    FOUND_DECEASED: {
      label: 'Hay información confirmada',
      color: 'var(--color-ink-soft)',
      detail:
        'Comunícate con el punto de atención indicado en el aviso. Un funcionario te dará los detalles.',
    },
    CANCELLED: {
      label: 'Reporte retirado',
      color: 'var(--color-ink-faint)',
      detail: 'Este caso ya no está en búsqueda activa.',
    },
  };

  const entry = config[status] ?? config.ACTIVE;

  return (
    <div>
      <span className="stamp" style={{ color: entry.color }}>
        {entry.label}
      </span>
      <p className="mt-2 text-[16px] leading-snug">{entry.detail}</p>
      {notes && <p className="mt-2 text-[15px] leading-snug text-ink-soft">{notes}</p>}
    </div>
  );
}
