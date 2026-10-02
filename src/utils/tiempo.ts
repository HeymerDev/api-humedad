import { env } from '../config/env';

const formatoHora = new Intl.DateTimeFormat('es-CO', {
  timeZone: env.APP_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const formatoFecha = new Intl.DateTimeFormat('en-CA', { timeZone: env.APP_TIMEZONE });

/** "14:05" en la zona horaria de la estación (APP_TIMEZONE). */
export const horaLocal = (fecha: Date | string) => formatoHora.format(new Date(fecha));

/** "2026-10-01" (fecha local de la estación). */
export const fechaLocal = (fecha: Date = new Date()) => formatoFecha.format(fecha);

/** Antigüedad compacta para el LCD: "12s", "5min", "3h", "23d". */
export function hace(segundos: number) {
  if (segundos < 60) return `${Math.max(0, Math.round(segundos))}s`;
  if (segundos < 3600) return `${Math.floor(segundos / 60)}min`;
  if (segundos < 2 * 86400) return `${Math.floor(segundos / 3600)}h`;
  return `${Math.floor(segundos / 86400)}d`;
}

/**
 * Inicio y fin del día local (APP_TIMEZONE) en SQL. Con `fecha` (YYYY-MM-DD)
 * es ese día; sin ella, hoy. Se resuelve en PostgreSQL para no depender de la
 * zona horaria del servidor de la API.
 */
export const SQL_INICIO_DIA = `
  (CASE WHEN :fecha::date IS NULL
        THEN date_trunc('day', now() AT TIME ZONE :tz)
        ELSE :fecha::date::timestamp END) AT TIME ZONE :tz`;
