import { z } from 'zod';
import { filtroBooleano, filtroId, filtroTexto, idRelacion, texto, textoOpcional } from '../../utils/esquemas';

const calibracion = z.number().finite().min(-999999).max(999999);

const base = z.object({
  // Es la clave del valor en el JSON del ESP32
  etiqueta: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,59}$/, 'Minúsculas, números y _ empezando por letra (máx. 60), ej. temperatura_aire'),
  nombre: texto(120),
  descripcion: textoOpcional(),
  pin: textoOpcional(20),
  activo: z.boolean().optional(),
  offset_calibracion: calibracion.optional(),
  escala_calibracion: calibracion.refine((v) => v !== 0, 'La escala no puede ser 0').optional(),
  dispositivo_id: idRelacion(),
  tipo_sensor_id: idRelacion(),
});

export const esquemaCrearSensor = base.strict();

// No se cambia de dispositivo ni de tipo: sus lecturas quedarían mal atribuidas.
// Para eso se crea un sensor nuevo.
export const esquemaActualizarSensor = base.omit({ dispositivo_id: true, tipo_sensor_id: true }).partial().strict();

export const esquemaFiltrosSensor = z.object({
  dispositivo_id: filtroId(),
  tipo_sensor_id: filtroId(),
  etiqueta: filtroTexto(),
  activo: filtroBooleano(),
});
