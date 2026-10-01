/**
 * Valores permitidos por los CHECK de database/schema.sql.
 * Se usan en los modelos (validate.isIn) y en la validación de la API.
 */

export const SEVERIDADES = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] as const;
export type Severidad = (typeof SEVERIDADES)[number];

export const TIPOS_ANOMALIA = [
  'FUERA_DE_RANGO',
  'VALOR_CONGELADO',
  'SALTO_BRUSCO',
  'OUTLIER_ESTADISTICO',
  'SENSOR_SIN_DATOS',
] as const;
export type TipoAnomalia = (typeof TIPOS_ANOMALIA)[number];

export const METODOS_DETECCION = ['UMBRAL', 'ZSCORE', 'IQR', 'MEDIA_MOVIL', 'MANUAL'] as const;
export type MetodoDeteccion = (typeof METODOS_DETECCION)[number];

export const ESTADOS_ALERTA = ['ABIERTA', 'RECONOCIDA', 'RESUELTA'] as const;
export type EstadoAlerta = (typeof ESTADOS_ALERTA)[number];

export const CALIDADES_LECTURA = ['OK', 'SOSPECHOSA', 'INVALIDA'] as const;
export type CalidadLectura = (typeof CALIDADES_LECTURA)[number];

export const ORIGENES_LOTE = ['TIEMPO_REAL', 'BUFFER'] as const;
export type OrigenLote = (typeof ORIGENES_LOTE)[number];
