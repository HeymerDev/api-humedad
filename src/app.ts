import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { pingBaseDatos } from './config/database';
import { env } from './config/env';
import { errorHandler } from './middlewares/error-handler';
import { notFound } from './middlewares/not-found';
import { apiRouter } from './routes';

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN === '*' ? '*' : env.CORS_ORIGIN.split(',').map((o) => o.trim()) }));
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
// El ESP32 puede enviar lotes grandes de lecturas acumuladas sin conexión
app.use(express.json({ limit: '1mb' }));

/** Health check (Render y diagnóstico rápido): estado de la API y de la BD. */
app.get('/health', async (_req, res) => {
  try {
    const latenciaMs = await pingBaseDatos();
    res.json({ data: { api: 'OK', baseDatos: 'OK', latenciaMs, hora: new Date().toISOString() } });
  } catch (error) {
    res.status(503).json({
      data: { api: 'OK', baseDatos: 'SIN_CONEXION', error: (error as Error).message, hora: new Date().toISOString() },
    });
  }
});

app.use('/api/v1', apiRouter);

app.use(notFound);
app.use(errorHandler);
