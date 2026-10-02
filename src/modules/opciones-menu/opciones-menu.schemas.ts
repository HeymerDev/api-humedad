import { z } from 'zod';
import { filtroBooleano, texto, textoOpcional } from '../../utils/esquemas';

export const esquemaActualizarOpcionMenu = z
  .object({
    // El LCD (HD44780) no muestra tildes: ASCII imprimible, 16 columnas
    titulo: z
      .string()
      .regex(/^[ -~]{1,16}$/, 'Solo ASCII sin tildes y máximo 16 caracteres (una línea del LCD)'),
    descripcion: textoOpcional(),
    concepto_analitica: texto(2000),
    endpoint: z.string().trim().max(120).startsWith('/api/', 'Debe ser una ruta de la API, ej. /api/v1/analitica/...'),
    activa: z.boolean(),
  })
  .partial()
  .strict();

export const esquemaFiltrosOpcionMenu = z.object({
  tecla: z
    .string()
    .regex(/^[0-9A-D]$/, 'Tecla del teclado 4x4: 0-9 o A-D')
    .optional(),
  activa: filtroBooleano(),
});
