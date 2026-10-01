import type { NextFunction, Request, Response } from 'express';
import { BaseError, ForeignKeyConstraintError, UniqueConstraintError, ValidationError } from 'sequelize';
import { ZodError, z } from 'zod';
import { env } from '../config/env';
import { HttpError } from '../utils/http-error';

/**
 * Manejador global de errores. Express 5 reenvía aquí también los errores
 * de handlers async, así que los controladores no necesitan try/catch.
 *
 * Formato de respuesta: { error: { codigo, mensaje, detalles? } }
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: { codigo: err.codigo, mensaje: err.message, detalles: err.detalles },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: { codigo: 'VALIDACION', mensaje: 'Datos de entrada inválidos', detalles: z.flattenError(err) },
    });
    return;
  }

  if (err instanceof UniqueConstraintError) {
    res.status(409).json({
      error: { codigo: 'DUPLICADO', mensaje: 'Ya existe un registro con esos datos', detalles: err.fields },
    });
    return;
  }

  if (err instanceof ForeignKeyConstraintError) {
    res.status(409).json({
      error: { codigo: 'REFERENCIA_INVALIDA', mensaje: 'La operación viola una relación entre tablas', detalles: err.index },
    });
    return;
  }

  if (err instanceof ValidationError) {
    res.status(400).json({
      error: { codigo: 'VALIDACION', mensaje: err.message, detalles: err.errors.map((e) => e.message) },
    });
    return;
  }

  // Express (body-parser) marca el JSON mal formado con status 400
  if (typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.parse.failed') {
    res.status(400).json({ error: { codigo: 'JSON_INVALIDO', mensaje: 'El cuerpo no es un JSON válido' } });
    return;
  }

  console.error(err);
  const esBaseDatos = err instanceof BaseError;
  res.status(500).json({
    error: {
      codigo: esBaseDatos ? 'ERROR_BASE_DATOS' : 'ERROR_INTERNO',
      mensaje: env.NODE_ENV === 'production' ? 'Error interno del servidor' : String((err as Error)?.message ?? err),
    },
  });
}
