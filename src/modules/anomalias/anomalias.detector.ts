import { Op, QueryTypes } from 'sequelize';
import { sequelize } from '../../config/database';
import { Anomalia, ReglaUmbral, type CalidadLectura, type MetodoDeteccion, type Severidad, type TipoAnomalia } from '../../models';
import { registrarAlertas } from '../alertas/alertas.service';

/**
 * Detector de anomalías. Se ejecuta después de guardar cada lote (si falla,
 * las lecturas ya quedaron guardadas) y evalúa cada lectura nueva contra las
 * reglas activas que le aplican:
 *
 *  FUERA_DE_RANGO       UMBRAL       valor < valor_min o > valor_max (lecturas OK e INVALIDA).
 *                                    Una lectura INVALIDA (fuera del rango físico) siempre
 *                                    genera esta anomalía, aunque no haya regla.
 *  SALTO_BRUSCO         UMBRAL       |valor − lectura anterior (≤ 10 min)| > delta_max
 *                       MEDIA_MOVIL  |valor − media de la ventana| > delta_max
 *  OUTLIER_ESTADISTICO  ZSCORE       |valor − media| / desviación > factor
 *                       IQR          valor fuera de [Q1 − factor·IQR, Q3 + factor·IQR]
 *  VALOR_CONGELADO      UMBRAL       el mismo valor exacto durante toda la ventana
 *                                    (una anomalía por ventana, no una por lectura)
 *
 * SENSOR_SIN_DATOS no depende de una lectura: lo detecta la vigilancia periódica.
 * Las ventanas solo usan lecturas OK anteriores a la evaluada.
 */

export interface LecturaNueva {
  id: number;
  sensor_id: number;
  tipo_sensor_id: number;
  etiqueta: string;
  unidad: string;
  /** Precisión del sensor: desviaciones menores se consideran ruido. */
  precision: number | null;
  medido_en: Date;
  valor: number;
  calidad: CalidadLectura;
  rango_fisico: [number, number];
}

interface Estadisticas {
  n: number;
  media: number | null;
  desv: number | null;
  q1: number | null;
  q3: number | null;
  n_todas: number;
  minimo: number | null;
  maximo: number | null;
  mas_antigua: Date | null;
}

type NuevaAnomalia = {
  sensor_id: number;
  regla_id: number | null;
  lectura_id: number;
  lectura_medido_en: Date;
  tipo: TipoAnomalia;
  metodo: MetodoDeteccion;
  severidad: Severidad;
  valor_observado: number;
  valor_esperado: number | null;
  desviacion: number | null;
  score: number | null;
  descripcion: string;
  parametros: Record<string, unknown>;
};

/** Lectura anterior "consecutiva" para SALTO_BRUSCO por UMBRAL. */
const MAX_HUECO_SALTO_MIN = 10;
const MIN_MUESTRAS_POR_DEFECTO = 10;

const redondear = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Reglas activas que aplican a un sensor. Por cada tipo de anomalía gana el
 * alcance más específico: sensor > tipo de sensor > global.
 */
export function reglasAplicables(reglas: ReglaUmbral[], sensor: { id: number; tipo_sensor_id: number }) {
  const nivel = (r: ReglaUmbral) => (r.sensor_id != null ? 0 : r.tipo_sensor_id != null ? 1 : 2);
  const aplicables = reglas.filter(
    (r) =>
      r.sensor_id === sensor.id ||
      r.tipo_sensor_id === sensor.tipo_sensor_id ||
      (r.sensor_id == null && r.tipo_sensor_id == null),
  );
  const mejor = new Map<TipoAnomalia, number>();
  for (const r of aplicables) mejor.set(r.tipo_anomalia, Math.min(mejor.get(r.tipo_anomalia) ?? 9, nivel(r)));
  return aplicables.filter((r) => nivel(r) === mejor.get(r.tipo_anomalia));
}

