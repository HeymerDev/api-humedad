import { z } from 'zod';

/**
 * Convierte lo que envía el ESP32 a Date:
 *   - número o texto numérico: epoch en segundos (si es > 1e11 se asume milisegundos)
 *   - texto: ISO-8601 (ej. 2026-10-01T14:30:00-05:00)
 * Devuelve una fecha inválida si no se puede interpretar.
 */
export function aFecha(valor: number | string): Date {
  const esNumero = typeof valor === 'number' || /^\d+(\.\d+)?$/.test(valor);
  if (!esNumero) return new Date(valor);
  const n = Number(valor);
  return new Date(n > 1e11 ? n : n * 1000);
}

/** Fecha en epoch (s) o ISO-8601, ya convertida a Date. */
export const esquemaFecha = z
  .union([z.number(), z.string().trim().min(1)])
  .transform(aFecha)
  .pipe(z.date({ error: 'Fecha inválida: usa epoch en segundos o ISO-8601' }));

/** Epoch en segundos (lo que el ESP32 maneja con time()). */
export function aEpoch(fecha: Date = new Date()) {
  return Math.floor(fecha.getTime() / 1000);
}
