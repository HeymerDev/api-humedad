# api-humedad

API REST para la estación IoT del Proyecto Integrador: un ESP32 envía lecturas
cada 20 s a **PostgreSQL + TimescaleDB (Neon)** y consulta analítica desde un
teclado matricial.

Stack: Node.js 22 · Express 5 · TypeScript · sequelize-typescript · zod.

## Puesta en marcha

```bash
npm install
```

Copia `.env.example` como `.env` (ya existe uno local) y pega la cadena de
conexión de Neon en `DATABASE_URL`.

Prepara la base de datos. Los dos scripts son idempotentes y conservan los
datos existentes:

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

Comprueba la conexión en `http://localhost:3000/health`
(`baseDatos: "OK"` y la latencia en ms).

## Scripts

| Script | Qué hace |
|--------|----------|
| `npm run dev` | Servidor con recarga automática (tsx) |
| `npm run build` | Compila a `dist/` |
| `npm start` | Ejecuta la versión compilada |
| `npm run typecheck` | Verifica tipos sin compilar |
| `npm run db:schema` | Aplica `database/schema.sql`: 12 tablas, 2 hypertables, vista |
| `npm run db:seed` | Aplica `database/seed.sql`: sensores, reglas, menú del teclado |
| `npm run db:evidencias` | Muestra hypertables, chunks, tamaños y chunk exclusion |
| `npm run db:verificar` | Comprueba que los 12 modelos coinciden con la BD |

Para validar un script SQL sin dejar cambios:
`npx tsx src/database/ejecutar-sql.ts <archivo.sql> --probar` (hace ROLLBACK).

## Endpoints (`/api/v1`)

| Recurso | Operaciones |
|---------|-------------|
| `/lecturas` | `POST` lote del ESP32 · `GET` con filtros (últimas 24 h por defecto) |
| `/lotes-envio` | `GET` lista y `GET /:id` con sus lecturas |
| `/dispositivos` | CRUD (`/:id` acepta el código) · `GET /:ref/sensores` |
| `/sensores`, `/ubicaciones`, `/reglas-umbral` | CRUD |
| `/tipos-sensor` | CRUD (`/:id` acepta el código) |
| `/opciones-menu` | `GET`, `GET /:id`, `PATCH /:id` |

Ejemplos listos para ejecutar en [`docs/api.http`](docs/api.http) (extensión REST Client de VS Code).

## Documentación

- [`DIAGRAMA_ER.md`](DIAGRAMA_ER.md): modelo entidad-relación (12 tablas, 2 hypertables).
- [`docs/timescaledb.md`](docs/timescaledb.md): chunks, cálculo de volumen y justificación del intervalo.
- [`tasks.md`](tasks.md): plan de implementación, convenciones y contrato con el ESP32.
