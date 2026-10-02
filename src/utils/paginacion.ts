import { z } from 'zod';

export const LIMITE_POR_DEFECTO = 50;
export const LIMITE_MAXIMO = 500;

/** `?limit=&offset=` con valores por defecto y tope para no traer tablas enteras. */
export const esquemaPaginacion = z.object({
  limit: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(LIMITE_POR_DEFECTO),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Paginacion = z.output<typeof esquemaPaginacion>;

/** Respuesta de lista: `{ data, meta: { total, limit, offset } }`. */
export function respuestaPaginada<T>(data: T[], total: number, { limit, offset }: Paginacion) {
  return { data, meta: { total, limit, offset } };
}
