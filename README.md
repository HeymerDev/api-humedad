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
conexión de Neon en `DATABASE_URL`. Luego:

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

## Documentación

- [`DIAGRAMA_ER.md`](DIAGRAMA_ER.md): modelo entidad-relación (12 tablas, 2 hypertables).
- [`tasks.md`](tasks.md): plan de implementación, convenciones y contrato con el ESP32.
