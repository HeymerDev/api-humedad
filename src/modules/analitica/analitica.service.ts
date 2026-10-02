import { QueryTypes } from 'sequelize';
import { pingBaseDatos, sequelize } from '../../config/database';
import { env } from '../../config/env';
import { Alerta, EstadoConexion, LoteEnvio, SEVERIDADES, type Dispositivo, type Sensor } from '../../models';
import { abreviar, num, unidadLcd } from '../../utils/lcd';
import { SQL_INICIO_DIA, hace, horaLocal } from '../../utils/tiempo';

/**
 * Analítica de las 7 opciones del menú del teclado. Cada función devuelve
 * `data` (JSON completo) y `bloques` (líneas para el LCD, un bloque por sensor).
 *
 * Reglas comunes:
 *  - Solo se usan lecturas con calidad OK (salvo el valor actual, que muestra
 *    la última lectura e indica su calidad).
 *  - Toda agregación filtra por `medido_en` para que TimescaleDB descarte los
 *    chunks que no están en la ventana (chunk exclusion).
 */

export interface Contexto {
  dispositivo: Dispositivo;
  /** Sensores activos con su tipo. */
  sensores: Sensor[];
}

export interface Resultado {
  data: Record<string, unknown>;
  bloques: string[][];
}

const ahoraSeg = () => Date.now() / 1000;
const ids = (ctx: Contexto) => (ctx.sensores.length ? ctx.sensores.map((s) => s.id) : [0]);
const info = (s: Sensor) => ({
  sensor_id: s.id,
  etiqueta: s.etiqueta,
  magnitud: s.tipo_sensor!.magnitud,
  unidad: s.tipo_sensor!.unidad,
});
const etiquetaLcd = (s: Sensor) => abreviar(s.etiqueta);
const u = (s: Sensor) => unidadLcd(s.tipo_sensor!.unidad);

async function consultar<T extends object>(sql: string, replacements: Record<string, unknown>) {
  return sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT });
}

// ---------------------------------------------------------------------
// 1 · Valor actual de cada sensor (tiempo real)
// ---------------------------------------------------------------------
export async function valoresActuales(ctx: Contexto): Promise<Resultado> {
  // ORDER BY medido_en DESC LIMIT 1: TimescaleDB recorre los chunks del más
  // nuevo al más viejo y se detiene en la primera fila (ordered append).
  const filas = await consultar<{ sensor_id: number; valor: number | null; calidad: string | null; medido_en: Date | null }>(
    `SELECT s.id AS sensor_id, u.valor, u.calidad, u.medido_en
     FROM sensores s
     LEFT JOIN LATERAL (
         SELECT l.valor, l.calidad, l.medido_en FROM lecturas l
         WHERE l.sensor_id = s.id ORDER BY l.medido_en DESC LIMIT 1
     ) u ON true
     WHERE s.id IN (:ids)`,
    { ids: ids(ctx) },
  );
  const porSensor = new Map(filas.map((f) => [f.sensor_id, f]));

  const sensores = ctx.sensores.map((s) => {
    const f = porSensor.get(s.id);
    const antiguedad = f?.medido_en ? Math.round(ahoraSeg() - new Date(f.medido_en).getTime() / 1000) : null;
    return { ...info(s), valor: f?.valor ?? null, calidad: f?.calidad ?? null, medido_en: f?.medido_en ?? null, antiguedad_s: antiguedad };
  });

  const bloques = sensores.map((x, i) => {
    const s = ctx.sensores[i]!;
    if (x.valor == null) return [`${etiquetaLcd(s)} sin datos`];
    const marca = x.calidad === 'OK' ? '' : '?';
    return [`${etiquetaLcd(s)} ${num(x.valor)}${u(s)}${marca}`, `hace ${hace(x.antiguedad_s!)} ${x.calidad}`];
  });
  return { data: { sensores }, bloques };
}

