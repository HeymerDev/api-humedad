import { Router } from 'express';
import type { FindOptions, Includeable, Order, WhereOptions } from 'sequelize';
import type { Model, ModelCtor } from 'sequelize-typescript';
import { z } from 'zod';
import { validar } from '../middlewares/validar';
import { HttpError } from './http-error';
import { esquemaPaginacion, respuestaPaginada } from './paginacion';

type Operacion = 'listar' | 'obtener' | 'crear' | 'actualizar' | 'eliminar';

export interface OpcionesCrud {
  modelo: ModelCtor;
  /** Para los mensajes: "No existe el sensor 7". */
  nombre: string;
  esquemaCrear?: z.ZodType<Record<string, unknown>>;
  esquemaActualizar?: z.ZodType<Record<string, unknown>>;
  /** Filtros de `GET /` (igualdad exacta sobre columnas). */
  esquemaFiltros?: z.ZodObject;
  include?: Includeable[];
  orden?: Order;
  /** Por defecto todas. */
  operaciones?: Operacion[];
  /**
   * Columna única alternativa para `/:id`: si el valor no es numérico se busca
   * por ella (ej. 'codigo' → GET /dispositivos/esp32_01).
   */
  campoAlterno?: string;
  /** Lanza HttpError para impedir el borrado (ej. si tiene lecturas). */
  antesDeEliminar?: (instancia: Model) => Promise<void>;
}

/**
 * Router REST estándar para un catálogo:
 *   GET /        lista paginada con filtros   200 { data, meta }
 *   GET /:id     detalle                      200 { data } | 404
 *   POST /       crear                        201 { data } | 400 | 409
 *   PATCH /:id   actualización parcial        200 { data } | 400 | 404 | 409
 *   DELETE /:id  borrar                       204 | 404 | 409
 */
export function crearCrud(opciones: OpcionesCrud): Router {
  const { modelo, nombre, include = [], orden = [['id', 'ASC']] } = opciones;
  const operaciones = new Set<Operacion>(opciones.operaciones ?? ['listar', 'obtener', 'crear', 'actualizar', 'eliminar']);
  const router = Router();

  const esquemaRef = z.object({ id: z.string().trim().min(1) });

  /** Busca por id numérico o, si se configuró, por el campo alterno. */
  const buscar = async (ref: string | number) => {
    const esNumerico = /^\d+$/.test(String(ref));
    if (!esNumerico && !opciones.campoAlterno) throw HttpError.badRequest('El id debe ser un número entero positivo');
    const instancia = esNumerico
      ? await modelo.findByPk(Number(ref), { include })
      : await modelo.findOne({ where: { [opciones.campoAlterno as string]: ref }, include });
    if (!instancia) throw HttpError.notFound(`No existe ${nombre} ${ref}`);
    return instancia;
  };

  if (operaciones.has('listar')) {
    const esquemaFiltros = opciones.esquemaFiltros ?? z.object({});
    const esquemaQuery = esquemaPaginacion.extend(esquemaFiltros.shape);

    router.get(
      '/',
      validar({ query: esquemaQuery }, async ({ query }, _req, res) => {
        const { limit, offset, ...filtros } = query as z.output<typeof esquemaPaginacion> & Record<string, unknown>;
        const where = Object.fromEntries(Object.entries(filtros).filter(([, v]) => v !== undefined)) as WhereOptions;
        const consulta: FindOptions = { where, include, order: orden, limit, offset, distinct: true } as FindOptions;
        const { rows, count } = await modelo.findAndCountAll(consulta);
        res.json(respuestaPaginada(rows, count as unknown as number, { limit, offset }));
      }),
    );
  }

  if (operaciones.has('obtener')) {
    router.get(
      '/:id',
      validar({ params: esquemaRef }, async ({ params }, _req, res) => {
        res.json({ data: await buscar(params.id) });
      }),
    );
  }

  if (operaciones.has('crear') && opciones.esquemaCrear) {
    router.post(
      '/',
      validar({ body: opciones.esquemaCrear }, async ({ body }, _req, res) => {
        const creado = await modelo.create(body);
        res.status(201).json({ data: await buscar(creado.get('id') as number) });
      }),
    );
  }

  if (operaciones.has('actualizar') && opciones.esquemaActualizar) {
    router.patch(
      '/:id',
      validar({ params: esquemaRef, body: opciones.esquemaActualizar }, async ({ params, body }, _req, res) => {
        if (Object.keys(body).length === 0) throw HttpError.badRequest('No se envió ningún campo para actualizar');
        const instancia = await buscar(params.id);
        await instancia.update(body);
        res.json({ data: await buscar(instancia.get('id') as number) });
      }),
    );
  }

  if (operaciones.has('eliminar')) {
    router.delete(
      '/:id',
      validar({ params: esquemaRef }, async ({ params }, _req, res) => {
        const instancia = await buscar(params.id);
        await opciones.antesDeEliminar?.(instancia);
        await instancia.destroy();
        res.status(204).end();
      }),
    );
  }

  return router;
}
