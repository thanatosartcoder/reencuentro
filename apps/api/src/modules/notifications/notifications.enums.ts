export enum NotificationChannel {
  /** Cliente con la app abierta: entrega inmediata por socket. */
  WEBSOCKET = 'WEBSOCKET',
  /** El caso general: la mayoria no tiene la app abierta cuando llega la noticia. */
  PUSH = 'PUSH',
  /** Ultimo recurso donde solo hay red 2G. */
  SMS = 'SMS',
  EMAIL = 'EMAIL',
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  /** Ya no tiene sentido enviarla (el caso se cerro por otra via). */
  CANCELLED = 'CANCELLED',
}

export enum NotificationKind {
  /** Un validador humano confirmo un match: la noticia que la familia espera. */
  MATCH_CONFIRMED = 'MATCH_CONFIRMED',
  /** Hay un candidato en revision. Se avisa sin afirmar nada todavia. */
  MATCH_PENDING_REVIEW = 'MATCH_PENDING_REVIEW',
  MATCH_REJECTED = 'MATCH_REJECTED',
  REPORT_RECEIVED = 'REPORT_RECEIVED',
  ZONE_NEARBY_ALERT = 'ZONE_NEARBY_ALERT',
}
