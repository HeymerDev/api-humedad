import { ReglaUmbral } from '../../models';
import { crearCrud } from '../../utils/crear-crud';
import {
  esquemaActualizarReglaUmbral,
  esquemaCrearReglaUmbral,
  esquemaFiltrosReglaUmbral,
} from './reglas-umbral.schemas';

/**
 * /api/v1/reglas-umbral  ·  reglas del detector de anomalías.
 * Para dejar de aplicar una regla sin perder el historial: PATCH { "activa": false }.
 */
export const reglasUmbralRouter = crearCrud({
  modelo: ReglaUmbral,
  nombre: 'la regla',
  include: [
    { association: 'sensor', attributes: ['id', 'etiqueta', 'nombre'] },
    { association: 'tipo_sensor', attributes: ['id', 'codigo', 'nombre'] },
  ],
  esquemaCrear: esquemaCrearReglaUmbral,
  esquemaActualizar: esquemaActualizarReglaUmbral,
  esquemaFiltros: esquemaFiltrosReglaUmbral,
});
