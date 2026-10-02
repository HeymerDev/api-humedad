import { Ubicacion } from '../../models';
import { crearCrud } from '../../utils/crear-crud';
import { esquemaActualizarUbicacion, esquemaCrearUbicacion, esquemaFiltrosUbicacion } from './ubicaciones.schemas';

/** /api/v1/ubicaciones  ·  al borrar una, sus dispositivos quedan sin ubicación (SET NULL). */
export const ubicacionesRouter = crearCrud({
  modelo: Ubicacion,
  nombre: 'la ubicación',
  esquemaCrear: esquemaCrearUbicacion,
  esquemaActualizar: esquemaActualizarUbicacion,
  esquemaFiltros: esquemaFiltrosUbicacion,
});
