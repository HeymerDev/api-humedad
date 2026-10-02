import { z } from 'zod';
import { SEVERIDADES } from '../models/enums';

// Carga .env si existe. En Render las variables llegan por el entorno y no hay archivo.
try {
  process.loadEnvFile();
} catch {
  // sin .env: se usan las variables del entorno
}

const booleano = z
  .enum(['true', 'false'])
  .transform((valor) => valor === 'true');

const esquemaEnv = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().default('*'),

  DATABASE_URL: z
    .string({ error: 'DATABASE_URL es obligatoria: pega la cadena de conexión de Neon en .env' })
    .min(1, { error: 'DATABASE_URL es obligatoria: pega la cadena de conexión de Neon en .env', abort: true })
    .refine((url) => url.startsWith('postgres://') || url.startsWith('postgresql://'), {
      message: 'DATABASE_URL debe empezar por postgres:// o postgresql://',
    }),
  DB_SSL: booleano.default(true),
  DB_POOL_MAX: z.coerce.number().int().positive().default(5),
  DB_LOGGING: booleano.default(false),

  APP_TIMEZONE: z.string().default('America/Bogota'),
  LECTURA_INTERVALO_SEG: z.coerce.number().int().positive().default(20),
  DISPOSITIVO_OFFLINE_SEG: z.coerce.number().int().positive().default(90),

  ALERTA_SEVERIDAD_MINIMA: z.enum(SEVERIDADES).default('MEDIA'),
  ALERTA_AUTO_RESOLVER_MIN: z.coerce.number().int().positive().default(120),
  VIGILANCIA_INTERVALO_SEG: z.coerce.number().int().min(0).default(60),
});

const resultado = esquemaEnv.safeParse(process.env);

if (!resultado.success) {
  console.error('Variables de entorno inválidas:\n' + z.prettifyError(resultado.error));
  process.exit(1);
}

export const env = resultado.data;
export type Env = typeof env;