// ---------------------------------------------------------------------
// 2 · Promedio de la última hora
// ---------------------------------------------------------------------
export async function promedioHora(ctx: Contexto, minutos: number): Promise<Resultado> {
  const reemplazos = { ids: ids(ctx), minutos };
  const [resumen, serie] = await Promise.all([
    consultar<{ sensor_id: number; n: number; media: number; minimo: number; maximo: number }>(
      `SELECT sensor_id, count(*)::int AS n, avg(valor) AS media, min(valor) AS minimo, max(valor) AS maximo
       FROM lecturas
       WHERE sensor_id IN (:ids) AND calidad = 'OK' AND medido_en >= now() - make_interval(mins => :minutos)
       GROUP BY sensor_id`,
      reemplazos,
    ),
    // Serie en tramos de 10 min con time_bucket (función de TimescaleDB)
    consultar<{ tramo: Date; sensor_id: number; media: number; n: number }>(
      `SELECT time_bucket(INTERVAL '10 minutes', medido_en) AS tramo, sensor_id, avg(valor) AS media, count(*)::int AS n
       FROM lecturas
       WHERE sensor_id IN (:ids) AND calidad = 'OK' AND medido_en >= now() - make_interval(mins => :minutos)
       GROUP BY tramo, sensor_id
       ORDER BY tramo`,
      reemplazos,
    ),
  ]);
  const porSensor = new Map(resumen.map((r) => [r.sensor_id, r]));

  const sensores = ctx.sensores.map((s) => {
    const r = porSensor.get(s.id);
    return {
      ...info(s),
      muestras: r?.n ?? 0,
      promedio: r?.media ?? null,
      minimo: r?.minimo ?? null,
      maximo: r?.maximo ?? null,
      serie_10min: serie.filter((p) => p.sensor_id === s.id).map((p) => ({ tramo: p.tramo, promedio: p.media, muestras: p.n })),
    };
  });

  const bloques = sensores.map((x, i) => {
    const s = ctx.sensores[i]!;
    if (!x.muestras) return [`${etiquetaLcd(s)} sin datos`, `en ${minutos} min`];
    return [`${etiquetaLcd(s)} ${num(x.promedio)}${u(s)}`, `prom ${minutos}m n=${x.muestras}`];
  });
  return { data: { ventana_minutos: minutos, sensores }, bloques };
}

// ---------------------------------------------------------------------
// 3 · Máximo y mínimo del día (zona horaria APP_TIMEZONE)
// ---------------------------------------------------------------------
export async function extremosDia(ctx: Contexto, fecha: string | null): Promise<Resultado> {
  const filas = await consultar<{
    sensor_id: number;
    n: number;
    maximo: number;
    minimo: number;
    hora_maximo: Date;
    hora_minimo: Date;
    inicio: Date;
  }>(
    `WITH dia AS (SELECT ${SQL_INICIO_DIA} AS inicio)
     SELECT l.sensor_id, count(*)::int AS n, max(l.valor) AS maximo, min(l.valor) AS minimo,
            (array_agg(l.medido_en ORDER BY l.valor DESC, l.medido_en))[1] AS hora_maximo,
            (array_agg(l.medido_en ORDER BY l.valor ASC, l.medido_en))[1] AS hora_minimo,
            min(dia.inicio) AS inicio
     FROM lecturas l, dia
     WHERE l.sensor_id IN (:ids) AND l.calidad = 'OK'
       AND l.medido_en >= dia.inicio AND l.medido_en < dia.inicio + INTERVAL '1 day'
     GROUP BY l.sensor_id`,
    { ids: ids(ctx), fecha, tz: env.APP_TIMEZONE },
  );
  const porSensor = new Map(filas.map((f) => [f.sensor_id, f]));

  const sensores = ctx.sensores.map((s) => {
    const f = porSensor.get(s.id);
    return {
      ...info(s),
      muestras: f?.n ?? 0,
      maximo: f?.maximo ?? null,
      hora_maximo: f ? horaLocal(f.hora_maximo) : null,
      minimo: f?.minimo ?? null,
      hora_minimo: f ? horaLocal(f.hora_minimo) : null,
      rango: f ? f.maximo - f.minimo : null,
    };
  });

  const bloques = sensores.map((x, i) => {
    const s = ctx.sensores[i]!;
    if (!x.muestras) return [`${etiquetaLcd(s)} sin datos`, fecha ? fecha : 'hoy'];
    return [`${etiquetaLcd(s)} Mx${num(x.maximo)}${u(s)}`, `Mn${num(x.minimo)}${u(s)} R${num(x.rango)}`];
  });
  return { data: { fecha: fecha ?? 'hoy', zona_horaria: env.APP_TIMEZONE, sensores }, bloques };
}

