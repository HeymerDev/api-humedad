import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';

interface Esquemas<B extends z.ZodType, Q extends z.ZodType, P extends z.ZodType> {
  body?: B;
  query?: Q;
  params?: P;
}

export interface Entrada<B extends z.ZodType, Q extends z.ZodType, P extends z.ZodType> {
  body: z.output<B>;
  query: z.output<Q>;
  params: z.output<P>;
}

/**
 * Envuelve un handler validando body, query y params con zod. El handler
 * recibe los datos ya convertidos y tipados. Si algo no cumple el esquema se
 * lanza un ZodError, que el manejador global responde como 400 VALIDACION.
 *
 *   router.get('/:id', validar({ params: esquemaId }, async ({ params }, _req, res) => { ... }))
 *
 * (En Express 5 `req.query` es de solo lectura; por eso los datos validados se
 * pasan como argumento en vez de reescribir `req`.)
 */
export function validar<
  B extends z.ZodType = z.ZodUnknown,
  Q extends z.ZodType = z.ZodUnknown,
  P extends z.ZodType = z.ZodUnknown,
>(
  esquemas: Esquemas<B, Q, P>,
  handler: (entrada: Entrada<B, Q, P>, req: Request, res: Response, next: NextFunction) => unknown,
): RequestHandler {
  return async (req, res, next) => {
    const entrada = {
      body: esquemas.body ? await esquemas.body.parseAsync(req.body ?? {}) : req.body,
      query: esquemas.query ? await esquemas.query.parseAsync(req.query) : req.query,
      params: esquemas.params ? await esquemas.params.parseAsync(req.params) : req.params,
    } as Entrada<B, Q, P>;
    await handler(entrada, req, res, next);
  };
}

/** `:id` numérico positivo. */
export const esquemaId = z.object({ id: z.coerce.number().int().positive() });
