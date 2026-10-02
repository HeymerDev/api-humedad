import { OpcionMenu } from '../../models';
import { crearCrud } from '../../utils/crear-crud';
import { esquemaActualizarOpcionMenu, esquemaFiltrosOpcionMenu } from './opciones-menu.schemas';

/**
 * /api/v1/opciones-menu  ·  menú del teclado (lo carga la semilla).
 * Solo lectura y edición: GET /, GET /?tecla=3, GET /:id, PATCH /:id.
 * Es la tabla "opción del menú ↔ concepto de analítica" del taller.
 */
export const opcionesMenuRouter = crearCrud({
  modelo: OpcionMenu,
  nombre: 'la opción de menú',
  operaciones: ['listar', 'obtener', 'actualizar'],
  orden: [['tecla', 'ASC']],
  esquemaActualizar: esquemaActualizarOpcionMenu,
  esquemaFiltros: esquemaFiltrosOpcionMenu,
});