// ---------------------------------------------------------------------
// 4 · Desviación estándar y tendencia (regresión lineal)
// ---------------------------------------------------------------------
export async function tendencia(ctx: Contexto, minutos: number): Promise<Resultado> {
  const filas = await consultar<{ sensor_id: number; n: number; media: number; desv: number | null; pendiente_hora: number | null; r2: number | null }>(
    `SELECT sensor_id, count(*)::int AS n, avg(valor) AS media, stddev_samp(valor) AS desv,
            regr_slope(valor, extract(epoch FROM medido_en)) * 3600 AS pendiente_hora,
            regr_r2(valor, extract(epoch FROM medido_en)) AS r2
     FROM lecturas
     WHERE sensor_id IN (:ids) AND calidad = 'OK' AND medido_en >= now() - make_interval(mins => :minutos)
     GROUP BY sensor_id`,
    { ids: ids(ctx), minutos },
  );
  const porSensor = new Map(filas.map((f) => [f.sensor_id, f]));

  const sensores = ctx.sensores.map((s) => {
    const f = porSensor.get(s.id);
    // Estable si el cambio estimado en la ventana es menor que la precisión del sensor
    const umbral = s.tipo_sensor!.precision ?? 0.1;
    const cambio = f?.pendiente_hora != null ? (f.pendiente_hora * minutos) / 60 : null;
    const direccion = cambio == null ? null : Math.abs(cambio) < umbral ? 'ESTABLE' : cambio > 0 ? 'SUBIENDO' : 'BAJANDO';
    return {
      ...info(s),
      muestras: f?.n ?? 0,
      promedio: f?.media ?? null,
      desviacion_estandar: f?.desv ?? null,
      coef_variacion_pct: f?.desv != null && f.media ? (f.desv / Math.abs(f.media)) * 100 : null,
      pendiente_por_hora: f?.pendiente_hora ?? null,
      cambio_en_ventana: cambio,
      r2: f?.r2 ?? null,
      tendencia: direccion,
    };
  });

  const texto = { SUBIENDO: 'Sube', BAJANDO: 'Baja', ESTABLE: 'Estable' } as const;
  const bloques = sensores.map((x, i) => {
    const s = ctx.sensores[i]!;
    if (x.muestras < 3 || x.tendencia == null) return [`${etiquetaLcd(s)} sin datos`, `en ${minutos} min`];
    const signo = x.pendiente_por_hora! > 0 ? '+' : '';
    return [
      `${etiquetaLcd(s)} s=${num(x.desviacion_estandar, 2)}`,
      x.tendencia === 'ESTABLE' ? `Estable ${num(x.pendiente_por_hora, 2)}/h` : `${texto[x.tendencia as keyof typeof texto]} ${signo}${num(x.pendiente_por_hora, 2)}${u(s)}/h`,
    ];
  });
  return { data: { ventana_minutos: minutos, sensores }, bloques };
}

