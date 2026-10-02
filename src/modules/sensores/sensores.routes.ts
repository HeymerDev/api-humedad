import { Sensor } from '../../models';
import { crearCrud } from '../../utils/crear-crud';
import { HttpError } from '../../utils/http-error';
import { tieneLecturas } from '../dispositivos/dispositivos.service';
import { esquemaActualizarSensor, esquemaCrearSensor, esquemaFiltrosSensor } from './sensores.schemas';

/**
 * /api/v1/sensores  ·  borrar un sensor con lecturas responde 409 (la FK
 * borraría en cascada su serie temporal): se desactiva con { "activo": false }.
 */
export const sensoresRouter = crearCrud({
  modelo: Sensor,
  nombre: 'el sensor',
  include: ['tipo_sensor', { association: 'dispositivo', attributes: ['id', 'codigo', 'nombre'] }],
  esquemaCrear: esquemaCrearSensor,
  esquemaActualizar: esquemaActualizarSensor,
  esquemaFiltros: esquemaFiltrosSensor,
  antesDeEliminar: async (sensor) => {
    if (await tieneLecturas({ sensorId: sensor.get('id') as number })) {
      throw HttpError.conflict('El sensor tiene lecturas registradas. Desactívalo con PATCH { "activo": false }');
    }
  },
});
