# Plan de implementación — api-humedad

API REST (Node.js + Express 5 + TypeScript + sequelize-typescript) sobre **Neon
(PostgreSQL + TimescaleDB)** para el Proyecto Integrador "Sistema IoT con Series
Temporales". La consume un **ESP32** que envía lecturas cada 20 s y consulta la
analítica desde un teclado matricial y un LCD. Sin autenticación (lo pide el taller).

Las tareas se ejecutan **una por una**, en orden. Al terminar cada una se marca
`[x]` y se entrega el mensaje de commit (Conventional Commits) para que lo
ejecutes tú.

---

## Convenciones del proyecto

**Estructura**

```
api-humedad/
├─ database/
│  ├─ schema.sql            # script SQL completo (entregable del componente 1)
│  ├─ seed.sql              # datos semilla idempotentes
│  └─ consultas/            # consultas de evidencia (hypertables, chunks)
├─ docs/                    # justificación de chunks, contrato del ESP32...
├─ src/
│  ├─ config/               # env.ts (zod), database.ts (Sequelize + Neon)
│  ├─ database/             # scripts: ejecutar SQL, verificar modelos
│  ├─ models/               # 1 archivo por tabla + index.ts
│  ├─ modules/<recurso>/    # <recurso>.routes|controller|service|schemas.ts
│  ├─ middlewares/          # validación, 404, errores
│  ├─ utils/
│  ├─ routes/index.ts       # monta /api/v1
│  ├─ app.ts
│  └─ server.ts
├─ DIAGRAMA_ER.md
└─ tasks.md
```

**Reglas**

- El esquema lo manda `database/schema.sql`. **Nunca** `sequelize.sync()`; los
  modelos solo reflejan las tablas.
- En los modelos **siempre** declarar el tipo: `@Column(DataType.FLOAT)`. `tsx`
  (desarrollo) no emite metadata de decoradores.
- Capas: `routes` (rutas + `validar(...)` con zod) → `service` (lógica y acceso
  a datos). Los catálogos usan la fábrica `crearCrud` y solo tienen
  `routes.ts` + `schemas.ts`. Las consultas de series temporales van en SQL
  crudo (`sequelize.query` con `replacements`/`bind`), nunca concatenando strings.
- Los esquemas de creación son `.strict()`: un campo desconocido (ej. `id`) es 400.
- Respuestas: éxito `{ data, meta? }`; listas con `meta: { total, limit, offset }`;
  error `{ error: { codigo, mensaje, detalles? } }`. Códigos 200/201/204/400/404/409/503.
- Rutas en español, plural y kebab-case: `/api/v1/tipos-sensor`, `/api/v1/reglas-umbral`.
- Toda consulta sobre `lecturas` lleva un filtro de tiempo (`medido_en >= ...`)
  para que TimescaleDB descarte chunks (*chunk exclusion*).
- Commits: Conventional Commits en español (`feat:`, `fix:`, `chore:`, `docs:`,
  `refactor:`, `test:`). Los ejecuta el dueño del repo, no el asistente.

**Limitación de Neon (verificada)**: PostgreSQL 18.6 + TimescaleDB 2.24.0 con
licencia `apache`. Hypertables, chunks, `time_bucket`, `first/last`,
`show_chunks`, `drop_chunks`, `set_chunk_time_interval` y FK hacia hypertables
funcionan. Compresión, *continuous aggregates*, políticas automáticas y
`time_bucket_gapfill` **no** están disponibles. Detalle en `docs/timescaledb.md`.

---

## Contrato con el ESP32 (borrador, se fija en las tareas 6, 9 y 10)

Estación real (ya en la BD): dispositivo `esp32_01` con los sensores
`temperatura_aire` y `humedad_aire` (DHT22) y `temperatura_agua` (DS18B20).

Ingesta, cada 20 s o al vaciar el buffer tras una caída:

