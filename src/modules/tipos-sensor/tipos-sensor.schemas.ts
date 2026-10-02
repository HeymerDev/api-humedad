import { z } from 'zod';
import { filtroTexto, numeroOpcional, texto, textoOpcional } from '../../utils/esquemas';

const base = z.object({
  codigo: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_]{1,40}$/, 'Usa MAYÚSCULAS, números y _ (máx. 40), ej. DHT22_TEMP'),
  nombre: texto(120),
  fabricante: textoOpcional(80),
  descripcion: textoOpcional(),
  magnitud: texto(60),
  unidad: texto(20),
  rango_min: z.number().finite(),
  rango_max: z.number().finite(),
  precision: numeroOpcional().refine((v) => v == null || v > 0, 'Debe ser mayor que 0'),
});

export const esquemaCrearTipoSensor = base.strict().refine((d) => d.rango_min < d.rango_max, {
  message: 'rango_min debe ser menor que rango_max',
  path: ['rango_max'],
});

// La coherencia del rango en un PATCH parcial la garantiza el CHECK de la BD
export const esquemaActualizarTipoSensor = base.partial().strict();

export const esquemaFiltrosTipoSensor = z.object({
  codigo: filtroTexto(),
  magnitud: filtroTexto(),
});
