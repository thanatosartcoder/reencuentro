'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:4000';

export interface LiveNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * Canal en vivo.
 *
 * Cubre a quien tiene la pestaña abierta esperando noticias. No sustituye al
 * push ni al outbox del servidor: la mayoría no va a estar mirando la pantalla
 * cuando llegue la respuesta. Esta es la ruta rápida, no la única.
 */
export function useRealtime(claimTokens: string[]) {
  const [connected, setConnected] = useState(false);
  const [notifications, setNotifications] = useState<LiveNotification[]>([]);
  const [zoneEvents, setZoneEvents] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  // Los tokens se serializan para no reconectar en cada render por identidad
  // de array.
  const key = claimTokens.join(',');

  useEffect(() => {
    const socket = io(`${API_ORIGIN}/realtime`, {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 2_000,
      reconnectionDelayMax: 30_000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      // El token viaja en claro y el servidor deriva el nombre de la sala. Si
      // el cliente enviara el hash, cualquiera que lo conociera podría
      // escuchar el caso de otra persona.
      for (const claimToken of key.split(',').filter(Boolean)) {
        socket.emit('subscribe:claim', { claimToken });
      }
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('notification', (payload: LiveNotification) => {
      setNotifications((current) => [payload, ...current]);
    });

    socket.on('zone:created', () => setZoneEvents((n) => n + 1));
    socket.on('zone:updated', () => setZoneEvents((n) => n + 1));

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [key]);

  return { connected, notifications, zoneEvents, socket: socketRef.current };
}

/** Estado de red del navegador, para el indicador de sincronización. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}
