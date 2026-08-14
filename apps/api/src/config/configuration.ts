function int(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

export const configuration = () => ({
  port: int(process.env.PORT, 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: int(process.env.DB_PORT, 5433),
    username: process.env.DB_USER ?? 'reencuentro',
    password: process.env.DB_PASSWORD ?? 'reencuentro',
    database: process.env.DB_NAME ?? 'reencuentro',
    synchronize: bool(process.env.DB_SYNCHRONIZE, false),
    logging: bool(process.env.DB_LOGGING, false),
  },

  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev-secret-inseguro',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  },

  uploads: {
    maxBytes: int(process.env.MAX_PHOTO_BYTES, 8_000_000),
    // Decodificaciones simultáneas. Con el tope de 50 MP por imagen, cuatro son
    // unos 600 MB de pico en el peor caso.
    concurrency: int(process.env.PHOTO_CONCURRENCY, 4),
    // webp | jpeg | avif. WebP pesa ~30% menos que JPEG a calidad equivalente
    // y codifica rápido; AVIF comprime más pero su coste de CPU se paga en las
    // ráfagas de subida.
    format: process.env.PHOTO_FORMAT ?? 'webp',
    quality: int(process.env.PHOTO_QUALITY, 82),
  },

  storage: {
    // local | s3 (cualquier servicio compatible: R2, B2, MinIO, S3)
    provider: process.env.STORAGE_PROVIDER ?? 'local',
    localDir: process.env.UPLOADS_DIR ?? './uploads',
    // Margen de disco que nunca se consume con fotos. El volumen lo comparte
    // la base de datos y quedarse sin espacio impediría registrar reportes.
    minFreeBytes: int(process.env.STORAGE_MIN_FREE_BYTES, 2 * 1024 ** 3),
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? '',
      region: process.env.S3_REGION ?? 'auto',
      bucket: process.env.S3_BUCKET ?? '',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
  },

  matching: {
    searchRadiusMeters: int(process.env.MATCH_SEARCH_RADIUS_M, 50_000),
    minScore: Number(process.env.MATCH_MIN_SCORE ?? 0.55),
    highScore: Number(process.env.MATCH_HIGH_SCORE ?? 0.8),
  },

  face: {
    provider: (process.env.FACE_PROVIDER ?? 'none') as 'none' | 'rekognition' | 'http',
    httpUrl: process.env.FACE_HTTP_URL ?? '',
    awsRegion: process.env.AWS_REGION ?? 'us-east-1',
  },

  push: {
    fcmServerKey: process.env.FCM_SERVER_KEY ?? '',
  },
});

export type AppConfig = ReturnType<typeof configuration>;
