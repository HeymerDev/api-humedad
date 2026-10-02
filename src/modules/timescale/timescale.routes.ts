import { Router } from 'express';
import { QueryTypes } from 'sequelize';
import { z } from 'zod';
import { sequelize } from '../../config/database';
import { env } from '../../config/env';
import { validar } from '../../middlewares/validar';

/**
 * /api/v1/timescale  ·  evidencias de TimescaleDB para la sustentación
 * (mismas consultas que database/consultas/evidencias.sql, en JSON).
 */
export const timescaleRouter = Router();

const HYPERTABLES = ['lecturas', 'estados_conexion'] as const;

const consultar = <T extends object>(sql: string, replacements: Record<string, unknown> = {}) =>
  sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT });

/** GET /api/v1/timescale  ·  versión, licencia e hypertables con su chunk_time_interval. */
timescaleRouter.get('/', async (_req, res) => {
  const [[extension], hypertables] = await Promise.all([
    consultar<{ version: string; licencia: string }>(
      `SELECT extversion AS version, current_setting('timescaledb.license') AS licencia
       FROM pg_extension WHERE extname = 'timescaledb'`,
    ),
    consultar(
      `SELECT h.hypertable_name AS hypertable, d.column_name AS columna_tiempo,
              d.time_interval::text AS chunk_time_interval, h.num_chunks AS chunks,
              h.compression_enabled AS compresion,
              pg_size_pretty(hypertable_size(format('%I.%I', h.hypertable_schema, h.hypertable_name)::regclass)) AS tamano,
              approximate_row_count(format('%I.%I', h.hypertable_schema, h.hypertable_name)::regclass) AS filas_aprox
       FROM timescaledb_information.hypertables h
       JOIN timescaledb_information.dimensions d
         ON d.hypertable_schema = h.hypertable_schema AND d.hypertable_name = h.hypertable_name
       ORDER BY h.hypertable_name`,
    ),
  ]);
  res.json({ data: { extension: 'timescaledb', ...extension, hypertables } });
});

/** GET /api/v1/timescale/chunks?hypertable=lecturas  ·  cada chunk con su rango, filas y tamaño. */
timescaleRouter.get(
  '/chunks',
  validar({ query: z.object({ hypertable: z.enum(HYPERTABLES).default('lecturas') }) }, async ({ query }, _req, res) => {
    // El nombre viene de una lista cerrada (enum), por eso se puede interpolar en FROM
    const chunks = await consultar(
      `SELECT c.chunk_name AS chunk, c.range_start AS desde, c.range_end AS hasta,
              (c.range_end - c.range_start)::text AS intervalo,
              coalesce(f.filas, 0)::int AS filas,
              pg_size_pretty(s.total_bytes) AS tamano_total,
              pg_size_pretty(s.table_bytes) AS tamano_datos,
              pg_size_pretty(s.index_bytes) AS tamano_indices
       FROM timescaledb_information.chunks c
       LEFT JOIN (
           SELECT tableoid::regclass::text AS chunk, count(*) AS filas FROM ${query.hypertable} GROUP BY 1
       ) f ON f.chunk = format('%I.%I', c.chunk_schema, c.chunk_name)
       LEFT JOIN LATERAL (
           SELECT * FROM chunks_detailed_size(:hypertable::regclass) d WHERE d.chunk_name = c.chunk_name
       ) s ON true
       WHERE c.hypertable_name = :hypertable
       ORDER BY c.range_start`,
      { hypertable: query.hypertable },
    );
    res.json({ data: { hypertable: query.hypertable, total: chunks.length, chunks } });
  }),
);

/**
 * GET /api/v1/timescale/plan?minutos=60  ·  demuestra el chunk exclusion: el
 * plan de "promedio de los últimos N minutos" solo recorre los chunks del rango.
 */
timescaleRouter.get(
  '/plan',
  validar({ query: z.object({ minutos: z.coerce.number().int().min(1).max(525600).default(60) }) }, async ({ query }, _req, res) => {
    const plan = await consultar<{ 'QUERY PLAN': string }>(
      `EXPLAIN (COSTS OFF)
       SELECT sensor_id, avg(valor) FROM lecturas
       WHERE medido_en > now() - make_interval(mins => :minutos)
       GROUP BY sensor_id`,
      { minutos: query.minutos },
    );
    const [{ total }] = await consultar<{ total: number }>(
      `SELECT count(*)::int AS total FROM timescaledb_information.chunks WHERE hypertable_name = 'lecturas'`,
    );
    const lineas = plan.map((p) => p['QUERY PLAN']);
    const recorridos = [...new Set(lineas.join('\n').match(/_hyper_\d+_\d+_chunk/g) ?? [])];
    res.json({
      data: {
        consulta: `promedio por sensor de los últimos ${query.minutos} min`,
        chunks_totales: total,
        chunks_recorridos: recorridos.length,
        chunks: recorridos,
        explicacion:
          recorridos.length === 0
            ? 'Ningún chunk contiene ese rango: TimescaleDB los descartó todos sin leerlos'
            : `Solo se leen ${recorridos.length} de ${total} chunks; el resto se descarta por su rango de tiempo`,
        plan: lineas,
      },
    });
  }),
);

/**
 * GET /api/v1/timescale/volumen?dias=30  ·  lecturas por día y sensor con
 * time_bucket, contra las 4.320 esperadas por sensor y día (una cada 20 s).
 */
timescaleRouter.get(
  '/volumen',
  validar({ query: z.object({ dias: z.coerce.number().int().min(1).max(366).default(30) }) }, async ({ query }, _req, res) => {
    const esperadas = Math.round(86400 / env.LECTURA_INTERVALO_SEG);
    const filas = await consultar<{ dia: string; sensor: string; dispositivo: string; lecturas: number }>(
      `SELECT time_bucket(INTERVAL '1 day', l.medido_en, :tz)::date::text AS dia,
              s.etiqueta AS sensor, d.codigo AS dispositivo, count(*)::int AS lecturas
       FROM lecturas l
       JOIN sensores s ON s.id = l.sensor_id
       JOIN dispositivos d ON d.id = s.dispositivo_id
       WHERE l.medido_en > now() - make_interval(days => :dias)
       GROUP BY 1, 2, 3
       ORDER BY 1 DESC, 3, 2`,
      { dias: query.dias, tz: env.APP_TIMEZONE },
    );
    res.json({
      data: {
        esperadas_por_sensor_y_dia: esperadas,
        dias: filas.map((f) => ({ ...f, cobertura_pct: Math.round((f.lecturas / esperadas) * 1000) / 10 })),
      },
    });
  }),
);