```http
POST /api/v1/lecturas
{
  "dispositivo": "esp32_01",
  "origen": "TIEMPO_REAL",          // o "BUFFER" al reenviar lo acumulado offline
  "intento": 1,                     // nº de reintento del mismo envío
  "enviado_en": 1790000000,         // epoch en segundos (NTP), opcional
  "lecturas": [
    { "sensor": "temperatura_aire", "valor": 24.6, "medido_en": 1790000000 },
    { "sensor": "humedad_aire",     "valor": 61.3, "medido_en": 1790000000 },
    { "sensor": "temperatura_agua", "valor": 19.8, "medido_en": 1790000000 }
  ]
}
→ 201 { "data": { "lote_id": 123, "recibidas": 3, "aceptadas": 3, "rechazadas": 0, "duplicadas": 0,
                  "invalidas": 0, "sospechosas": 0, "hora_servidor": 1790000001, "duracion_ms": 640 } }
```

Si hay rechazos llega además `errores: [{ indice, sensor, motivo }]`. Cualquier
2xx significa "no reintentar": las lecturas rechazadas fallarían igual. Solo
se reintenta ante un error de red, un 5xx o un timeout, y es seguro hacerlo
porque las lecturas ya guardadas vuelven como `duplicadas`. La respuesta trae
además `anomalias` y `alertas_abiertas` (tarea 8).

`medido_en` acepta epoch (s) o ISO-8601; si falta se usa la hora del servidor.
`hora_servidor` le sirve al ESP32 si el NTP falla.

Latido (cada 60 s): `POST /api/v1/dispositivos/esp32_01/estados-conexion`
con `{ ntp_sincronizado, rssi_dbm, ip, uptime_s, heap_libre_bytes, lecturas_en_buffer, reconexiones_wifi, envios_fallidos, version_firmware }`.

Menú: `GET /api/v1/analitica/<opcion>?dispositivo=esp32_01&lcd=16x2&solo_lcd=true` →
`{ lcd: { columnas, filas, paginas } }`, con páginas ya recortadas al display.
Contrato definitivo en `docs/esp32.md`.

| Tecla | Endpoint | Concepto de analítica |
|-------|----------|-----------------------|
| 1 | `/analitica/valores-actuales` | Dato en tiempo real (último valor por sensor) |
| 2 | `/analitica/promedio-hora` | Media aritmética en ventana móvil de 1 h |
| 3 | `/analitica/extremos-dia` | Máximo y mínimo del día (rango) |
| 4 | `/analitica/tendencia` | Desviación estándar (dispersión) + pendiente por regresión lineal |
| 5 | `/analitica/outliers` | Valores atípicos por Z-score (\|z\| > 3) e IQR (k = 1.5) |
| 6 | `/analitica/alertas-activas` | Conteo y agregación por severidad |
| 7 | `/analitica/estado-conexion` | Monitoreo: latencia a la BD, último dato, ONLINE/OFFLINE |
| * / # | (lo resuelve el ESP32) | Volver / confirmar |

---

## Tareas

### [x] 0. Estructura y configuración base

- Git inicializado (`main`) con remoto `origin` → `HeymerDev/api-humedad`.
- `package.json`, `tsconfig.json`, `.gitignore`, `.env.example` / `.env`.
- `src/config/env.ts`: validación de variables con zod (falla con mensaje claro si falta `DATABASE_URL`).
- `src/config/database.ts`: Sequelize hacia Neon con SSL y pool.
- `src/app.ts`, `src/server.ts`, manejo global de errores y 404, `GET /health`.
- `DIAGRAMA_ER.md` (12 tablas) y este `tasks.md`.

**Commit**: `chore: inicializar API REST con Express, TypeScript y Sequelize`

---

### [x] 1. Script SQL completo, hypertables y chunks

**Decisión**: se **conservan los datos** (3.039 lecturas reales de `esp32_01`,
que además cubren el mínimo de 3.000 registros de FlowiseAI). `schema.sql`
sirve para una base vacía y para la del esquema v1: las columnas nuevas se
agregan con `ADD COLUMN IF NOT EXISTS` y las restricciones en bloques `DO`.

- `database/schema.sql` idempotente: 12 tablas con PK, FK, `CHECK`, `UNIQUE`,
  índices y `COMMENT ON`; columnas v2 (`lecturas.lote_id`, `lecturas.valor_crudo`,
  `reglas_umbral.tipo_anomalia` con backfill, `anomalias.regla_id`,
  `anomalias.lectura_id`, `alertas.tipo`, `alertas.ultima_ocurrencia_en`);
  hypertables `lecturas` (1 día) y `estados_conexion` (7 días); FK compuesta
  `anomalias → lecturas`; índice único parcial de alertas activas; vista
  `v_lecturas_detalle`.
