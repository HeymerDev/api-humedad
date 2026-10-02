import type { NextFunction, Request, Response } from 'express';
import { BaseError, DatabaseError, ForeignKeyConstraintError, UniqueConstraintError, ValidationError } from 'sequelize';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { HttpError } from '../utils/http-error';

/** Códigos de PostgreSQL que son culpa de los datos enviados (→ 400). */
const ERRORES_DE_DATOS: Record<string, string> = {
  '23514': 'Los datos no cumplen una restricción de la base de datos',
  '23502': 'Falta un campo obligatorio',
  '22001': 'Un texto supera el largo permitido',
  '22003': 'Un número está fuera del rango permitido',
  '22P02': 'Un valor no tiene el formato esperado',
  '22007': 'Fecha u hora inválida',
  '22008': 'Fecha u hora fuera de rango',
};

function responder(res: Response, status: number, codigo: string, mensaje: string, detalles?: unknown) {
  res.status(status).json({ error: { codigo, mensaje, detalles } });
}

/**
 * Manejador global de errores. Express 5 reenvía aquí también los errores
 * de handlers async, así que los controladores no necesitan try/catch.
 *
 * Formato de respuesta: { error: { codigo, mensaje, detalles? } }
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return responder(res, err.status, err.codigo, err.message, err.detalles);
  }

  if (err instanceof ZodError) {
    const detalles = err.issues.map((i) => ({ campo: i.path.join('.') || '(raíz)', mensaje: i.message }));
    return responder(res, 400, 'VALIDACION', 'Datos de entrada inválidos', detalles);
  }

  if (err instanceof UniqueConstraintError) {
    const detalles = Object.keys(err.fields ?? {});
    return responder(res, 409, 'DUPLICADO', 'Ya existe un registro con esos datos', detalles);
  }

  if (err instanceof ForeignKeyConstraintError) {
    const detalle = String((err.parent as { detail?: string } | undefined)?.detail ?? '');
    if (detalle.includes('is still referenced')) {
      return responder(res, 409, 'EN_USO', 'No se puede borrar: otros registros dependen de este', detalle);
    }
    return responder(res, 400, 'REFERENCIA_INVALIDA', 'Un id relacionado no existe', detalle);
  }

  if (err instanceof ValidationError) {
    const detalles = err.errors.map((e) => ({ campo: e.path, mensaje: e.message }));
    return responder(res, 400, 'VALIDACION', 'Datos de entrada inválidos', detalles);
  }

  if (err instanceof DatabaseError) {
    const original = err.parent as { code?: string; constraint?: string; message?: string };
    // ON DELETE RESTRICT (23001): Sequelize no lo clasifica como error de FK
    if (original.code === '23001') {
      return responder(res, 409, 'EN_USO', 'No se puede borrar: otros registros dependen de este', original.constraint);
    }
    const mensaje = original.code ? ERRORES_DE_DATOS[original.code] : undefined;
    if (mensaje) {
      return responder(res, 400, 'RESTRICCION_VIOLADA', mensaje, original.constraint ?? original.message);
    }
  }

  // Express (body-parser) marca el JSON mal formado con status 400
  if (typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.parse.failed') {
    return responder(res, 400, 'JSON_INVALIDO', 'El cuerpo no es un JSON válido');
  }
  if (typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.too.large') {
    return responder(res, 413, 'CUERPO_DEMASIADO_GRANDE', 'El cuerpo supera el tamaño máximo (1 MB)');
  }

  console.error(err);
  const esBaseDatos = err instanceof BaseError;
  responder(
    res,
    500,
    esBaseDatos ? 'ERROR_BASE_DATOS' : 'ERROR_INTERNO',
    env.NODE_ENV === 'production' ? 'Error interno del servidor' : String((err as Error)?.message ?? err),
  );
}
