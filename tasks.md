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
- Capas: `routes` (rutas + validación zod) → `controller` (HTTP) → `service`
  (lógica y acceso a datos). Las consultas de series temporales van en SQL
  crudo (`sequelize.query` con `replacements`), nunca concatenando strings.
- Respuestas: éxito `{ data, meta? }`; listas con `meta: { total, limit, offset }`;
  error `{ error: { codigo, mensaje, detalles? } }`. Códigos 200/201/204/400/404/409/503.
- Rutas en español, plural y kebab-case: `/api/v1/tipos-sensor`, `/api/v1/reglas-umbral`.
- Toda consulta sobre `lecturas` lleva un filtro de tiempo (`medido_en >= ...`)
  para que TimescaleDB descarte chunks (*chunk exclusion*).
- Commits: Conventional Commits en español (`feat:`, `fix:`, `chore:`, `docs:`,
  `refactor:`, `test:`). Los ejecuta el dueño del repo, no el asistente.

**Limitación de Neon a tener en cuenta**: Neon trae TimescaleDB en edición
Apache 2. Hypertables, chunks, `time_bucket`, `first/last`, `show_chunks`,
`drop_chunks` y `set_chunk_time_interval` funcionan; compresión, *continuous
aggregates* y políticas de retención automáticas normalmente **no**. Se verifica
en la tarea 1 con `SHOW timescaledb.license;`.

---

## Contrato con el ESP32 (borrador, se fija en las tareas 6, 9 y 10)

Ingesta, cada 20 s o al vaciar el buffer tras una caída:

```http
POST /api/v1/lecturas
{
  "dispositivo": "ESP32-01",
  "origen": "TIEMPO_REAL",          // o "BUFFER" al reenviar lo acumulado offline
  "intento": 1,                     // nº de reintento del mismo envío
  "enviado_en": 1790000000,         // epoch en segundos (NTP), opcional
  "lecturas": [
    { "sensor": "temp", "valor": 24.6, "medido_en": 1790000000 },
    { "sensor": "hum",  "valor": 61.3, "medido_en": 1790000000 }
  ]
}
→ 201 { "data": { "lote_id": 123, "aceptadas": 2, "rechazadas": 0, "anomalias": 0, "hora_servidor": 1790000001 } }
```

`medido_en` acepta epoch (s) o ISO-8601; si falta se usa la hora del servidor.
`hora_servidor` le sirve al ESP32 si el NTP falla.

Latido (cada 60 s): `POST /api/v1/dispositivos/ESP32-01/estados-conexion`
con `{ rssi_dbm, ip, uptime_s, heap_libre_bytes, lecturas_en_buffer, reconexiones_wifi, envios_fallidos, version_firmware }`.

Menú: `GET /api/v1/analitica/<opcion>?dispositivo=ESP32-01&lcd=16x2` → JSON
pequeño con `data` + `lcd` (líneas ya recortadas al ancho del display).

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

### [ ] 1. Script SQL completo, hypertables y chunks