- `src/database/ejecutar-sql.ts`: ejecuta un `.sql` en una transacción, con
  `--probar` (ROLLBACK) y `--todo`. Scripts `db:schema`, `db:seed`, `db:evidencias`.
- `database/consultas/evidencias.sql` y `docs/timescaledb.md` (volumen,
  tamaño medido de ~232 B/fila, justificación de chunks, chunk exclusion,
  limitaciones de Neon y el cuidado con `drop_chunks`).

**Verificado**: probado en una base vacía (esquema temporal) y en la real,
dos veces cada una; aplicado en Neon dos veces sin errores.

**Commit**: `feat(db): agregar esquema SQL con 12 tablas e hypertables de TimescaleDB`

---

### [x] 2. Datos semilla

- `database/seed.sql` idempotente (`ON CONFLICT DO NOTHING`), alineado con los
  datos existentes: 3 `tipos_sensor`, la ubicación, `esp32_01`, sus 3 `sensores`,
  8 `reglas_umbral` (las 4 v1 + salto brusco del aire, valor congelado y sensor
  sin datos) y las 7 `opciones_menu` con su concepto de analítica.

**Verificado**: `npm run db:seed` dos veces deja 3 tipos, 1 ubicación,
1 dispositivo, 3 sensores, 8 reglas y 7 opciones.

**Commit**: `feat(db): agregar datos semilla de reglas y opciones del menú`

---

### [x] 3. Modelos sequelize-typescript

- `src/models/*.model.ts` (12) tipados con `InferAttributes` /
  `InferCreationAttributes`, asociaciones `@BelongsTo` / `@HasMany` con FK
  explícita, timestamps mapeados a las columnas reales y PK compuesta en las
  hypertables. `src/models/enums.ts` con los valores de los `CHECK`.
- `database.ts`: registra los modelos y convierte `BIGINT`/`NUMERIC` a `number`.
- `tsconfig.json`: `useDefineForClassFields: false` (si no, los campos de clase
  tapan los getters de Sequelize).
- `src/database/verificar-modelos.ts` (`npm run db:verificar`): compara nombre,
  tipo y nulabilidad de cada columna con la BD, prueba las asociaciones y
  escribe en las 12 tablas dentro de una transacción revertida.

**Verificado**: `npm run typecheck` sin errores y `npm run db:verificar` →
12/12 modelos coinciden con la BD.

**Commit**: `feat(models): agregar modelos de las 12 tablas con sus asociaciones`

---

### [x] 4. Infraestructura común de la API

- `validar({ body, query, params }, handler)` (`src/middlewares/validar.ts`):
  el handler recibe los datos ya validados y tipados (en Express 5 `req.query`
  es de solo lectura, por eso no se reescribe `req`).
- `src/utils/paginacion.ts` (`limit` 1–500, por defecto 50), `fechas.ts`
  (epoch s/ms o ISO-8601 → Date), `esquemas.ts` (helpers zod), `crear-crud.ts`
  (fábrica REST con filtros, `include`, búsqueda por campo alterno y
  `antesDeEliminar`).
- `error-handler.ts`: errores zod con el campo exacto (`lecturas.2.valor`),
  CHECK/NOT NULL/fuera de rango → 400, FK inexistente → 400, registro en uso
  (FK o RESTRICT) → 409, cuerpo > 1 MB → 413.
- El rango "hoy" en `APP_TIMEZONE` y el formateo LCD pasan a la tarea 10, que es donde se usan.

**Commit**: `feat(api): agregar validacion, paginacion y fabrica de CRUD`

---

### [x] 5. CRUD de catálogos

- `/tipos-sensor` y `/dispositivos` aceptan id o código en `/:id`
  (`/tipos-sensor/DHT22_TEMP`, `/dispositivos/esp32_01`).
- `/ubicaciones`, `/sensores`, `/reglas-umbral`: CRUD completo con filtros.
- `GET /dispositivos/:ref/sensores`.
- `/opciones-menu`: `GET` (con `?tecla=`), `GET /:id`, `PATCH /:id` (título ASCII ≤ 16).
- Protecciones: borrar un sensor o dispositivo con lecturas → 409 (la FK
  borraría su serie temporal en cascada; se desactiva con `activo: false`);
  un sensor no cambia de dispositivo ni de tipo; las reglas validan sus
  parámetros según `tipo_anomalia` con mensajes por campo.
