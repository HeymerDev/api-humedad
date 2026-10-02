# api-humedad

API REST de la estación IoT del **Proyecto Integrador** (Sistema IoT con Series
Temporales, Analítica de Datos y Agente de IA).

Un ESP32 con DHT22 y DS18B20 envía lecturas cada 20 s a **PostgreSQL +
TimescaleDB en Neon**. La API además:

- detecta anomalías y abre alertas;
- vigila que los sensores no dejen de enviar;
- calcula la analítica de las 7 opciones del menú del teclado matricial y la
  devuelve lista para el LCD.

KNIME y FlowiseAI leen los mismos datos directamente de la base.

```
Sensores → ESP32 → API (Render) → PostgreSQL + TimescaleDB (Neon) → KNIME / FlowiseAI
              ↑                         │
              └── menú del teclado ─────┘  (analítica + páginas para el LCD)
```

**Stack**: Node.js 22 · Express 5 · TypeScript · sequelize-typescript · zod ·
PostgreSQL 18 · TimescaleDB 2.24 (Apache).

## Puesta en marcha

```bash
npm install
```

Copia `.env.example` como `.env` y pega la cadena de conexión de Neon en
`DATABASE_URL`. Después prepara la base de datos. Los dos scripts son
idempotentes y conservan los datos:

```bash
npm run db:schema
```

```bash
npm run db:seed
```

Arranca la API:

```bash
npm run dev
```

`http://localhost:3000/health` debe responder `baseDatos: "OK"`.

## Variables de entorno

Solo `DATABASE_URL` es obligatoria.

| Variable | Por defecto | Uso |
|----------|-------------|-----|
| `DATABASE_URL` | — | Cadena de conexión de Neon |
| `PORT` | 3000 | Puerto HTTP |
| `NODE_ENV` | development | En `production` los errores 500 no muestran detalles |
| `CORS_ORIGIN` | `*` | Orígenes permitidos, separados por coma |
| `DB_SSL` / `DB_POOL_MAX` / `DB_LOGGING` | true / 5 / false | Conexión a la BD |
| `APP_TIMEZONE` | America/Bogota | Define "hoy" (tecla 3) y las horas locales |
| `LECTURA_INTERVALO_SEG` | 20 | Cadencia esperada del ESP32 |
| `DISPOSITIVO_OFFLINE_SEG` | 90 | Sin datos por más tiempo → OFFLINE (tecla 7) |
| `ALERTA_SEVERIDAD_MINIMA` | MEDIA | Severidad mínima de una anomalía para abrir alerta |
| `ALERTA_AUTO_RESOLVER_MIN` | 120 | Minutos sin repeticiones para resolver sola una alerta |
| `VIGILANCIA_INTERVALO_SEG` | 60 | Frecuencia de la vigilancia (0 = apagada) |

## Scripts

| Script | Qué hace |
|--------|----------|
| `npm run dev` | Servidor con recarga automática (tsx) |
| `npm run build` / `npm start` | Compila a `dist/` y ejecuta la versión compilada |
| `npm run typecheck` | Verifica tipos sin compilar |
| `npm run db:schema` | Aplica `database/schema.sql`: 12 tablas, 2 hypertables, vista |
| `npm run db:seed` | Aplica `database/seed.sql`: sensores, reglas, menú del teclado |
| `npm run db:evidencias` | Muestra hypertables, chunks, tamaños y chunk exclusion |
| `npm run db:verificar` | Comprueba que los 12 modelos coinciden con la BD |
| `npm run simular` | Simula un ESP32 (`esp32_sim`): lotes, latidos, cortes y anomalías |

Para validar un script SQL sin dejar cambios:
`npx tsx src/database/ejecutar-sql.ts <archivo.sql> --probar` (hace ROLLBACK).

### Simulador

Con la API corriendo en otra terminal:

```bash
npm run simular -- --intervalo 2 --latido 10 --prob-anomalia 0.3
```

```bash
npm run simular -- --historico 120 --ciclos 1
```

```bash
npm run simular -- --limpiar
```

El primer comando es el modo rápido. El segundo rellena 2 h de histórico
(cada 20 s) y envía un ciclo. El tercero borra `esp32_sim` con todos sus
datos. Otras opciones: `--congelar <sensor>`, `--prob-corte`, `--url`.

