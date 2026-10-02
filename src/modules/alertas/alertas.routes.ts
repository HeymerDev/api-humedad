import { Router } from 'express';
import { Op, type WhereOptions } from 'sequelize';
import { z } from 'zod';
import { esquemaId, validar } from '../../middlewares/validar';
import { Alerta, ESTADOS_ALERTA, SEVERIDADES, TIPOS_ANOMALIA } from '../../models';
import { filtroBooleano, filtroId, filtroTexto } from '../../utils/esquemas';
import { HttpError } from '../../utils/http-error';
import { esquemaPaginacion, respuestaPaginada } from '../../utils/paginacion';
import { buscarDispositivo } from '../dispositivos/dispositivos.service';
import { cambiarEstado } from './alertas.service';

const esquemaFiltros = esquemaPaginacion.extend({
  estado: z.enum(ESTADOS_ALERTA).optional(),
  /** true = ABIERTA o RECONOCIDA (lo que cuenta la tecla 6 del menú). */
  activas: filtroBooleano(),
  dispositivo: filtroTexto(),
  sensor_id: filtroId(),
  tipo: z.enum(TIPOS_ANOMALIA).optional(),
  severidad: z.enum(SEVERIDADES).optional(),
});

const esquemaCambioEstado = z.object({ estado: z.enum(['RECONOCIDA', 'RESUELTA']) }).strict();

/** /api/v1/alertas  ·  se abren solas desde las anomalías; aquí se gestionan. */
export const alertasRouter = Router();

/** GET /api/v1/alertas?activas=true&dispositivo=esp32_01 */
alertasRouter.get(
  '/',
  validar({ query: esquemaFiltros }, async ({ query }, _req, res) => {
    if (query.estado && query.activas !== undefined) {
      throw HttpError.badRequest('Usa estado o activas, no ambos');
    }
    const where: Record<string | symbol, unknown> = {};
    for (const campo of ['estado', 'sensor_id', 'tipo', 'severidad'] as const) {
      if (query[campo] !== undefined) where[campo] = query[campo];
    }
    if (query.activas !== undefined) where.estado = query.activas ? { [Op.ne]: 'RESUELTA' } : 'RESUELTA';
    const dispositivo = query.dispositivo ? await buscarDispositivo(query.dispositivo) : null;

    const { rows, count } = await Alerta.findAndCountAll({
      where: where as WhereOptions,
      include: [
        {
          association: 'sensor',
          attributes: ['id', 'etiqueta', 'dispositivo_id'],
          where: dispositivo ? { dispositivo_id: dispositivo.id } : undefined,
        },
      ],
      order: [['ultima_ocurrencia_en', 'DESC']],
      limit: query.limit,
      offset: query.offset,
    });
    res.json(respuestaPaginada(rows, count, query));
  }),
);

/** GET /api/v1/alertas/:id  ·  con su sensor y la anomalía que la abrió. */
alertasRouter.get(
  '/:id',
  validar({ params: esquemaId }, async ({ params }, _req, res) => {
    const alerta = await Alerta.findByPk(params.id, { include: ['sensor', 'anomalia'] });
    if (!alerta) throw HttpError.notFound(`No existe la alerta ${params.id}`);
    res.json({ data: alerta });
  }),
);

/**
 * PATCH /api/v1/alertas/:id  { "estado": "RECONOCIDA" | "RESUELTA" }
 * ABIERTA → RECONOCIDA → RESUELTA. Una RESUELTA no se reabre (409): si el
 * problema vuelve, el detector abre una alerta nueva.
 */
alertasRouter.patch(
  '/:id',
  validar({ params: esquemaId, body: esquemaCambioEstado }, async ({ params, body }, _req, res) => {
    res.json({ data: await cambiarEstado(params.id, body.estado) });
  }),
);
