import { Router } from 'express';
import { Op, type WhereOptions } from 'sequelize';
import { z } from 'zod';
import { esquemaId, validar } from '../../middlewares/validar';
import { Anomalia, SEVERIDADES, TIPOS_ANOMALIA } from '../../models';
import { filtroBooleano, filtroId, filtroTexto } from '../../utils/esquemas';
import { esquemaFecha } from '../../utils/fechas';
import { HttpError } from '../../utils/http-error';
import { esquemaPaginacion, respuestaPaginada } from '../../utils/paginacion';
import { buscarDispositivo } from '../dispositivos/dispositivos.service';

const esquemaFiltros = esquemaPaginacion.extend({
  dispositivo: filtroTexto(),
  sensor_id: filtroId(),
  tipo: z.enum(TIPOS_ANOMALIA).optional(),
  severidad: z.enum(SEVERIDADES).optional(),
  revisada: filtroBooleano(),
  desde: esquemaFecha.optional(),
  hasta: esquemaFecha.optional(),
});

const esquemaRevision = z.object({ revisada: z.boolean() }).strict();

/** /api/v1/anomalias  ·  las crea el detector; aquí se consultan y se marcan como revisadas. */
export const anomaliasRouter = Router();

/** GET /api/v1/anomalias?dispositivo=esp32_01&tipo=SALTO_BRUSCO&revisada=false */
anomaliasRouter.get(
  '/',
  validar({ query: esquemaFiltros }, async ({ query }, _req, res) => {
    const where: Record<string | symbol, unknown> = {};
    for (const campo of ['sensor_id', 'tipo', 'severidad', 'revisada'] as const) {
      if (query[campo] !== undefined) where[campo] = query[campo];
    }
    if (query.desde || query.hasta) {
      where.detectado_en = { ...(query.desde && { [Op.gte]: query.desde }), ...(query.hasta && { [Op.lt]: query.hasta }) };
    }
    const dispositivo = query.dispositivo ? await buscarDispositivo(query.dispositivo) : null;

    const { rows, count } = await Anomalia.findAndCountAll({
      where: where as WhereOptions,
      include: [
        {
          association: 'sensor',
          attributes: ['id', 'etiqueta', 'dispositivo_id'],
          where: dispositivo ? { dispositivo_id: dispositivo.id } : undefined,
        },
        { association: 'regla', attributes: ['id', 'nombre'] },
      ],
      order: [['detectado_en', 'DESC']],
      limit: query.limit,
      offset: query.offset,
    });
    res.json(respuestaPaginada(rows, count, query));
  }),
);

/** GET /api/v1/anomalias/:id  ·  con su sensor, la regla y las alertas que abrió. */
anomaliasRouter.get(
  '/:id',
  validar({ params: esquemaId }, async ({ params }, _req, res) => {
    const anomalia = await Anomalia.findByPk(params.id, { include: ['sensor', 'regla', 'alertas'] });
    if (!anomalia) throw HttpError.notFound(`No existe la anomalía ${params.id}`);
    res.json({ data: anomalia });
  }),
);

/** PATCH /api/v1/anomalias/:id  { "revisada": true } */
anomaliasRouter.patch(
  '/:id',
  validar({ params: esquemaId, body: esquemaRevision }, async ({ params, body }, _req, res) => {
    const anomalia = await Anomalia.findByPk(params.id);
    if (!anomalia) throw HttpError.notFound(`No existe la anomalía ${params.id}`);
    await anomalia.update({ revisada: body.revisada });
    res.json({ data: anomalia });
  }),
);