El simulador nunca escribe sobre la estación real `esp32_01`, que alimenta
KNIME y FlowiseAI.

## Endpoints (`/api/v1`)

Ejemplos listos para ejecutar en [`docs/api.http`](docs/api.http) (extensión
REST Client de VS Code).

| Recurso | Operaciones |
|---------|-------------|
| `/lecturas` | `POST` lote del ESP32 · `GET` con filtros (últimas 24 h por defecto, máx. 31 días) |
| `/lotes-envio` | `GET` lista y `GET /:id` con sus lecturas |
| `/dispositivos` | CRUD (`/:id` acepta el código) · `GET /:ref/sensores` |
| `/dispositivos/:ref/estados-conexion` | `POST` latido del ESP32 · `GET` historial |
| `/sensores`, `/ubicaciones`, `/reglas-umbral` | CRUD |
| `/tipos-sensor` | CRUD (`/:id` acepta el código) |
| `/opciones-menu` | `GET`, `GET /:id`, `PATCH /:id` |
| `/analitica/*` | Las 7 opciones del menú con salida para el LCD (ver abajo) |
| `/consultas-menu` | `GET` registro de consultas del teclado · `GET /resumen` |
| `/anomalias` | `GET` lista y detalle · `PATCH /:id` (revisada) |
| `/alertas` | `GET` lista (`?activas=true`) y detalle · `PATCH /:id` (reconocer / resolver) |
| `/vigilancia/ejecuciones` | `POST` corre la vigilancia en el momento |
| `/timescale` | `GET` versión e hypertables · `/chunks` · `/plan` (chunk exclusion) · `/volumen` |

`GET /health` (sin prefijo) informa el estado de la API y la latencia a la BD.

**Formato**: éxito `{ data, meta? }`; listas con `meta: { total, limit, offset }`;
errores `{ error: { codigo, mensaje, detalles? } }` con 400 (validación, con el
campo exacto), 404, 409 (duplicado o en uso) o 500.

### Menú del teclado

| Tecla | Endpoint | Concepto de analítica |
|-------|----------|-----------------------|
| 1 | `/analitica/valores-actuales` | Dato en tiempo real |
| 2 | `/analitica/promedio-hora` | Media en ventana móvil de 1 h (`time_bucket`) |
| 3 | `/analitica/extremos-dia` | Máximo, mínimo y rango del día |
| 4 | `/analitica/tendencia` | Desviación estándar y pendiente por regresión lineal |
| 5 | `/analitica/outliers` | Z-score e IQR |
| 6 | `/analitica/alertas-activas` | Conteo por severidad |
| 7 | `/analitica/estado-conexion` | Latencia, último dato, ONLINE/OFFLINE |

Todas reciben `?dispositivo=esp32_01` y responden `{ data, lcd: { columnas,
filas, paginas } }`, con `lcd=16x2|20x4` y `solo_lcd=true` para el ESP32.
Contrato completo y sketch de referencia en [`docs/esp32.md`](docs/esp32.md).

## Base de datos

12 tablas relacionadas y 2 hypertables:

- `lecturas`, con chunk de 1 día;
- `estados_conexion`, con chunk de 7 días.

Todas las tablas guardan datos durante el uso normal. Más detalle en:

- [`DIAGRAMA_ER.md`](DIAGRAMA_ER.md): diagrama entidad-relación y uso de cada tabla.
- [`database/schema.sql`](database/schema.sql): script SQL completo.
- [`docs/timescaledb.md`](docs/timescaledb.md): qué es un chunk, cálculo de volumen y justificación del intervalo.
- [`database/consultas/evidencias.sql`](database/consultas/evidencias.sql): consultas para mostrar la extensión, las hypertables y los chunks.

## Estructura

```
database/            schema.sql, seed.sql, consultas/evidencias.sql
docs/                api.http, esp32.md, timescaledb.md
src/
  config/            env.ts (zod), database.ts (Sequelize + Neon)
  database/          ejecutar-sql, verificar-modelos, simular-esp32
  models/            12 modelos sequelize-typescript + enums
  modules/<recurso>/ routes, schemas y service de cada recurso
  middlewares/       validar, errores, 404
  utils/             crear-crud, paginación, fechas, LCD, tiempo
  routes/index.ts    monta /api/v1
```

El avance por tareas, las decisiones y las convenciones están en [`tasks.md`](tasks.md).
