import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { hashToken } from 'src/common/crypto/tokens';
import { corsOrigins } from 'src/config/configuration';

/** Sala privada de un reportante, derivada del hash de su claim token. */
export const claimRoom = (claimTokenHash: string) => `claim:${claimTokenHash}`;

/** Sala de los validadores acreditados: cola de revision en vivo. */
export const OPERATORS_ROOM = 'operators';

/** Sala publica del mapa: reportes de zona nuevos y cambios de confianza. */
export const MAP_ROOM = 'map';

/**
 * Canal en tiempo real.
 *
 * Cubre el caso de quien tiene la aplicacion abierta esperando noticias. No
 * sustituye al push: la mayoria de la gente no va a estar mirando la pantalla
 * cuando llegue la respuesta, y por eso toda notificacion pasa primero por el
 * outbox persistente. Este gateway es la ruta rapida, no la unica.
 */
/**
 * Orígenes admitidos en el canal en vivo.
 *
 * Antes era `origin: true`, que refleja el origen que venga y, con
 * `credentials: true`, autoriza a cualquier página de internet a abrir el canal
 * en nombre de quien la visite. El resto de la API ya usaba una lista blanca;
 * esto era la excepción, y las excepciones en una regla de origen son las que
 * nadie recuerda cuando se añade la primera cosa autenticada al socket.
 *
 * Se resuelve por conexión y no al importar el módulo para que `dotenv` haya
 * cargado. Una petición sin `Origin` —un cliente nativo, una sonda— se admite:
 * la regla existe para acotar lo que un navegador puede hacer en nombre de un
 * tercero, y sin navegador no hay ese riesgo que acotar.
 */
const permitirOrigen = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void => {
  if (!origin || corsOrigins().includes(origin)) return callback(null, true);
  callback(null, false);
};

@WebSocketGateway({
  cors: { origin: permitirOrigen, credentials: true },
  namespace: '/realtime',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket): void {
    // El mapa es informacion publica de emergencia: cualquiera que se conecte
    // lo recibe sin pedir credenciales.
    client.join(MAP_ROOM);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Cliente desconectado: ${client.id}`);
  }

  /**
   * El cliente presenta su claim token en claro; el servidor lo convierte al
   * hash con el que se nombra la sala. Nunca viaja el hash desde el cliente:
   * eso permitiria a cualquiera escuchar la sala de otro con solo conocerlo.
   */
  @SubscribeMessage('subscribe:claim')
  handleSubscribeClaim(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { claimToken?: string },
  ): { ok: boolean; error?: string } {
    if (!body?.claimToken || typeof body.claimToken !== 'string') {
      return { ok: false, error: 'claimToken requerido' };
    }
    client.join(claimRoom(hashToken(body.claimToken)));
    return { ok: true };
  }

  @SubscribeMessage('subscribe:map')
  handleSubscribeMap(@ConnectedSocket() client: Socket): { ok: boolean } {
    client.join(MAP_ROOM);
    return { ok: true };
  }

  emitToRoom(room: string, event: string, payload: unknown): void {
    // El gateway puede no estar inicializado en pruebas o durante el arranque.
    this.server?.to(room).emit(event, payload);
  }

  emitToClaim(claimTokenHash: string, event: string, payload: unknown): void {
    this.emitToRoom(claimRoom(claimTokenHash), event, payload);
  }

  emitToOperators(event: string, payload: unknown): void {
    this.emitToRoom(OPERATORS_ROOM, event, payload);
  }

  emitToMap(event: string, payload: unknown): void {
    this.emitToRoom(MAP_ROOM, event, payload);
  }
}
