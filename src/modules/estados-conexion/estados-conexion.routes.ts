import { Router } from 'express';
import { Op } from 'sequelize';
import { z } from 'zod';
import { validar } from '../../middlewares/validar';
import { EstadoConexion } from '../../models';
import { aEpoch, esquemaFecha } from '../../utils/fechas';
import { HttpError } from '../../utils/http-error';
import { esquemaPaginacion, respuestaPaginada } from '../../utils/paginacion';
import { buscarDispositivo } from '../dispositivos/dispositivos.service';

const contador = () => z.number().int().min(0).optional();

/** Latido del ESP32 (cada 60 s). Todos los campos son opcionales. */
const esquemaLatido = z.object({
  ntp_sincronizado: z.boolean().optional(),
  rssi_dbm: z.number().int().min(-127).max(0).optional(),
  /** IP local del ESP32 (la que ve en su red Wi-Fi). */
  ip: z.union([z.ipv4(), z.ipv6()]).optional(),
  uptime_s: contador(),
  heap_libre_bytes: contador(),
  lecturas_en_buffer: contador(),
  reconexiones_wifi: contador(),
  envios_fallidos: contador(),
  version_firmware: z.string().trim().min(1).max(30).optional(),
});

const esquemaRef = z.object({ ref: z.string().trim().min(1) });

const esquemaHistorial = esquemaPaginacion.extend({
  desde: esquemaFecha.optional(),
  hasta: esquemaFecha.optional(),
});

/** /api/v1/dispositivos/:ref/estados-conexion  (`:ref` = id o código). */
export const estadosConexionRouter = Router({ mergeParams: true });

/**
 * POST  ·  guarda el latido en la hypertable estados_conexion y actualiza en
 * el dispositivo `ultima_conexion`, `direccion_ip` y `version_firmware`.
 */
estadosConexionRouter.post(
  '/',
  validar({ params: esquemaRef, body: esquemaLatido }, async ({ params, body }, _req, res) => {
    const dispositivo = await buscarDispositivo(params.ref);
    if (!dispositivo.activo) throw HttpError.conflict(`El dispositivo ${dispositivo.codigo} está desactivado`);

    const { ip, ...resto } = body;
    const ahora = new Date();
    const estado = await EstadoConexion.create({
      ...resto,
      direccion_ip: ip ?? null,
      dispositivo_id: dispositivo.id,
      registrado_en: ahora,
    });
    await dispositivo.update({
      ultima_conexion: ahora,
      ...(ip && { direccion_ip: ip }),
      ...(body.version_firmware && { version_firmware: body.version_firmware }),
    });

    res.status(201).json({ data: { id: estado.id, registrado_en: estado.registrado_en, hora_servidor: aEpoch(ahora) } });
  }),
);

/** GET  ·  historial de latidos (por defecto últimas 24 h, más reciente primero). */
estadosConexionRouter.get(
  '/',
  validar({ params: esquemaRef, query: esquemaHistorial }, async ({ params, query }, _req, res) => {
    const dispositivo = await buscarDispositivo(params.ref);
    const hasta = query.hasta ?? new Date();
    const desde = query.desde ?? new Date(hasta.getTime() - 24 * 3600 * 1000);
    if (desde >= hasta) throw HttpError.badRequest('desde debe ser anterior a hasta');

    const { rows, count } = await EstadoConexion.findAndCountAll({
      where: { dispositivo_id: dispositivo.id, registrado_en: { [Op.gte]: desde, [Op.lt]: hasta } },
      order: [['registrado_en', 'DESC']],
      limit: query.limit,
      offset: query.offset,
    });
    res.json(respuestaPaginada(rows, count, query));
  }),
);
