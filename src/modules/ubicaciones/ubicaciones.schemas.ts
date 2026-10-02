import { z } from 'zod';
import { filtroTexto, texto, textoOpcional } from '../../utils/esquemas';

const base = z.object({
  nombre: texto(120),
  descripcion: textoOpcional(),
  tipo_ambiente: textoOpcional(40),
  latitud: z.number().min(-90).max(90).nullable().optional(),
  longitud: z.number().min(-180).max(180).nullable().optional(),
  altitud_m: z.number().min(-99999).max(99999).nullable().optional(),
});

export const esquemaCrearUbicacion = base.strict();
export const esquemaActualizarUbicacion = base.partial().strict();

export const esquemaFiltrosUbicacion = z.object({
  tipo_ambiente: filtroTexto(),
});