/** Estadísticas de ventana para cada (lectura, minutos) en UNA sola consulta. */
async function estadisticasDeVentanas(pedidos: { lectura: LecturaNueva; ventana: number }[]) {
  if (pedidos.length === 0) return new Map<string, Estadisticas>();
  const filas = await sequelize.query<Estadisticas & { lectura_id: number; ventana: number }>(
    `SELECT c.lectura_id, c.ventana,
            ok.n, ok.media, ok.desv, ok.q1, ok.q3,
            todas.n AS n_todas, todas.minimo, todas.maximo, todas.mas_antigua
     FROM jsonb_to_recordset($1::jsonb) AS c (lectura_id bigint, sensor_id int, medido_en timestamptz, ventana int)
     CROSS JOIN LATERAL (
         SELECT count(*)::int AS n, avg(valor) AS media, stddev_samp(valor) AS desv,
                percentile_cont(0.25) WITHIN GROUP (ORDER BY valor) AS q1,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY valor) AS q3
         FROM lecturas l
         WHERE l.sensor_id = c.sensor_id AND l.calidad = 'OK'
           AND l.medido_en >= c.medido_en - make_interval(mins => c.ventana)
           AND l.medido_en < c.medido_en
     ) ok
     CROSS JOIN LATERAL (
         SELECT count(*)::int AS n, min(valor) AS minimo, max(valor) AS maximo, min(medido_en) AS mas_antigua
         FROM lecturas l
         WHERE l.sensor_id = c.sensor_id
           AND l.medido_en >= c.medido_en - make_interval(mins => c.ventana)
           AND l.medido_en <= c.medido_en
     ) todas`,
    {
      bind: [
        JSON.stringify(
          pedidos.map(({ lectura, ventana }) => ({
            lectura_id: lectura.id,
            sensor_id: lectura.sensor_id,
            medido_en: lectura.medido_en,
            ventana,
          })),
        ),
      ],
      type: QueryTypes.SELECT,
    },
  );
  return new Map(filas.map((f) => [`${f.lectura_id}|${f.ventana}`, f]));
}

/** Lectura OK inmediatamente anterior (como máximo 10 min antes) de cada lectura. */
async function lecturasAnteriores(lecturas: LecturaNueva[]) {
  if (lecturas.length === 0) return new Map<number, number>();
  const filas = await sequelize.query<{ lectura_id: number; valor: number }>(
    `SELECT c.lectura_id, p.valor
     FROM jsonb_to_recordset($1::jsonb) AS c (lectura_id bigint, sensor_id int, medido_en timestamptz)
     CROSS JOIN LATERAL (
         SELECT valor FROM lecturas l
         WHERE l.sensor_id = c.sensor_id AND l.calidad = 'OK'
           AND l.medido_en < c.medido_en
           AND l.medido_en >= c.medido_en - make_interval(mins => ${MAX_HUECO_SALTO_MIN})
         ORDER BY l.medido_en DESC
         LIMIT 1
     ) p`,
    {
      bind: [JSON.stringify(lecturas.map((l) => ({ lectura_id: l.id, sensor_id: l.sensor_id, medido_en: l.medido_en })))],
      type: QueryTypes.SELECT,
    },
  );
  return new Map(filas.map((f) => [f.lectura_id, f.valor]));
}

