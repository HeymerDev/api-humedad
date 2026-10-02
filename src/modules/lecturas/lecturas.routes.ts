import { Router } from 'express';
import { validar } from '../../middlewares/validar';
import { esquemaFiltrosLecturas, esquemaLote } from './lecturas.schemas';
import { ingerirLote, listarLecturas } from './lecturas.service';

export const lecturasRouter = Router();

/**
 * POST /api/v1/lecturas  ·  lote del ESP32 (cada 20 s o al vaciar su buffer).
 * Responde 201 aunque algunas lecturas se rechacen: el detalle va en
 * `errores` y queda guardado en lotes_envio. Reintentar no duplica datos.
 */
lecturasRouter.post(
  '/',
  validar({ body: esquemaLote }, async ({ body }, _req, res) => {
    res.status(201).json({ data: await ingerirLote(body) });
  }),
);

/** GET /api/v1/lecturas?dispositivo=esp32_01&sensor_id=1&desde=...&hasta=...&calidad=OK */
lecturasRouter.get(
  '/',
  validar({ query: esquemaFiltrosLecturas }, async ({ query }, _req, res) => {
    const { rows, count, rango } = await listarLecturas(query);
    res.json({ data: rows, meta: { total: count, limit: query.limit, offset: query.offset, ...rango } });
  }),
);
