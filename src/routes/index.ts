import { Router } from 'express';

/**
 * Router de la API v1. Cada módulo (src/modules/<recurso>) exporta su router
 * y se monta aquí a medida que se implementan las tareas de tasks.md.
 */
export const apiRouter = Router();

apiRouter.get('/', (_req, res) => {
  res.json({ data: { nombre: 'api-humedad', version: 'v1', recursos: [] } });
});
