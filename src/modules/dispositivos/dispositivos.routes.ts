import { validar } from '../../middlewares/validar';
import { Dispositivo, Sensor } from '../../models';
import { crearCrud } from '../../utils/crear-crud';
import { HttpError } from '../../utils/http-error';
import {
  esquemaActualizarDispositivo,
  esquemaCrearDispositivo,
  esquemaFiltrosDispositivo,
  esquemaRefDispositivo,
} from './dispositivos.schemas';
import { buscarDispositivo, tieneLecturas } from './dispositivos.service';

/**
 * /api/v1/dispositivos  ·  `:id` acepta el id o el código (ej. /dispositivos/esp32_01).
 * Borrar un dispositivo borraría en cascada sus sensores y lecturas, así que
 * si ya tiene lecturas se responde 409 y se sugiere desactivarlo.
 */
export const dispositivosRouter = crearCrud({
  modelo: Dispositivo,
  nombre: 'el dispositivo',
  campoAlterno: 'codigo',
  include: ['ubicacion'],
  esquemaCrear: esquemaCrearDispositivo,
  esquemaActualizar: esquemaActualizarDispositivo,
  esquemaFiltros: esquemaFiltrosDispositivo,
  antesDeEliminar: async (dispositivo) => {
    if (await tieneLecturas({ dispositivoId: dispositivo.get('id') as number })) {
      throw HttpError.conflict('El dispositivo tiene lecturas registradas. Desactívalo con PATCH { "activo": false }');
    }
  },
});

/** GET /api/v1/dispositivos/:ref/sensores  ·  sensores del dispositivo con su tipo. */
dispositivosRouter.get(
  '/:ref/sensores',
  validar({ params: esquemaRefDispositivo }, async ({ params }, _req, res) => {
    const dispositivo = await buscarDispositivo(params.ref);
    const sensores = await Sensor.findAll({
      where: { dispositivo_id: dispositivo.id },
      include: ['tipo_sensor'],
      order: [['id', 'ASC']],
    });
    res.json({ data: sensores });
  }),
);