// ---------------------------------------------------------------------
// 5 · Detección de valores atípicos (Z-score e IQR)
// ---------------------------------------------------------------------
export async function outliers(ctx: Contexto, minutos: number, z: number, k: number): Promise<Resultado> {
  const reemplazos = { ids: ids(ctx), minutos, z, k };
  const [filas, detectadas] = await Promise.all([
    consultar<{
      sensor_id: number;
      n: number;
      media: number;
      desv: number | null;
      q1: number;
      q3: number;
      outliers_z: number;
      outliers_iqr: number;
      ejemplos: { valor: number; medido_en: string }[] | null;
    }>(
      `WITH v AS (
           SELECT sensor_id, valor, medido_en FROM lecturas
           WHERE sensor_id IN (:ids) AND calidad = 'OK' AND medido_en >= now() - make_interval(mins => :minutos)
       ),
       st AS (
           SELECT sensor_id, count(*)::int AS n, avg(valor) AS media, stddev_samp(valor) AS desv,
                  percentile_cont(0.25) WITHIN GROUP (ORDER BY valor) AS q1,
                  percentile_cont(0.75) WITHIN GROUP (ORDER BY valor) AS q3
           FROM v GROUP BY sensor_id
       ),
       marcadas AS (
           SELECT v.*, st.media,
                  (st.desv > 0 AND abs(v.valor - st.media) / st.desv > :z) AS es_z,
                  (st.q3 > st.q1 AND (v.valor < st.q1 - :k * (st.q3 - st.q1) OR v.valor > st.q3 + :k * (st.q3 - st.q1))) AS es_iqr
           FROM v JOIN st USING (sensor_id)
       )
       SELECT st.*,
              (SELECT count(*)::int FROM marcadas m WHERE m.sensor_id = st.sensor_id AND m.es_z) AS outliers_z,
              (SELECT count(*)::int FROM marcadas m WHERE m.sensor_id = st.sensor_id AND m.es_iqr) AS outliers_iqr,
              (SELECT json_agg(json_build_object('valor', e.valor, 'medido_en', e.medido_en))
               FROM (SELECT valor, medido_en FROM marcadas m
                     WHERE m.sensor_id = st.sensor_id AND (m.es_z OR m.es_iqr)
                     ORDER BY abs(m.valor - m.media) DESC LIMIT 5) e) AS ejemplos
       FROM st`,
      reemplazos,
    ),
    // Las que el detector registró en tiempo real en la misma ventana
    consultar<{ sensor_id: number; n: number }>(
      `SELECT sensor_id, count(*)::int AS n FROM anomalias
       WHERE sensor_id IN (:ids) AND tipo = 'OUTLIER_ESTADISTICO'
         AND lectura_medido_en >= now() - make_interval(mins => :minutos)
       GROUP BY sensor_id`,
      reemplazos,
    ),
  ]);
  const porSensor = new Map(filas.map((f) => [f.sensor_id, f]));
  const registradas = new Map(detectadas.map((d) => [d.sensor_id, d.n]));

  const sensores = ctx.sensores.map((s) => {
    const f = porSensor.get(s.id);
    const iqr = f ? f.q3 - f.q1 : null;
    return {
      ...info(s),
      muestras: f?.n ?? 0,
      zscore: {
        umbral: z,
        limites: f?.desv ? [f.media - z * f.desv, f.media + z * f.desv] : null,
        outliers: f?.outliers_z ?? 0,
      },
      iqr: {
        k,
        q1: f?.q1 ?? null,
        q3: f?.q3 ?? null,
        limites: f && iqr ? [f.q1 - k * iqr, f.q3 + k * iqr] : null,
        outliers: f?.outliers_iqr ?? 0,
      },
      anomalias_registradas: registradas.get(s.id) ?? 0,
      ejemplos: f?.ejemplos ?? [],
    };
  });

  const bloques = sensores.map((x, i) => {
    const s = ctx.sensores[i]!;
    if (!x.muestras) return [`${etiquetaLcd(s)} sin datos`, `en ${minutos} min`];
    return [`${etiquetaLcd(s)} n=${x.muestras}`, `Z:${x.zscore.outliers} IQR:${x.iqr.outliers}`];
  });
  return { data: { ventana_minutos: minutos, sensores }, bloques };
}

