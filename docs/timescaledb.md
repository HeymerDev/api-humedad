# TimescaleDB: hypertables, chunks y justificación del intervalo

Base de datos: **Neon**, PostgreSQL 18.6 con **TimescaleDB 2.24.0** (licencia
`apache`). Script completo en [`database/schema.sql`](../database/schema.sql) y
consultas de evidencia en [`database/consultas/evidencias.sql`](../database/consultas/evidencias.sql)
(`npm run db:evidencias`).

## ¿Qué es un chunk?

Una **hypertable** se usa como una tabla normal (`INSERT`, `SELECT`, FK...),
pero por dentro TimescaleDB la divide automáticamente en tablas hijas llamadas
**chunks**. Cada chunk guarda un intervalo de tiempo fijo, definido por el
`chunk_time_interval`.

Cuando una consulta filtra por tiempo (`WHERE medido_en > now() - INTERVAL '1 hour'`),
el planificador descarta los chunks que no pueden contener filas de ese rango.
Esto se llama ***chunk exclusion***. Así, consultar la última hora cuesta lo
mismo con mil filas que con millones, porque solo se leen los chunks recientes.
Además, borrar datos viejos se reduce a eliminar chunks completos (`drop_chunks`)
en vez de ejecutar `DELETE` fila por fila.

## Hypertables del proyecto

| Hypertable | Columna de tiempo | `chunk_time_interval` | Qué guarda |
|------------|-------------------|-----------------------|------------|
| `lecturas` | `medido_en` | **1 día** | Una fila por medición de cada sensor (cada 20 s) |
| `estados_conexion` | `registrado_en` | **7 días** | Un latido del ESP32 por minuto |

TimescaleDB exige que la columna de tiempo forme parte de la clave primaria.
Por eso las dos tablas usan PK compuesta `(id, <columna de tiempo>)`.

## Cálculo de volumen

Con una lectura cada 20 s por sensor:

| Periodo | Por sensor | 3 sensores (estación actual) | 4 sensores (ejemplo del taller) |
|---------|-----------:|-----------------------------:|--------------------------------:|
| 1 minuto | 3 | 9 | 12 |
| 1 hora | 180 | 540 | 720 |
| 1 día | 4.320 | 12.960 | 17.280 |
| 1 semana | 30.240 | 90.720 | 120.960 |
| 1 mes (30 días) | 129.600 | 388.800 | 518.400 |

La estación `esp32_01` tiene 3 sensores: `temperatura_aire` y `humedad_aire`
(DHT22) y `temperatura_agua` (DS18B20).

### Tamaño medido, no supuesto

El primer chunk de `lecturas` tiene **3.039 filas** reales y ocupa **688 kB**:
312 kB de datos y 376 kB de índices. Eso da unos **232 bytes por fila** con
índices incluidos. Las filas nuevas también llenan `valor_crudo` y `lote_id`,
así que se estiman **~250 bytes por fila**.

| Intervalo de chunk | Filas por chunk (3 sensores) | Tamaño por chunk (3 sensores) | Tamaño por chunk (4 sensores) | Chunks por año |
|--------------------|-----------------------------:|------------------------------:|------------------------------:|---------------:|
| 1 hora | 540 | ~0,13 MB | ~0,17 MB | 8.760 |
| **1 día (elegido)** | **12.960** | **~3,1 MB** | **~4,1 MB** | **365** |
| 7 días (valor por defecto) | 90.720 | ~21,6 MB | ~28,8 MB | 52 |
| 30 días | 388.800 | ~92,7 MB | ~123,6 MB | 12 |

## Justificación: `lecturas` con chunk de 1 día

La recomendación de TimescaleDB es que los chunks recientes, con sus índices,
quepan en un 25 % de la memoria del servidor. Con 0,25 CU de Neon (1 GB de RAM)
ese límite es de unos 256 MB. Cualquier intervalo de hasta 30 días lo cumple
con este volumen, así que la decisión se toma por otros criterios:

1. **Coincide con las consultas del sistema.** Todas las opciones del menú del
   teclado trabajan sobre las últimas 24 horas o menos: valor actual, promedio
   de la última hora, máximo y mínimo de hoy, tendencia y outliers recientes.
   Con chunks de 1 día cada consulta lee como mucho 2 chunks de ~3 MB. Son 2
   porque el día local de Bogotá (UTC-5) cruza dos días UTC. Ese tamaño cabe
   holgado en memoria. Con chunks de 30 días cada consulta abriría un chunk de
   casi 100 MB para usar solo unos pocos kB.
2. **Inserción eficiente.** El ESP32 inserta cada 20 s y siempre en el chunk
   más reciente. Un chunk pequeño mantiene sus índices en caché, así que cada
   `INSERT` no tiene que leer disco.
3. **No genera demasiados chunks.** Con 1 día salen 365 chunks al año, una
   cantidad que el planificador maneja sin problema. Con 1 hora serían 8.760
   chunks de ~130 kB: el costo de planificar y mantener cada chunk superaría su
   beneficio.
4. **Gestión de datos por día.** Si el almacenamiento de Neon se queda corto,
   se pueden borrar días completos con `drop_chunks`, sin hacer `DELETE` masivos.
5. **Evidencia visible.** Cada día con datos genera su propio chunk, así que en
   la sustentación se ven varios chunks en `timescaledb_information.chunks`.

> **Nota.** La base venía del esquema anterior con chunks de 7 días. El primer
> chunk (`_hyper_1_1_chunk`, del 3 al 10 de septiembre de 2026) conserva ese
> rango. `set_chunk_time_interval` solo afecta a los chunks nuevos: a partir de
> la próxima lectura, cada chunk cubre 1 día.

## Justificación: `estados_conexion` con chunk de 7 días

Con 1 latido por minuto salen 1.440 filas al día por ESP32. A ~200 bytes por
fila, un chunk de 1 día pesaría unos 290 kB, demasiado pequeño para compensar
lo que cuesta cada chunk. Con 7 días el chunk queda en ~2 MB. Las consultas de
esta tabla piden el último estado (menú 7) o el historial de la semana, y ambas
caben en uno o dos chunks.

## Chunk exclusion en la práctica

Consulta 8 de `evidencias.sql`:

```sql
EXPLAIN (COSTS OFF)
SELECT sensor_id, avg(valor) FROM lecturas
WHERE medido_en > now() - INTERVAL '1 hour'
GROUP BY sensor_id;
```

Hoy no hay datos en la última hora. Por eso el plan muestra
`One-Time Filter: false`: TimescaleDB descartó **todos** los chunks sin leer
ninguno. Cuando el ESP32 esté enviando datos, el plan mostrará solo el chunk
del día en curso.

## Limitaciones de la edición Apache (Neon)

| Funciona | No disponible en Neon |
|----------|-----------------------|
| Hypertables, chunks, `set_chunk_time_interval` | Compresión nativa |
| `time_bucket`, `first()`, `last()` | *Continuous aggregates* |
| `show_chunks`, `drop_chunks`, `chunks_detailed_size` | Políticas automáticas de retención y compresión |
| FK desde y hacia hypertables (TimescaleDB ≥ 2.16) | `time_bucket_gapfill` |

Por eso los promedios y extremos del menú se calculan al momento con
`time_bucket` y funciones de agregación, sin vistas materializadas.

**Cuidado con `drop_chunks`.** `anomalias` tiene una FK
`(lectura_id, lectura_medido_en) → lecturas` con `ON DELETE SET NULL (lectura_id)`.
Esa acción se ejecuta con `DELETE`, pero **`drop_chunks` no la dispara**:
borra el chunk entero y deja `lectura_id` apuntando a lecturas que ya no
existen (se comprobó en una transacción de prueba). Antes de borrar chunks
viejos hay que ejecutar:

```sql
UPDATE anomalias SET lectura_id = NULL WHERE lectura_medido_en < '<fecha de corte>';
SELECT drop_chunks('lecturas', older_than => TIMESTAMPTZ '<fecha de corte>');
```