- `docs/api.http` con ejemplos de todos los endpoints.

**Verificado**: 39 pruebas HTTP contra Neon (creación, duplicados, CHECK,
FK, RESTRICT, filtros, paginación) con datos temporales que se borran al final.

**Commit**: `feat(api): agregar CRUD de catalogos, dispositivos y reglas`

---

### [x] 6. Ingesta de lecturas desde el ESP32

- `POST /api/v1/lecturas` (contrato de arriba), en una transacción:
  1. Busca el dispositivo por `codigo` (404 si no existe, 409 si está desactivado)
     y los sensores por `etiqueta`.
  2. Valida cada lectura por separado: una mala se rechaza con su índice y
     motivo, y el resto se guarda. Motivos: sensor no registrado o inactivo,
     `valor` null o no numérico (NaN del DHT22), `medido_en` en el futuro
     (> 5 min) o de hace más de 30 días (NTP sin sincronizar), repetida en el lote.
  3. Calibra (`valor = crudo * escala + offset`) y guarda `valor_crudo`.
  4. Calidad: fuera del rango físico → `INVALIDA`; DS18B20 en `0.0` →
     `SOSPECHOSA`. Ambas se guardan; la analítica solo usará las `OK`.
  5. Inserta con `INSERT ... ON CONFLICT (sensor_id, medido_en) DO NOTHING`:
     **reintentar un lote no duplica datos** (las repetidas salen como `duplicadas`).
  6. Registra el `lotes_envio` (origen, intento, conteos, errores, duración)
     y actualiza `dispositivos.ultima_conexion`. La IP y el firmware llegan con
     el latido (tarea 9): desde la ingesta solo se vería la IP pública del router.
- Esquema: índice único `uq_lecturas_sensor_medido (sensor_id, medido_en)`, que
  reemplaza a `ix_lecturas_sensor_tiempo` (aplicado en Neon).
- `GET /api/v1/lecturas`: `dispositivo`, `sensor_id`, `calidad`, `desde`/`hasta`
  (por defecto últimas 24 h, máx. 31 días), `orden`, paginación.
- `GET /api/v1/lotes-envio` (`dispositivo`, `origen`, `con_rechazos`, fechas) y
  `GET /lotes-envio/:id` con sus lecturas.

**Verificado**: 28 pruebas HTTP con un dispositivo temporal (lote mixto 4 + 6,
reintento → 4 duplicadas, BUFFER, calibración 24.6 + 0.5 = 25.1, filtros,
errores 400/404/409). Se borró al terminar; las 3.039 lecturas de `esp32_01`
quedaron intactas. Un lote tarda ~0,6–3 s según la latencia a Neon, así que
el ESP32 debe usar un timeout HTTP de al menos 10 s.

**Commit**: `feat(lecturas): agregar ingesta por lotes del ESP32 y consulta de lecturas`

---

### [x] 7. Simulador del ESP32

- `src/database/simular-esp32.ts` (`npm run simular`): se comporta como el
  firmware. Envía un lote cada 20 s y un latido cada 60 s, con valores con
  ciclo diario y ruido. Además simula:
  - anomalías inyectadas (salto, fuera de rango, NaN, DS18B20 en 0.0);
  - cortes de Wi-Fi con buffer y reenvío como `BUFFER`;
  - hasta 3 reintentos con `intento` creciente.
- Opciones: `--intervalo`, `--latido`, `--ciclos`, `--historico <min>` (rellena
  hacia atrás a 20 s), `--congelar <etiqueta>`, `--prob-anomalia`, `--prob-corte`,
  `--url` y `--limpiar` (borra el dispositivo simulado y todos sus datos).
- Usa su propio dispositivo `esp32_sim` y **se niega a simular sobre `esp32_01`**
  (exige `--forzar`). Los datos para KNIME y FlowiseAI deben ser los reales.

**Commit**: `chore: agregar simulador del ESP32 para pruebas locales`

---

### [x] 8. Detector de anomalías y alertas

