import { Router } from 'express';
import { ejecutarVigilancia } from './vigilancia.service';

/** /api/v1/vigilancia */
export const vigilanciaRouter = Router();

/**
 * POST /api/v1/vigilancia/ejecuciones  ·  corre una pasada ya, sin esperar al
 * temporizador (útil para probar o para la sustentación).
 */
vigilanciaRouter.post('/ejecuciones', async (_req, res) => {
  res.status(201).json({ data: await ejecutarVigilancia() });
});
