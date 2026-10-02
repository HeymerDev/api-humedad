import { z } from 'zod';
import { METODOS_DETECCION, SEVERIDADES, TIPOS_ANOMALIA } from '../../models';
import { filtroBooleano, filtroId, numeroOpcional, texto, textoOpcional } from '../../utils/esquemas';

const enteroPositivoOpcional = () => z.number().int().positive().nullable().optional();

const base = z.object({
  nombre: texto(120),
  descripcion: textoOpcional(),
  tipo_anomalia: z.enum(TIPOS_ANOMALIA),
  metodo: z.enum(METODOS_DETECCION).optional(),
  severidad: z.enum(SEVERIDADES).optional(),
  valor_min: numeroOpcional(),
  valor_max: numeroOpcional(),
  delta_max: numeroOpcional(),
  factor: numeroOpcional(),
  ventana_minutos: enteroPositivoOpcional(),
  minimo_muestras: enteroPositivoOpcional(),
  activa: z.boolean().optional(),
  sensor_id: z.number().int().positive().nullable().optional(),
  tipo_sensor_id: z.number().int().positive().nullable().optional(),
});

type Regla = z.output<typeof base>;

/** Mismos requisitos que el CHECK ck_reglas_umbral_parametros_por_tipo, con mensajes claros. */
function validarParametros(r: Regla, ctx: z.RefinementCtx) {
  const falta = (campo: string, mensaje: string) => ctx.addIssue({ code: 'custom', path: [campo], message: mensaje });

  if (r.sensor_id != null && r.tipo_sensor_id != null) {
    falta('tipo_sensor_id', 'Usa sensor_id o tipo_sensor_id, no ambos (ninguno = regla global)');
  }
  if (r.valor_min != null && r.valor_max != null && r.valor_min >= r.valor_max) {
    falta('valor_max', 'valor_min debe ser menor que valor_max');
  }

  switch (r.tipo_anomalia) {
    case 'FUERA_DE_RANGO':
      if (r.valor_min == null && r.valor_max == null) falta('valor_min', 'Indica valor_min y/o valor_max');
      break;
    case 'SALTO_BRUSCO':
      if (r.delta_max == null || r.delta_max <= 0) falta('delta_max', 'delta_max debe ser mayor que 0');
      break;
    case 'OUTLIER_ESTADISTICO':
      if (r.metodo !== 'ZSCORE' && r.metodo !== 'IQR') falta('metodo', 'Usa metodo ZSCORE o IQR');
      if (r.factor == null || r.factor <= 0) falta('factor', 'factor debe ser mayor que 0 (ej. 3 para ZSCORE, 1.5 para IQR)');
      if (r.ventana_minutos == null) falta('ventana_minutos', 'Indica la ventana en minutos');
      break;
    case 'VALOR_CONGELADO':
    case 'SENSOR_SIN_DATOS':
      if (r.ventana_minutos == null) falta('ventana_minutos', 'Indica la ventana en minutos');
      break;
  }
}

export const esquemaCrearReglaUmbral = base.strict().superRefine(validarParametros);

// En un PATCH parcial la combinación final la valida el CHECK de la BD (→ 400)
export const esquemaActualizarReglaUmbral = base.partial().strict();

export const esquemaFiltrosReglaUmbral = z.object({
  tipo_anomalia: z.enum(TIPOS_ANOMALIA).optional(),
  severidad: z.enum(SEVERIDADES).optional(),
  activa: filtroBooleano(),
  sensor_id: filtroId(),
  tipo_sensor_id: filtroId(),
});