- `anomalias.detector.ts`: corre **después** de guardar cada lote (si falla,
  las lecturas no se pierden y la respuesta trae `anomalias: null`). Las
  estadísticas de ventana de todo el lote salen en una sola consulta con
  `LATERAL`. Por tipo de anomalía gana la regla más específica: sensor > tipo > global.
  - `FUERA_DE_RANGO`: regla `valor_min`/`valor_max`. Además, toda lectura
    `INVALIDA` (fuera del rango físico) genera esta anomalía con severidad ALTA.
  - `SALTO_BRUSCO`: UMBRAL contra la lectura anterior (≤ 10 min) o MEDIA_MOVIL
    contra la media de la ventana.
  - `OUTLIER_ESTADISTICO`: ZSCORE o IQR sobre las lecturas OK de la ventana.
    Ignora desviaciones menores que la precisión del sensor (ruido).
  - `VALOR_CONGELADO`: mismo valor exacto durante toda la ventana; registra
    una anomalía por ventana, no una por lectura.
- `alertas.service.ts`: abre una alerta desde severidad `ALERTA_SEVERIDAD_MINIMA`
  (MEDIA). Si ya hay una activa del mismo sensor y tipo, suma `ocurrencias`.
  Para eso usa `INSERT ... ON CONFLICT` sobre el índice único parcial.
- `GET /anomalias` (filtros), `GET /anomalias/:id`, `PATCH /anomalias/:id` (`revisada`).
- `GET /alertas` (`activas`, `estado`, `dispositivo`...), `GET /alertas/:id`,
  `PATCH /alertas/:id` (ABIERTA → RECONOCIDA → RESUELTA; una RESUELTA no se reabre).
- La ingesta responde además `anomalias` y `alertas_abiertas`.

**Commit**: `feat(anomalias): detectar anomalias al ingerir y generar alertas`

---

### [x] 9. Latidos y vigilancia de dispositivos

- `POST /api/v1/dispositivos/:ref/estados-conexion`: guarda el latido en la
  hypertable y actualiza en el dispositivo `ultima_conexion`, `direccion_ip` y
  `version_firmware`. `GET` devuelve el historial (últimas 24 h por defecto).
- Vigilancia dentro de la API cada `VIGILANCIA_INTERVALO_SEG` (60 s; 0 = apagada)
  y bajo demanda con `POST /api/v1/vigilancia/ejecuciones`:
  - `SENSOR_SIN_DATOS`: sensor activo sin lecturas en `ventana_minutos`.
    Registra una anomalía por silencio, sin repetirla en cada pasada.
  - Auto-resolución: `SENSOR_SIN_DATOS` cuando el sensor vuelve a enviar; el
    resto, tras `ALERTA_AUTO_RESOLVER_MIN` (120) sin repeticiones. El mensaje
    indica que se resolvió sola.

**Verificado (tareas 7–9)**:
- Simulación de 90 min de histórico más ciclos en vivo con anomalías forzadas.
- 26 pruebas HTTP: saltos, rangos, valor congelado, alertas agrupadas y su
  ciclo de estados, latidos y vigilancia con resolución automática.
- Al terminar todo se limpió y la BD quedó como estaba (3.039 lecturas, 0
  anomalías o alertas).

**Al arrancar la API**: la vigilancia abrirá 3 alertas ALTA "sin datos" para
`esp32_01`, porque no envía desde el 8/9. Es lo correcto, y se resuelven solas
cuando el ESP32 vuelva a enviar.

**Firmware**: un lote del buffer de 498 lecturas tarda ~4 s de punta a punta
(detección incluida) y el primero tras arrancar la API puede tardar más.
Conviene vaciar el buffer en lotes de ~150 lecturas con un timeout de 15 s.

**Commit**: `feat(dispositivos): registrar latidos y vigilar sensores sin datos`

---

### [x] 10. Analítica del menú (teclas 1–7)

- `src/utils/lcd.ts`: paso a ASCII (sin tildes ni `°`), abreviaturas
  (`temperatura_aire` → `T.aire`) y paginado en bloques por sensor: 1 sensor
  por página en 16x2 y 2 en 20x4. `src/utils/tiempo.ts`: "hoy" en
  `APP_TIMEZONE` resuelto en SQL, hora local y antigüedad ("12s", "24d").