function evaluar(
  lectura: LecturaNueva,
  regla: ReglaUmbral,
  anterior: number | undefined,
  stats: Estadisticas | undefined,
): Omit<NuevaAnomalia, 'sensor_id' | 'lectura_id' | 'lectura_medido_en' | 'regla_id' | 'tipo' | 'metodo' | 'severidad'> | null {
  const v = lectura.valor;
  const u = lectura.unidad;
  const ruido = lectura.precision ?? 0;
  const minimo = regla.minimo_muestras ?? MIN_MUESTRAS_POR_DEFECTO;

  switch (regla.tipo_anomalia) {
    case 'FUERA_DE_RANGO': {
      let esperado: number | null = null;
      if (regla.valor_min != null && v < regla.valor_min) esperado = regla.valor_min;
      else if (regla.valor_max != null && v > regla.valor_max) esperado = regla.valor_max;
      if (esperado == null) return null;
      return {
        valor_observado: v,
        valor_esperado: esperado,
        desviacion: redondear(v - esperado),
        score: redondear(Math.abs(v - esperado)),
        descripcion: `${v} ${u} fuera del rango operativo ${regla.valor_min ?? '-∞'} a ${regla.valor_max ?? '∞'} ${u}`,
        parametros: { valor_min: regla.valor_min, valor_max: regla.valor_max },
      };
    }

    case 'SALTO_BRUSCO': {
      const delta = regla.delta_max!;
      const usaMedia = regla.metodo === 'MEDIA_MOVIL' && regla.ventana_minutos != null;
      const referencia = usaMedia ? (stats && stats.n >= minimo ? stats.media : null) : anterior;
      if (referencia == null || Math.abs(v - referencia) <= delta) return null;
      return {
        valor_observado: v,
        valor_esperado: redondear(referencia),
        desviacion: redondear(v - referencia),
        score: redondear(Math.abs(v - referencia) / delta),
        descripcion: `Cambio de ${redondear(v - referencia, 2)} ${u} respecto ${
          usaMedia ? `de la media de ${regla.ventana_minutos} min` : 'de la lectura anterior'
        } (máximo ${delta} ${u})`,
        parametros: { delta_max: delta, ventana_minutos: usaMedia ? regla.ventana_minutos : null, muestras: usaMedia ? stats?.n : 1 },
      };
    }

    case 'OUTLIER_ESTADISTICO': {
      if (!stats || stats.n < minimo || stats.media == null) return null;
      const k = regla.factor!;
      if (regla.metodo === 'IQR') {
        if (stats.q1 == null || stats.q3 == null) return null;
        const iqr = stats.q3 - stats.q1;
        if (iqr <= 0) return null;
        const bajo = stats.q1 - k * iqr;
        const alto = stats.q3 + k * iqr;
        if (v >= bajo && v <= alto) return null;
        const limite = v < bajo ? bajo : alto;
        if (Math.abs(v - limite) <= ruido) return null;
        return {
          valor_observado: v,
          valor_esperado: redondear(limite),
          desviacion: redondear(v - limite),
          score: redondear(Math.abs(v - limite) / iqr),
          descripcion: `${v} ${u} fuera del rango intercuartílico [${redondear(bajo, 2)}, ${redondear(alto, 2)}] de ${regla.ventana_minutos} min`,
          parametros: { factor: k, q1: stats.q1, q3: stats.q3, iqr, muestras: stats.n, ventana_minutos: regla.ventana_minutos },
        };
      }
      if (!stats.desv || stats.desv <= 0) return null;
      const z = (v - stats.media) / stats.desv;
      if (Math.abs(z) <= k || Math.abs(v - stats.media) <= ruido) return null;
      return {
        valor_observado: v,
        valor_esperado: redondear(stats.media),
        desviacion: redondear(v - stats.media),
        score: redondear(Math.abs(z)),
        descripcion: `${v} ${u} con z = ${redondear(z, 2)} (media ${redondear(stats.media, 2)}, desv. ${redondear(stats.desv, 3)}, ${stats.n} muestras de ${regla.ventana_minutos} min)`,
        parametros: { factor: k, media: stats.media, desviacion_estandar: stats.desv, muestras: stats.n, ventana_minutos: regla.ventana_minutos },
      };
    }

    case 'VALOR_CONGELADO': {
      const ventanaMs = regla.ventana_minutos! * 60_000;
      if (!stats || stats.minimo == null || stats.maximo == null || !stats.mas_antigua) return null;
      if (stats.n_todas < (regla.minimo_muestras ?? 2) || stats.maximo - stats.minimo > 1e-9) return null;
      // La ventana debe estar realmente cubierta, no solo tener pocas lecturas recientes
      if (lectura.medido_en.getTime() - new Date(stats.mas_antigua).getTime() < ventanaMs * 0.9) return null;
      return {
        valor_observado: v,
        valor_esperado: null,
        desviacion: 0,
        score: stats.n_todas,
        descripcion: `El sensor repite ${v} ${u} en ${stats.n_todas} lecturas seguidas durante ${regla.ventana_minutos} min`,
        parametros: { ventana_minutos: regla.ventana_minutos, muestras: stats.n_todas },
      };
    }

    default:
      return null;
  }
}

/**
 * Evalúa las lecturas recién guardadas, guarda las anomalías y abre o
 * acumula las alertas. Devuelve los conteos para la respuesta de la ingesta.
 */
