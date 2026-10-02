import { Router } from 'express';
import { Op, QueryTypes, type WhereOptions } from 'sequelize';
import { z } from 'zod';
import { sequelize } from '../../config/database';
import { validar } from '../../middlewares/validar';
import { ConsultaMenu } from '../../models';
import { filtroBooleano, filtroTexto } from '../../utils/esquemas';
import { esquemaFecha } from '../../utils/fechas';
import { esquemaPaginacion, respuestaPaginada } from '../../utils/paginacion';
import { buscarDispositivo } from '../dispositivos/dispositivos.service';

const esquemaFiltros = esquemaPaginacion.extend({
  dispositivo: filtroTexto(),
  tecla: z.string().regex(/^[0-9A-D]$/).optional(),
  exitosa: filtroBooleano(),
  desde: esquemaFecha.optional(),
  hasta: esquemaFecha.optional(),
});

/** /api/v1/consultas-menu  ·  registro de cada consulta hecha desde el teclado. */
export const consultasMenuRouter = Router();

/** GET /api/v1/consultas-menu?dispositivo=esp32_01&tecla=2&exitosa=false */
consultasMenuRouter.get(
  '/',
  validar({ query: esquemaFiltros }, async ({ query }, _req, res) => {
    const where: Record<string | symbol, unknown> = {};
    if (query.dispositivo) where.dispositivo_id = (await buscarDispositivo(query.dispositivo)).id;
    if (query.exitosa !== undefined) where.exitosa = query.exitosa;
    if (query.desde || query.hasta) {
      where.consultado_en = { ...(query.desde && { [Op.gte]: query.desde }), ...(query.hasta && { [Op.lt]: query.hasta }) };
    }

    const { rows, count } = await ConsultaMenu.findAndCountAll({
      where: where as WhereOptions,
      include: [
        {
          association: 'opcion_menu',
          attributes: ['id', 'tecla', 'titulo'],
          where: query.tecla ? { tecla: query.tecla } : undefined,
        },
        { association: 'dispositivo', attributes: ['id', 'codigo'] },
      ],
      order: [['consultado_en', 'DESC']],
      limit: query.limit,
      offset: query.offset,
    });
    res.json(respuestaPaginada(rows, count, query));
  }),
);

/** GET /api/v1/consultas-menu/resumen  ·  uso de cada tecla: veces, fallos y duración media. */
consultasMenuRouter.get('/resumen', async (_req, res) => {
  const filas = await sequelize.query(
    `SELECT o.tecla, o.titulo, o.concepto_analitica,
            count(c.id)::int AS consultas,
            count(c.id) FILTER (WHERE NOT c.exitosa)::int AS fallidas,
            round(avg(c.duracion_ms))::int AS duracion_media_ms,
            max(c.consultado_en) AS ultima_consulta
     FROM opciones_menu o
     LEFT JOIN consultas_menu c ON c.opcion_menu_id = o.id
     GROUP BY o.id
     ORDER BY o.tecla`,
    { type: QueryTypes.SELECT },
  );
  res.json({ data: filas });
});
