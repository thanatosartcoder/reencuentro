import { EntregaImposible, NotificationsService } from './notifications.service';
import { FcmClient, TokenMuerto } from './fcm.client';
import { NotificationChannel, NotificationKind, NotificationStatus } from './notifications.enums';
import type { NotificationOutbox } from './entities/notification-outbox.entity';

/**
 * El despachador frente a fallos parciales, sobre el servicio real.
 *
 * Se inyectan repositorios y un FCM falsos, pero el codigo que decide es el de
 * produccion: una prueba que replicara la logica pasaria igual el dia que el
 * servicio divergiera, y entonces no estaria probando nada.
 *
 * Lo que se fija aqui: que un destinatario con varios dispositivos cuente como
 * avisado si al menos uno recibe —a quien espera noticias de un familiar le basta
 * con que le llegue al telefono aunque falle la tablet—, y que un token muerto se
 * limpie en lugar de reintentarse cada quince segundos durante horas.
 */

type Estado = 'ok' | 'muerto' | 'transitorio';

function montar(devices: { id: string; deviceId: string; pushToken: string | null }[],
                resultados: Record<string, Estado>) {
  const actualizados: { id: string; cambios: Record<string, unknown> }[] = [];

  const deviceRepo = {
    createQueryBuilder: () => ({
      where: () => ({ andWhere: () => ({ getMany: async () => devices }) }),
    }),
    update: async (id: string, cambios: Record<string, unknown>) => {
      actualizados.push({ id, cambios });
    },
  };
  const outboxRepo = { update: async () => undefined, manager: {} };

  const service = new NotificationsService(
    outboxRepo as never,
    deviceRepo as never,
    { emitToRoom: () => undefined } as never,
  );

  const fcm: Pick<FcmClient, 'enviar'> = {
    enviar: async ({ token }) => {
      const r = resultados[token];
      if (r === 'muerto') throw new TokenMuerto('UNREGISTERED');
      if (r === 'transitorio') throw new Error('FCM respondió 503');
    },
  };
  // Se salta la lectura del entorno: aqui no se prueba la configuracion.
  (service as unknown as { fcmClient: unknown }).fcmClient = fcm;

  const aviso = {
    id: 'n1', kind: NotificationKind.MATCH_CONFIRMED, channel: NotificationChannel.PUSH,
    recipientKey: 'hash', title: 'Hay noticias', body: 'Revisa tu reporte',
    payload: {}, status: NotificationStatus.PENDING, attempts: 0,
  } as unknown as NotificationOutbox;

  const enviar = () =>
    (service as unknown as { deliverPush(n: NotificationOutbox): Promise<void> }).deliverPush(aviso);

  return { enviar, actualizados };
}

const dispositivo = (n: string, token: string | null) => ({ id: n, deviceId: 'dev-' + n, pushToken: token });

describe('deliverPush · entrega parcial', () => {
  it('con un dispositivo de tres que responde, cuenta como entregado', async () => {
    const { enviar, actualizados } = montar(
      [dispositivo('1', 'a'), dispositivo('2', 'b'), dispositivo('3', 'c')],
      { a: 'muerto', b: 'ok', c: 'transitorio' },
    );
    await expect(enviar()).resolves.toBeUndefined();
    expect(actualizados).toEqual([{ id: '1', cambios: { pushToken: null } }]);
  });

  it('si todos los tokens están muertos, no se reintenta', async () => {
    const { enviar, actualizados } = montar(
      [dispositivo('1', 'a'), dispositivo('2', 'b')], { a: 'muerto', b: 'muerto' },
    );
    // Se comprueba la clase y no el texto: lo que decide si el despachador
    // reintenta o cierra la fila es el tipo, no cómo esté redactado el mensaje.
    await expect(enviar()).rejects.toThrow(EntregaImposible);
    expect(actualizados.map((a) => a.id)).toEqual(['1', '2']);
  });

  it('si el fallo es transitorio, se propaga para que se reintente', async () => {
    const { enviar, actualizados } = montar([dispositivo('1', 'a')], { a: 'transitorio' });
    await expect(enviar()).rejects.not.toThrow(EntregaImposible);
    expect(actualizados).toEqual([]);
  });

  it('un token muerto se limpia aunque otro falle de forma transitoria', async () => {
    const { enviar, actualizados } = montar(
      [dispositivo('1', 'a'), dispositivo('2', 'b')], { a: 'muerto', b: 'transitorio' },
    );
    await expect(enviar()).rejects.toThrow(/503/);
    expect(actualizados.map((a) => a.id)).toEqual(['1']);
  });

  it('sin dispositivos registrados no se reintenta: es el caso normal', async () => {
    const { enviar } = montar([], {});
    await expect(enviar()).rejects.toThrow(EntregaImposible);
  });
});
