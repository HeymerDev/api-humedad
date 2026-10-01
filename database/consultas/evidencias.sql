-- =====================================================================
--  Evidencias de TimescaleDB para el informe y la sustentación
-- ---------------------------------------------------------------------
--  Solo lectura. Se pueden pegar una por una en el SQL Editor de Neon
--  o ejecutar todas con:  npm run db:evidencias
-- =====================================================================

-- 1. Extensión activa: versión y licencia (Neon trae la edición Apache)
SELECT extname AS extension, extversion AS version, current_setting('timescaledb.license') AS licencia
FROM pg_extension
WHERE extname = 'timescaledb';

-- 2. Hypertables del esquema
SELECT hypertable_name, num_dimensions, num_chunks, compression_enabled
FROM timescaledb_information.hypertables
ORDER BY hypertable_name;

-- 3. Columna de tiempo y chunk_time_interval de cada hypertable
SELECT hypertable_name, column_name, time_interval::text AS chunk_time_interval
FROM timescaledb_information.dimensions
ORDER BY hypertable_name;

-- 4. Chunks creados (consulta que pide el taller)
SELECT * FROM timescaledb_information.chunks;

-- 5. Chunks con su rango, filas reales y tamaño en disco
SELECT
    c.hypertable_name,
    c.chunk_name,
    c.range_start,
    c.range_end,
    (c.range_end - c.range_start)::text          AS intervalo,
    COALESCE(f.filas, 0)                         AS filas,
    pg_size_pretty(s.total_bytes)                AS tamano_total,
    pg_size_pretty(s.table_bytes)                AS tamano_datos,
    pg_size_pretty(s.index_bytes)                AS tamano_indices
FROM timescaledb_information.chunks c
LEFT JOIN (
    SELECT tableoid::regclass::text AS chunk, count(*) AS filas FROM lecturas GROUP BY 1
    UNION ALL
    SELECT tableoid::regclass::text, count(*) FROM estados_conexion GROUP BY 1
) f ON f.chunk = format('%I.%I', c.chunk_schema, c.chunk_name)
LEFT JOIN LATERAL (
    SELECT * FROM chunks_detailed_size(format('%I.%I', c.hypertable_schema, c.hypertable_name)::regclass) d
    WHERE d.chunk_name = c.chunk_name
) s ON true
ORDER BY c.hypertable_name, c.range_start;

-- 6. Tamaño total de cada hypertable
SELECT 'lecturas' AS hypertable, pg_size_pretty(hypertable_size('lecturas')) AS tamano
UNION ALL
SELECT 'estados_conexion', pg_size_pretty(hypertable_size('estados_conexion'));

-- 7. Volumen real: lecturas por día y sensor (el taller espera 4.320 por sensor/día)
SELECT time_bucket(INTERVAL '1 day', l.medido_en) AS dia, s.etiqueta, count(*) AS lecturas
FROM lecturas l
JOIN sensores s ON s.id = l.sensor_id
WHERE l.medido_en > now() - INTERVAL '30 days'
GROUP BY 1, 2
ORDER BY 1 DESC, 2;

-- 8. Chunk exclusion: una consulta de la última hora solo recorre los
--    chunks de ese rango (en el plan no aparecen los chunks antiguos)
EXPLAIN (COSTS OFF)
SELECT sensor_id, avg(valor)
FROM lecturas
WHERE medido_en > now() - INTERVAL '1 hour'
GROUP BY sensor_id;
