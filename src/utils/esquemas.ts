import { z } from 'zod';

/** Texto obligatorio, sin espacios sobrantes, con largo máximo. */
export const texto = (max: number) => z.string().trim().min(1, 'No puede estar vacío').max(max);

/** Texto opcional que acepta null para borrar el valor. */
export const textoOpcional = (max?: number) => (max ? z.string().trim().max(max) : z.string().trim()).nullable().optional();

/** Número opcional que acepta null. */
export const numeroOpcional = () => z.number().finite().nullable().optional();

/** Id de otra tabla (entero positivo). */
export const idRelacion = () => z.number().int().positive();

/** Filtros de query string: "?activo=true", "?sensor_id=3". */
export const filtroBooleano = () => z.stringbool().optional();
export const filtroId = () => z.coerce.number().int().positive().optional();
export const filtroTexto = () => z.string().trim().min(1).optional();