- `src/modules/analitica`: las 7 opciones en SQL crudo con filtro de tiempo.
  1. Última lectura por sensor (ordered append, `LIMIT 1`).
  2. `avg`/`min`/`max` de la ventana más serie de 10 min con `time_bucket`.
  3. Máximo y mínimo del día con su hora (`?fecha=` para otro día).
  4. `stddev_samp`, coeficiente de variación, `regr_slope` por hora y `regr_r2`.
     La tendencia es ESTABLE si el cambio en la ventana es menor que la
     precisión del sensor.
  5. Z-score e IQR (`percentile_cont`) con límites, conteos y ejemplos, más
     las anomalías que el detector registró en la ventana.
  6. Alertas activas por severidad y las 5 principales.
  7. Ping a la BD, último latido y último lote, estado ONLINE/OFFLINE.
- Respuesta `{ data, lcd: { columnas, filas, paginas } }`.
  - `solo_lcd=true` para el ESP32 (~150 bytes).
  - `registrar=false` para pruebas.
- Cada consulta válida queda en `consultas_menu` (duración, éxito o error).
  `GET /consultas-menu` y `GET /consultas-menu/resumen` (uso por tecla).
  `GET /analitica` es el índice tecla → endpoint.

**Verificado**: con 2 h simuladas, las 7 teclas responden con páginas válidas
(ASCII, ≤ 16 columnas, ≤ 2 filas), en ~400 ms del lado del servidor y ~600 ms
de punta a punta. También sobre los datos reales de `esp32_01` del 7/9.

**Commit**: `feat(analitica): agregar endpoints del menu del teclado con salida para LCD`

---

### [x] 11. Endpoints de evidencia TimescaleDB

- `GET /timescale`: versión, licencia e hypertables (`chunk_time_interval`,
  chunks, tamaño, filas aproximadas).
- `GET /timescale/chunks?hypertable=`: rango, filas y tamaño de cada chunk.
- `GET /timescale/plan?minutos=`: `EXPLAIN` de "promedio de los últimos N
  min" con los chunks recorridos frente a los totales (chunk exclusion en vivo).
- `GET /timescale/volumen?dias=`: lecturas por día y sensor con `time_bucket`
  frente a las 4.320 esperadas.

**Commit**: `feat(timescale): exponer hypertables, chunks y chunk exclusion para la sustentacion`

---

### [x] 12. Documentación

- `README.md` completo: instalación, variables, scripts, simulador,
  endpoints, menú, base de datos y estructura.
- `docs/api.http`: todas las peticiones de ejemplo.
- `docs/esp32.md`: contrato definitivo (lecturas, latido, menú), política de
  reintentos y buffer, tabla tecla ↔ concepto de analítica (entregable del
  componente 2) y un sketch de referencia con ArduinoJson 7 (no probado en hardware).

**Commit**: `docs: documentar endpoints, contrato del ESP32 y ejemplos de uso`

---

### [x] 13. Despliegue en Render (configuración)

- `render.yaml` (Blueprint): servicio web Node 22, región `ohio` (la misma de
  AWS que Neon), plan free, build `npm ci --include=dev && npm run build` (sin
  `--include=dev` no se instala TypeScript con `NODE_ENV=production`), start
  `npm start`, health check `/health`, autodeploy desde `main`. `DATABASE_URL`
  con `sync: false`: Render la pide al crear el servicio y no va al repo.
- **Verificado en local**: build y arranque con `NODE_ENV=production`
  (`/health`, `/timescale` y la validación responden igual que en desarrollo).

**Pendiente (lo hace el dueño de la cuenta de Render)**:
1. Render → **New → Blueprint** → repositorio `HeymerDev/api-humedad`.
2. Pegar `DATABASE_URL` cuando lo pida.
3. Abrir `https://<servicio>.onrender.com/health` → `baseDatos: "OK"`.
4. Poner esa URL en `API` del firmware y probar con
   `npm run simular -- --url https://<servicio>.onrender.com --ciclos 3 --intervalo 5`.
   Después borrar los datos simulados con `npm run simular -- --limpiar`.

**Plan free**: el servicio se duerme tras 15 min sin tráfico. Con el ESP32
enviando cada 20 s se mantiene despierto, pero tras una pausa la primera
petición puede tardar ~1 min (el reintento con buffer del firmware lo cubre).
Mientras está dormido no corre la vigilancia de sensores sin datos.

**Commit**: `chore(deploy): agregar configuracion de despliegue en Render`
