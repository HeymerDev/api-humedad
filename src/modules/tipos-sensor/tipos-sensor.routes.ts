import { TipoSensor } from '../../models';
import { crearCrud } from '../../utils/crear-crud';
import {
  esquemaActualizarTipoSensor,
  esquemaCrearTipoSensor,
  esquemaFiltrosTipoSensor,
} from './tipos-sensor.schemas';

/**
 * /api/v1/tipos-sensor  ·  /api/v1/tipos-sensor/DHT22_TEMP también funciona.
 * Borrar un tipo con sensores responde 409 (FK RESTRICT en la BD).
 */
export const tiposSensorRouter = crearCrud({
  modelo: TipoSensor,
  nombre: 'el tipo de sensor',
  campoAlterno: 'codigo',
  esquemaCrear: esquemaCrearTipoSensor,
  esquemaActualizar: esquemaActualizarTipoSensor,
  esquemaFiltros: esquemaFiltrosTipoSensor,
});
