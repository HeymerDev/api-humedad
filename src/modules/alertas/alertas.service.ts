import { QueryTypes } from 'sequelize';
import { sequelize } from '../../config/database';
import { env } from '../../config/env';
import { Alerta, SEVERIDADES, type Anomalia, type EstadoAlerta, type Severidad, type TipoAnomalia } from '../../models';
import { HttpError } from '../../utils/http-error';

const TITULOS: Record<TipoAnomalia, string> = {
  FUERA_DE_RANGO: 'valor fuera de rango',
  SALTO_BRUSCO: 'salto brusco',
  OUTLIER_ESTADISTICO: 'valor atípico',
  VALOR_CONGELADO: 'valor congelado',
  SENSOR_SIN_DATOS: 'sin datos',
};

const rango = (s: Severidad) => SEVERIDADES.indexOf(s);

/** Anomalía recién creada + la etiqueta de su sensor (para el título). */
export interface AnomaliaParaAlerta {
  anomalia: Anomalia;
  etiqueta: string;
}

/**
 * Abre o acumula alertas a partir de anomalías nuevas. Solo cuentan las de
 * severidad >= ALERTA_SEVERIDAD_MINIMA.
 *
 * Como máximo hay una alerta activa (no RESUELTA) por sensor y tipo, lo que
 * garantiza el índice único parcial uq_alertas_activa_sensor_tipo: si ya
 * existe, se suman las ocurrencias y se conserva la severidad más alta.
 * Devuelve cuántas alertas se abrieron y cuántas se actualizaron.
 */
export async function registrarAlertas(anomalias: AnomaliaParaAlerta[]) {
  const relevantes = anomalias.filter(({ anomalia }) => rango(anomalia.severidad) >= rango(env.ALERTA_SEVERIDAD_MINIMA));
  if (relevantes.length === 0) return { abiertas: 0, actualizadas: 0 };

  // Un INSERT ... ON CONFLICT no puede tocar dos veces la misma fila: se agrupa antes
  const grupos = new Map<string, { primera: AnomaliaParaAlerta; ultima: AnomaliaParaAlerta; cantidad: number; severidad: Severidad }>();
  for (const item of relevantes) {
    const clave = `${item.anomalia.sensor_id}|${item.anomalia.tipo}`;
    const grupo = grupos.get(clave);
    if (!grupo) {
      grupos.set(clave, { primera: item, ultima: item, cantidad: 1, severidad: item.anomalia.severidad });
    } else {
      grupo.ultima = item;
      grupo.cantidad++;
      if (rango(item.anomalia.severidad) > rango(grupo.severidad)) grupo.severidad = item.anomalia.severidad;
    }
  }

  const filas = [...grupos.values()].map(({ primera, ultima, cantidad, severidad }) => ({
    sensor_id: primera.anomalia.sensor_id,
    anomalia_id: primera.anomalia.id,
    tipo: primera.anomalia.tipo,
    titulo: `${primera.etiqueta}: ${TITULOS[primera.anomalia.tipo]}`.slice(0, 160),
    mensaje: ultima.anomalia.descripcion ?? TITULOS[ultima.anomalia.tipo],
    severidad,
    ocurrencias: cantidad,
  }));

  const resultado = await sequelize.query<{ id: number; nueva: boolean }>(
    `INSERT INTO alertas (sensor_id, anomalia_id, tipo, titulo, mensaje, severidad, ocurrencias)
     SELECT sensor_id, anomalia_id, tipo, titulo, mensaje, severidad, ocurrencias
     FROM jsonb_to_recordset($1::jsonb) AS x (
         sensor_id int, anomalia_id int, tipo text, titulo text, mensaje text, severidad text, ocurrencias int)
     ON CONFLICT (sensor_id, tipo) WHERE estado <> 'RESUELTA' DO UPDATE SET
         ocurrencias = alertas.ocurrencias + EXCLUDED.ocurrencias,
         ultima_ocurrencia_en = now(),
         mensaje = EXCLUDED.mensaje,
         severidad = CASE
             WHEN array_position($2::text[], EXCLUDED.severidad) > array_position($2::text[], alertas.severidad)
             THEN EXCLUDED.severidad ELSE alertas.severidad END
     RETURNING id, (xmax = 0) AS nueva`,
    { bind: [JSON.stringify(filas), SEVERIDADES], type: QueryTypes.SELECT },
  );

  const abiertas = resultado.filter((r) => r.nueva).length;
  return { abiertas, actualizadas: resultado.length - abiertas };
}

/** Transiciones permitidas: ABIERTA → RECONOCIDA → RESUELTA (o ABIERTA → RESUELTA). */
export async function cambiarEstado(id: number, estado: Exclude<EstadoAlerta, 'ABIERTA'>) {
  const alerta = await Alerta.findByPk(id);
  if (!alerta) throw HttpError.notFound(`No existe la alerta ${id}`);
  if (alerta.estado === estado) return alerta;
  if (alerta.estado === 'RESUELTA') throw HttpError.conflict('La alerta ya está resuelta; si el problema vuelve se abrirá una nueva');

  const ahora = new Date();
  await alerta.update(
    estado === 'RECONOCIDA'
      ? { estado, reconocido_en: ahora }
      : { estado, resuelto_en: ahora, reconocido_en: alerta.reconocido_en ?? null },
  );
  return alerta;
}

/**
 * Resuelve sola las alertas cuyo problema ya pasó:
 *  - SENSOR_SIN_DATOS: el sensor volvió a enviar (lectura en los últimos DISPOSITIVO_OFFLINE_SEG).
 *  - El resto: sin repeticiones en ALERTA_AUTO_RESOLVER_MIN minutos.
 */
export async function resolverAlertasInactivas() {
  const filas = await sequelize.query<{ id: number }>(
    `UPDATE alertas a
     SET estado = 'RESUELTA',
         resuelto_en = now(),
         mensaje = a.mensaje || ' · Resuelta automáticamente: ' ||
             CASE WHEN a.tipo = 'SENSOR_SIN_DATOS' THEN 'el sensor volvió a enviar datos'
                  ELSE 'sin repeticiones en ' || :minutos || ' min' END
     WHERE a.estado <> 'RESUELTA'
       AND CASE
             WHEN a.tipo = 'SENSOR_SIN_DATOS' THEN EXISTS (
                 SELECT 1 FROM lecturas l
                 WHERE l.sensor_id = a.sensor_id
                   AND l.medido_en > now() - make_interval(secs => :offlineSeg))
             ELSE a.ultima_ocurrencia_en < now() - make_interval(mins => :minutos)
           END
     RETURNING a.id`,
    {
      replacements: { minutos: env.ALERTA_AUTO_RESOLVER_MIN, offlineSeg: env.DISPOSITIVO_OFFLINE_SEG },
      type: QueryTypes.SELECT,
    },
  );
  return filas.length;
}
