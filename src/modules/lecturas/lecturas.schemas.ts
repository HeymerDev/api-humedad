import { z } from 'zod';
import { CALIDADES_LECTURA, ORIGENES_LOTE } from '../../models';
import { esquemaFecha } from '../../utils/fechas';
import { filtroId, filtroTexto } from '../../utils/esquemas';
import { esquemaPaginacion } from '../../utils/paginacion';

/** Tope por petición: un buffer de ~2,5 h de 3 sensores cabe en un lote. */
export const MAX_LECTURAS_POR_LOTE = 500;

/**
 * Cuerpo de POST /api/v1/lecturas. Solo se valida la estructura del lote:
 * cada lectura se valida por separado para que una mala no tumbe a las demás.
 */
export const esquemaLote = z.object({
  dispositivo: z.string().trim().min(1, 'Indica el código del dispositivo').max(64),
  origen: z.enum(ORIGENES_LOTE).default('TIEMPO_REAL'),
  intento: z.number().int().min(1).max(1000).default(1),
  enviado_en: esquemaFecha.optional(),
  lecturas: z
    .array(z.unknown())
    .min(1, 'El lote no trae lecturas')
    .max(MAX_LECTURAS_POR_LOTE, `Máximo ${MAX_LECTURAS_POR_LOTE} lecturas por lote: divide el buffer en varios envíos`),
});

export type EntradaLote = z.output<typeof esquemaLote>;

/** Una lectura del lote. */
export const esquemaLectura = z.object({
  sensor: z.string({ error: 'Falta la etiqueta del sensor' }).trim().min(1, 'Falta la etiqueta del sensor'),
  // ArduinoJson envía null cuando el DHT22 devuelve NaN
  valor: z.number({ error: 'valor debe ser un número (null o NaN indica falla del sensor)' }),
  medido_en: esquemaFecha.optional(),
});

/** Query de GET /api/v1/lecturas. Sin desde/hasta: últimas 24 h. Máximo 31 días. */
export const esquemaFiltrosLecturas = esquemaPaginacion.extend({
  sensor_id: filtroId(),
  dispositivo: filtroTexto(),
  calidad: z.enum(CALIDADES_LECTURA).optional(),
  desde: esquemaFecha.optional(),
  hasta: esquemaFecha.optional(),
  orden: z.enum(['asc', 'desc']).default('desc'),
});

export type FiltrosLecturas = z.output<typeof esquemaFiltrosLecturas>;