// ---------------------------------------------------------------------
// 6 · Conteo de alertas activas
// ---------------------------------------------------------------------
export async function alertasActivas(ctx: Contexto): Promise<Resultado> {
  const activas = await Alerta.findAll({
    where: { sensor_id: ids(ctx), estado: ['ABIERTA', 'RECONOCIDA'] },
    order: [['ultima_ocurrencia_en', 'DESC']],
  });
  const porSeveridad = Object.fromEntries(SEVERIDADES.map((sev) => [sev, activas.filter((a) => a.severidad === sev).length]));
  const etiquetas = new Map(ctx.sensores.map((s) => [s.id, s.etiqueta]));
  const prioridad = (a: Alerta) => -SEVERIDADES.indexOf(a.severidad);
  const principales = [...activas].sort((a, b) => prioridad(a) - prioridad(b)).slice(0, 5);

  const tipoCorto: Record<string, string> = {
    FUERA_DE_RANGO: 'rango',
    SALTO_BRUSCO: 'salto',
    OUTLIER_ESTADISTICO: 'atipico',
    VALOR_CONGELADO: 'congelado',
    SENSOR_SIN_DATOS: 'sin datos',
  };
  const bloques: string[][] = [
    [`Alertas: ${activas.length}`, `C${porSeveridad.CRITICA} A${porSeveridad.ALTA} M${porSeveridad.MEDIA} B${porSeveridad.BAJA}`],
    ...principales.map((a) => [
      `${abreviar(etiquetas.get(a.sensor_id) ?? '?')} ${tipoCorto[a.tipo]}`,
      `${a.severidad} x${a.ocurrencias}`,
    ]),
  ];

  return {
    data: {
      total: activas.length,
      abiertas: activas.filter((a) => a.estado === 'ABIERTA').length,
      reconocidas: activas.filter((a) => a.estado === 'RECONOCIDA').length,
      por_severidad: porSeveridad,
      principales: principales.map((a) => ({
        id: a.id,
        titulo: a.titulo,
        tipo: a.tipo,
        severidad: a.severidad,
        estado: a.estado,
        ocurrencias: a.ocurrencias,
        ultima_ocurrencia_en: a.ultima_ocurrencia_en,
      })),
    },
    bloques,
  };
}

// ---------------------------------------------------------------------
// 7 · Estado de conexión a la nube
// ---------------------------------------------------------------------
export async function estadoConexion(ctx: Contexto): Promise<Resultado> {
  const { dispositivo } = ctx;
  const [latenciaMs, latido, lote] = await Promise.all([
    pingBaseDatos(),
    EstadoConexion.findOne({ where: { dispositivo_id: dispositivo.id }, order: [['registrado_en', 'DESC']] }),
    LoteEnvio.findOne({ where: { dispositivo_id: dispositivo.id }, order: [['recibido_en', 'DESC']] }),
  ]);

  const segundos = dispositivo.ultima_conexion
    ? Math.round(ahoraSeg() - new Date(dispositivo.ultima_conexion).getTime() / 1000)
    : null;
  const estado = segundos != null && segundos <= env.DISPOSITIVO_OFFLINE_SEG ? 'ONLINE' : 'OFFLINE';

  const bloques = [
    [`Nube OK ${latenciaMs}ms`, `ESP ${estado} ${segundos != null ? hace(segundos) : '--'}`],
    [
      latido?.rssi_dbm != null ? `WiFi ${latido.rssi_dbm}dBm` : 'WiFi --',
      `Buffer ${latido?.lecturas_en_buffer ?? 0} Fall ${latido?.envios_fallidos ?? 0}`,
    ],
  ];

  return {
    data: {
      api: 'OK',
      base_datos: { estado: 'OK', latencia_ms: latenciaMs },
      dispositivo: {
        codigo: dispositivo.codigo,
        estado,
        ultima_conexion: dispositivo.ultima_conexion,
        segundos_desde_ultima_conexion: segundos,
        umbral_offline_s: env.DISPOSITIVO_OFFLINE_SEG,
      },
      ultimo_latido: latido
        ? {
            registrado_en: latido.registrado_en,
            rssi_dbm: latido.rssi_dbm,
            lecturas_en_buffer: latido.lecturas_en_buffer,
            reconexiones_wifi: latido.reconexiones_wifi,
            envios_fallidos: latido.envios_fallidos,
            ntp_sincronizado: latido.ntp_sincronizado,
            uptime_s: latido.uptime_s,
          }
        : null,
      ultimo_lote: lote
        ? { id: lote.id, recibido_en: lote.recibido_en, origen: lote.origen, aceptadas: lote.lecturas_aceptadas }
        : null,
    },
    bloques,
  };
}
