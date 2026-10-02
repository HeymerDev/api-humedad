import { Router } from 'express';
import { Op, type WhereOptions } from 'sequelize';
import { z } from 'zod';
import { esquemaId, validar } from '../../middlewares/validar';
import { Lectura, LoteEnvio, ORIGENES_LOTE } from '../../models';
import { filtroBooleano, filtroTexto } from '../../utils/esquemas';
import { esquemaFecha } from '../../utils/fechas';
import { HttpError } from '../../utils/http-error';
import { esquemaPaginacion, respuestaPaginada } from '../../utils/paginacion';
import { buscarDispositivo } from '../dispositivos/dispositivos.service';

const esquemaFiltrosLotes = esquemaPaginacion.extend({
  dispositivo: filtroTexto(),
  origen: z.enum(ORIGENES_LOTE).optional(),
  con_rechazos: filtroBooleano(),
  desde: esquemaFecha.optional(),
  hasta: esquemaFecha.optional(),
});

/** /api/v1/lotes-envio  ·  auditoría de cada envío del ESP32 (solo lectura). */
export const lotesEnvioRouter = Router();

/** GET /api/v1/lotes-envio?dispositivo=esp32_01&origen=BUFFER&con_rechazos=true */
lotesEnvioRouter.get(
  '/',
  validar({ query: esquemaFiltrosLotes }, async ({ query }, _req, res) => {
    const where: Record<string | symbol, unknown> = {};
    if (query.dispositivo) where.dispositivo_id = (await buscarDispositivo(query.dispositivo)).id;
    if (query.origen) where.origen = query.origen;
    if (query.con_rechazos !== undefined) {
      where.lecturas_rechazadas = query.con_rechazos ? { [Op.gt]: 0 } : 0;
    }
    if (query.desde || query.hasta) {
      where.recibido_en = {
        ...(query.desde && { [Op.gte]: query.desde }),
        ...(query.hasta && { [Op.lt]: query.hasta }),
      };
    }

    const { rows, count } = await LoteEnvio.findAndCountAll({
      where: where as WhereOptions,
      include: [{ association: 'dispositivo', attributes: ['id', 'codigo'] }],
      order: [['recibido_en', 'DESC']],
      limit: query.limit,
      offset: query.offset,
    });
    res.json(respuestaPaginada(rows, count, query));
  }),
);

/** GET /api/v1/lotes-envio/:id  ·  el lote con sus lecturas guardadas. */
lotesEnvioRouter.get(
  '/:id',
  validar({ params: esquemaId }, async ({ params }, _req, res) => {
    const lote = await LoteEnvio.findByPk(params.id, {
      include: [{ association: 'dispositivo', attributes: ['id', 'codigo'] }],
    });
    if (!lote) throw HttpError.notFound(`No existe el lote ${params.id}`);
    const lecturas = await Lectura.findAll({
      where: { lote_id: lote.id },
      include: [{ association: 'sensor', attributes: ['id', 'etiqueta'] }],
      order: [['medido_en', 'ASC'], ['sensor_id', 'ASC']],
    });
    res.json({ data: { ...lote.toJSON(), lecturas } });
  }),
);
