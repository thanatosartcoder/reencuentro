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
    dir: process.env.UPLOADS_DIR ?? './uploads',
    maxBytes: int(process.env.MAX_PHOTO_BYTES, 8_000_000),
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