**Antes de empezar (decisión tuya)**: ¿los datos actuales de Neon son de prueba
y se pueden borrar, o hay que conservarlos? Define si `schema.sql` recrea las
tablas o las migra con `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

- `database/schema.sql` idempotente (se puede correr varias veces):
  - `CREATE EXTENSION IF NOT EXISTS timescaledb;`
  - Las 12 tablas con PK, FK, `CHECK`, `UNIQUE`, índices y `COMMENT ON`.
  - Columnas nuevas en tablas existentes: `lecturas.lote_id`, `lecturas.valor_crudo`,
    `reglas_umbral.tipo_anomalia`, `anomalias.regla_id`, `anomalias.lectura_id`,
    `alertas.tipo`, `alertas.ultima_ocurrencia_en`.
  - Hypertables: `lecturas` (1 día) y `estados_conexion` (7 días), con
    `create_hypertable(..., if_not_exists => TRUE)` y `set_chunk_time_interval`
    (el chunk actual es de 7 días; el cambio solo afecta a chunks nuevos).
  - Vista `v_lecturas_detalle` (lecturas + sensor + tipo + dispositivo + ubicación)
    para KNIME y FlowiseAI.
- `src/database/ejecutar-sql.ts` + scripts `npm run db:schema`.
- `database/consultas/evidencias.sql`: versión y licencia de TimescaleDB,
  `timescaledb_information.hypertables`, `.dimensions`, `.chunks`,
  `chunks_detailed_size`, filas por chunk.
- `docs/timescaledb.md`: qué es un chunk, cálculo de volumen (tabla del taller),
  tamaño estimado por chunk y justificación de 1 día / 7 días.

**Aceptación**: `npm run db:schema` corre dos veces seguidas sin error; las dos
hypertables aparecen en `timescaledb_information.hypertables`.

**Commit**: `feat(db): agregar esquema SQL con 12 tablas e hypertables de TimescaleDB`

---

### [ ] 2. Datos semilla

**Antes de empezar (decisión tuya)**: confirmar qué sensores asignó el docente
(por defecto: DHT22 temperatura y humedad en un ESP32).

- `database/seed.sql` idempotente (`ON CONFLICT DO NOTHING`):
  `tipos_sensor`, una `ubicaciones`, el `dispositivos` ESP32-01, sus `sensores`,
  `reglas_umbral` por tipo (rango, salto brusco, z-score, valor congelado,
  sin datos) y las 7 `opciones_menu`.
- Script `npm run db:seed`.

**Aceptación**: `npm run db:seed` dos veces no duplica filas.

**Commit**: `feat(db): agregar datos semilla de sensores, reglas y menú`

---

### [ ] 3. Modelos sequelize-typescript

- `src/models/*.model.ts` para las 12 tablas, con asociaciones
  (`@BelongsTo`, `@HasMany`), `tableName`, timestamps mapeados a
  `creado_en`/`actualizado_en` donde existan, PK compuesta en las hypertables.
- `src/models/index.ts` y registro en `database.ts`.
- `src/database/verificar-modelos.ts` (`npm run db:verificar`): compara cada
  modelo con `describeTable` y avisa columnas faltantes o sobrantes.

**Aceptación**: `npm run typecheck` y `npm run db:verificar` sin diferencias.

**Commit**: `feat(models): agregar modelos de las 12 tablas con sus asociaciones`

---

### [ ] 4. Infraestructura común de la API

- Middleware `validar({ body, query, params })` con zod.
- Utilidades: paginación (`limit`/`offset` con máximos), parseo de fechas
  (epoch o ISO), rango "hoy" en `APP_TIMEZONE`, formateo de líneas LCD.
- Fábrica de CRUD para catálogos (list/get/create/update/delete) para no
  repetir código en la tarea 5.

**Commit**: `feat(api): agregar validación, paginación y fábrica de CRUD`

---

### [ ] 5. CRUD de catálogos

- `/api/v1/tipos-sensor`, `/ubicaciones`, `/dispositivos`, `/sensores`,
  `/reglas-umbral` → `GET` (lista con filtros), `GET /:id`, `POST`, `PATCH /:id`, `DELETE /:id`.
- `GET /dispositivos/:id/sensores`.
- `/api/v1/opciones-menu` → `GET` (lista y por tecla) y `PATCH /:id`.

**Aceptación**: probado con `docs/api.http`; 404/409/400 con el formato de error común.

**Commit**: `feat(api): agregar CRUD de catálogos, dispositivos y reglas`

---

### [ ] 6. Ingesta de lecturas desde el ESP32

- `POST /api/v1/lecturas` (contrato de arriba), en una transacción:
  1. Busca el dispositivo por `codigo` y los sensores por `etiqueta`.
  2. Aplica calibración (`valor = crudo * escala + offset`), guarda `valor_crudo`.
  3. Fuera del rango físico del tipo → `calidad = 'INVALIDA'` (se guarda, no se descarta).
  4. Crea el `lotes_envio` (origen, intento, aceptadas/rechazadas, errores, duración).
  5. Inserta las `lecturas` con `bulkCreate` y actualiza `dispositivos.ultima_conexion` e IP.
- `GET /api/v1/lecturas` con filtros `sensor_id`, `dispositivo`, `desde`, `hasta` (rango obligatorio, máx. 31 días) y paginación.
- `GET /api/v1/lotes-envio` con filtros.

**Aceptación**: un lote con un sensor inexistente responde 201 con esa lectura en
`rechazadas` y el detalle en `lotes_envio.errores`.

**Commit**: `feat(lecturas): agregar ingesta por lotes del ESP32 y consulta de lecturas`

---

### [ ] 7. Simulador del ESP32

- `src/database/simular-esp32.ts` (`npm run simular`): envía a la API un lote
  cada 20 s y un latido cada 60 s, con valores realistas y, de vez en cuando,
  un salto o un valor fuera de rango para probar el detector.
- Solo para pruebas: usar una rama de Neon o limpiar después (los datos para
  KNIME y FlowiseAI deben venir de los sensores reales).

**Commit**: `chore: agregar simulador del ESP32 para pruebas locales`

---

### [ ] 8. Detector de anomalías y alertas

- `anomalias.service`: al ingerir cada lote evalúa las reglas activas del
  sensor (las específicas del sensor tienen prioridad sobre las del tipo):
  - `FUERA_DE_RANGO` (UMBRAL: `valor_min`/`valor_max`)
  - `SALTO_BRUSCO` (UMBRAL o MEDIA_MOVIL: `delta_max` contra la lectura anterior o la media de la ventana)
  - `OUTLIER_ESTADISTICO` (ZSCORE: `|z| > factor`; IQR: fuera de `Q1 − k·IQR, Q3 + k·IQR`) con `ventana_minutos` y `minimo_muestras`
  - `VALOR_CONGELADO` (mismo valor durante `ventana_minutos`)
- `alertas.service`: cada anomalía con severidad ≥ MEDIA abre una alerta o, si ya
  hay una ABIERTA/RECONOCIDA del mismo sensor y tipo, suma `ocurrencias`.
- `GET /api/v1/anomalias`, `PATCH /anomalias/:id` (`revisada`).
- `GET /api/v1/alertas`, `GET /alertas/:id`, `PATCH /alertas/:id` (`estado`:
  ABIERTA → RECONOCIDA → RESUELTA, rellena `reconocido_en`/`resuelto_en`).

**Aceptación**: con el simulador aparecen anomalías y alertas agrupadas; la
respuesta de la ingesta informa cuántas anomalías hubo.

**Commit**: `feat(anomalias): detectar anomalías al ingerir y generar alertas`

---

### [ ] 9. Latidos y vigilancia de dispositivos

- `POST /api/v1/dispositivos/:codigo/estados-conexion` (guarda el latido y
  actualiza `ultima_conexion`) y `GET` del historial.
- Tarea periódica dentro de la API (cada 60 s):
  - `SENSOR_SIN_DATOS` si un sensor activo no envía en `ventana_minutos`.
  - Resuelve automáticamente alertas sin ocurrencias recientes.

**Commit**: `feat(dispositivos): registrar latidos y vigilar sensores sin datos`

---

### [ ] 10. Analítica del menú (teclas 1–7)

- `src/modules/analitica`: los 7 endpoints de la tabla del contrato, en SQL
  crudo con `time_bucket`, `avg`, `min/max`, `stddev_samp`, `regr_slope`,
  `percentile_cont`, siempre filtrando por tiempo.
- Cada respuesta incluye `lcd` (líneas para 16x2 o 20x4 según `?lcd=`).
- Si llega `?dispositivo=`, se registra la consulta en `consultas_menu`
  (opción, duración, éxito o error). `GET /api/v1/consultas-menu`.

**Aceptación**: las 7 opciones responden en < 500 ms con datos del simulador y
dejan su registro en `consultas_menu`.

**Commit**: `feat(analitica): agregar endpoints del menú del teclado con salida para LCD`

---

### [ ] 11. Endpoints de evidencia TimescaleDB

- `GET /api/v1/timescale/hypertables`, `/chunks` (de `timescaledb_information.chunks`)
  y `/tamanos` (`chunks_detailed_size`, filas por chunk) para la sustentación en vivo.

**Commit**: `feat(timescale): exponer hypertables y chunks para la sustentación`

---

### [ ] 12. Documentación

- `README.md` completo: instalación, variables, scripts, endpoints.
- `docs/api.http` (REST Client de VS Code) con todas las peticiones de ejemplo.
- `docs/esp32.md`: contrato definitivo, manejo de reintentos/buffer y ejemplo con ArduinoJson.

**Commit**: `docs: documentar endpoints, contrato del ESP32 y ejemplos de uso`

---

### [ ] 13. Despliegue en Render

- `render.yaml` (build `npm ci && npm run build`, start `npm start`, health check `/health`).
- Variables de entorno en Render (solo `DATABASE_URL` obligatoria).
- Prueba del ESP32 contra la URL pública.

**Commit**: `chore(deploy): agregar configuración de despliegue en Render`
