import 'reflect-metadata';
import pg from 'pg';
import { DataTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { modelos } from '../models';
import { env } from './env';

// pg entrega BIGINT (COUNT(*), ids de las hypertables) y NUMERIC como texto
// para no perder precisión. Aquí todos caben en un double (ids < 2^53, rangos
// con 4 decimales), así que se convierten a number y el JSON sale limpio.
pg.types.setTypeParser(pg.types.builtins.INT8, (valor) => Number(valor));
// Sequelize registra su propio parser de NUMERIC (devuelve string); se reemplaza.
(DataTypes as unknown as { postgres: { DECIMAL: { parse: (valor: string) => number } } }).postgres.DECIMAL.parse = (
  valor,
) => Number(valor);

/**
 * Conexión única a Neon (PostgreSQL + TimescaleDB).
 *
 * - El esquema lo define `database/schema.sql` (hypertables, CHECKs, chunks).
 *   Por eso NUNCA se usa `sequelize.sync()`: los modelos solo lo reflejan.
 * - Neon exige SSL. Sequelize no traduce `?sslmode=require` de la URL al
 *   driver `pg`, así que se configura explícitamente en `dialectOptions`.
 */
export const sequelize = new Sequelize(env.DATABASE_URL, {
  dialect: 'postgres',
  logging: env.DB_LOGGING ? (sql) => console.log(`[sql] ${sql}`) : false,
  dialectOptions: env.DB_SSL ? { ssl: { require: true, rejectUnauthorized: true } } : {},
  pool: {
    max: env.DB_POOL_MAX,
    min: 0,
    idle: 10_000,
    // Neon suspende el cómputo por inactividad; despertarlo puede tardar unos segundos.
    acquire: 30_000,
  },
  define: {
    underscored: true,
    freezeTableName: true,
    createdAt: 'creado_en',
    updatedAt: 'actualizado_en',
  },
  models: modelos,
});

/** Mide la latencia de un `SELECT 1` contra la base de datos. */
export async function pingBaseDatos(): Promise<number> {
  const inicio = performance.now();
  await sequelize.query('SELECT 1');
  return Math.round(performance.now() - inicio);
}