export async function detectarAnomalias(lecturas: LecturaNueva[]) {
  if (lecturas.length === 0) return { anomalias: 0, alertas_abiertas: 0, alertas_actualizadas: 0 };

  const reglas = await ReglaUmbral.findAll({ where: { activa: true, tipo_anomalia: { [Op.ne]: 'SENSOR_SIN_DATOS' } } });
  const ordenadas = [...lecturas].sort((a, b) => a.medido_en.getTime() - b.medido_en.getTime());
  const reglasPorLectura = new Map(ordenadas.map((l) => [l.id, reglasAplicables(reglas, { id: l.sensor_id, tipo_sensor_id: l.tipo_sensor_id })]));

  // Una sola consulta de ventanas y otra de lecturas anteriores para todo el lote
  const pedidos = ordenadas.flatMap((lectura) =>
    [...new Set(reglasPorLectura.get(lectura.id)!.map((r) => r.ventana_minutos).filter((m): m is number => m != null))].map(
      (ventana) => ({ lectura, ventana }),
    ),
  );
  const [stats, anteriores] = await Promise.all([estadisticasDeVentanas(pedidos), lecturasAnteriores(ordenadas)]);

  // VALOR_CONGELADO: una anomalía por ventana. Última ya registrada por sensor:
  const ultimasCongeladas = new Map<number, number>();
  const congeladas = await Anomalia.findAll({
    attributes: ['sensor_id', [sequelize.fn('max', sequelize.col('lectura_medido_en')), 'ultima']],
    where: { tipo: 'VALOR_CONGELADO', sensor_id: [...new Set(ordenadas.map((l) => l.sensor_id))] },
    group: ['sensor_id'],
    raw: true,
  });
  for (const c of congeladas as unknown as { sensor_id: number; ultima: Date }[]) {
    ultimasCongeladas.set(c.sensor_id, new Date(c.ultima).getTime());
  }

  const nuevas: { datos: NuevaAnomalia; etiqueta: string }[] = [];
  for (const lectura of ordenadas) {
    if (lectura.calidad === 'INVALIDA') {
      const [min, max] = lectura.rango_fisico;
      nuevas.push({
        etiqueta: lectura.etiqueta,
        datos: {
          sensor_id: lectura.sensor_id,
          regla_id: null,
          lectura_id: lectura.id,
          lectura_medido_en: lectura.medido_en,
          tipo: 'FUERA_DE_RANGO',
          metodo: 'UMBRAL',
          severidad: 'ALTA',
          valor_observado: lectura.valor,
          valor_esperado: lectura.valor < min ? min : max,
          desviacion: redondear(lectura.valor - (lectura.valor < min ? min : max)),
          score: redondear(Math.abs(lectura.valor - (lectura.valor < min ? min : max))),
          descripcion: `${lectura.valor} ${lectura.unidad} fuera del rango físico del sensor (${min} a ${max} ${lectura.unidad}): probable falla`,
          parametros: { rango_fisico: [min, max] },
        },
      });
    }

    for (const regla of reglasPorLectura.get(lectura.id)!) {
      const tipo = regla.tipo_anomalia;
      // Rangos: OK e INVALIDA. Congelado: cualquier calidad (un 0.0 fijo también es un sensor bloqueado).
      // Saltos y outliers: solo lecturas OK.
      if (tipo === 'FUERA_DE_RANGO' && lectura.calidad === 'SOSPECHOSA') continue;
      if ((tipo === 'SALTO_BRUSCO' || tipo === 'OUTLIER_ESTADISTICO') && lectura.calidad !== 'OK') continue;
      if (tipo === 'FUERA_DE_RANGO' && lectura.calidad === 'INVALIDA') continue; // ya registrada arriba
      if (tipo === 'VALOR_CONGELADO') {
        const ultima = ultimasCongeladas.get(lectura.sensor_id);
        if (ultima && lectura.medido_en.getTime() - ultima < regla.ventana_minutos! * 60_000) continue;
      }

      const resultado = evaluar(
        lectura,
        regla,
        anteriores.get(lectura.id),
        regla.ventana_minutos != null ? stats.get(`${lectura.id}|${regla.ventana_minutos}`) : undefined,
      );
      if (!resultado) continue;

      if (tipo === 'VALOR_CONGELADO') ultimasCongeladas.set(lectura.sensor_id, lectura.medido_en.getTime());
      nuevas.push({
        etiqueta: lectura.etiqueta,
        datos: {
          ...resultado,
          sensor_id: lectura.sensor_id,
          regla_id: regla.id,
          lectura_id: lectura.id,
          lectura_medido_en: lectura.medido_en,
          tipo,
          metodo: regla.metodo,
          severidad: regla.severidad,
          parametros: { regla: regla.nombre, ...resultado.parametros },
        },
      });
    }
  }

  if (nuevas.length === 0) return { anomalias: 0, alertas_abiertas: 0, alertas_actualizadas: 0 };

  const creadas = await Anomalia.bulkCreate(nuevas.map((n) => n.datos), { returning: true });
  const alertas = await registrarAlertas(creadas.map((anomalia, i) => ({ anomalia, etiqueta: nuevas[i]!.etiqueta })));
  return { anomalias: creadas.length, alertas_abiertas: alertas.abiertas, alertas_actualizadas: alertas.actualizadas };
}
