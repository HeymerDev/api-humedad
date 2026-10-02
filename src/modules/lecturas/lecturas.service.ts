import { Op, QueryTypes, type WhereOptions } from 'sequelize';
import { sequelize } from '../../config/database';
import { Dispositivo, Lectura, LoteEnvio, Sensor, type CalidadLectura, type ErrorLectura } from '../../models';
import { aEpoch } from '../../utils/fechas';
import { HttpError } from '../../utils/http-error';
import { buscarDispositivo } from '../dispositivos/dispositivos.service';
import { esquemaLectura, type EntradaLote, type FiltrosLecturas } from './lecturas.schemas';

const MINUTO = 60_000;
const DIA = 24 * 60 * MINUTO;
/** Tolerancia de reloj del ESP32 hacia el futuro. */
const MAX_ADELANTO_MS = 5 * MINUTO;
/** Antigüedad máxima aceptada (lecturas acumuladas en el buffer). */
const MAX_ATRASO_MS = 30 * DIA;
const MAX_RANGO_CONSULTA_MS = 31 * DIA;

interface FilaLectura {
  indice: number;
  sensor_id: number;
  etiqueta: string;
  medido_en: Date;
  valor: number;
  valor_crudo: number;
  calidad: CalidadLectura;
  observacion: string | null;
}

/** valor = crudo * escala + offset (redondeado para no arrastrar ruido de coma flotante). */
function calibrar(crudo: number, sensor: Sensor) {
  const { escala_calibracion: escala, offset_calibracion: offset } = sensor;
  if (escala === 1 && offset === 0) return crudo;
  return Math.round((crudo * escala + offset) * 1e6) / 1e6;
}

/**
 * Calidad de la lectura. Las INVALIDA y SOSPECHOSA se guardan igual (sirven
 * para auditar el sensor), pero la analítica solo usa las OK.
 */
function evaluarCalidad(valor: number, crudo: number, sensor: Sensor): { calidad: CalidadLectura; observacion: string | null } {
  const tipo = sensor.tipo_sensor!;
  if (valor < tipo.rango_min || valor > tipo.rango_max) {
    return {
      calidad: 'INVALIDA',
      observacion: `Fuera del rango físico del sensor (${tipo.rango_min} a ${tipo.rango_max} ${tipo.unidad})`,
    };
  }
  // El firmware del DS18B20 reporta exactamente 0.0 cuando el sensor no responde
  if (tipo.codigo === 'DS18B20_TEMP' && crudo === 0) {
    return { calidad: 'SOSPECHOSA', observacion: 'El DS18B20 reporta 0.0 cuando no responde' };
  }
  return { calidad: 'OK', observacion: null };
}

/**
 * Registra un lote enviado por el ESP32 (POST /api/v1/lecturas).
 *
 * Una lectura mala no tumba el lote: se rechaza con su motivo y el resto se
 * guarda. Las que ya existían (mismo sensor y medido_en, típico de un
 * reintento) se descartan con ON CONFLICT DO NOTHING y se informan como
 * duplicadas. Todo ocurre en una transacción.
 */
export async function ingerirLote(entrada: EntradaLote) {
  const inicio = performance.now();
  const ahora = new Date();

  const dispositivo = await Dispositivo.findOne({ where: { codigo: entrada.dispositivo } });
  if (!dispositivo) {
    throw HttpError.notFound(`Dispositivo no registrado: ${entrada.dispositivo}. Créalo con POST /api/v1/dispositivos`);
  }
  if (!dispositivo.activo) throw HttpError.conflict(`El dispositivo ${dispositivo.codigo} está desactivado`);

  const sensores = await Sensor.findAll({ where: { dispositivo_id: dispositivo.id }, include: ['tipo_sensor'] });
  const porEtiqueta = new Map(sensores.map((s) => [s.etiqueta, s]));

  const errores: ErrorLectura[] = [];
  const filas: FilaLectura[] = [];
  const vistas = new Set<string>();

  entrada.lecturas.forEach((cruda, indice) => {
    const rechazar = (motivo: string, sensor?: string) => errores.push({ indice, sensor, motivo });
    const etiquetaCruda = (cruda as { sensor?: unknown } | null)?.sensor;
    const etiquetaInformada = typeof etiquetaCruda === 'string' ? etiquetaCruda : undefined;

    const resultado = esquemaLectura.safeParse(cruda);
    if (!resultado.success) {
      return rechazar(resultado.error.issues.map((i) => i.message).join('; '), etiquetaInformada);
    }
    const { sensor: etiqueta, valor: crudo, medido_en = ahora } = resultado.data;

    const sensor = porEtiqueta.get(etiqueta);
    if (!sensor) return rechazar(`Sensor no registrado en ${dispositivo.codigo}`, etiqueta);
    if (!sensor.activo) return rechazar('Sensor desactivado', etiqueta);
    if (medido_en.getTime() > ahora.getTime() + MAX_ADELANTO_MS) {
      return rechazar('medido_en está en el futuro: revisa el reloj (NTP) del ESP32', etiqueta);
    }
    if (medido_en.getTime() < ahora.getTime() - MAX_ATRASO_MS) {
      return rechazar('medido_en tiene más de 30 días: ¿el reloj (NTP) no estaba sincronizado?', etiqueta);
    }

    const clave = `${sensor.id}|${medido_en.getTime()}`;
    if (vistas.has(clave)) return rechazar('Lectura repetida dentro del mismo lote', etiqueta);
    vistas.add(clave);

    const valor = calibrar(crudo, sensor);
    filas.push({ indice, sensor_id: sensor.id, etiqueta, medido_en, valor, valor_crudo: crudo, ...evaluarCalidad(valor, crudo, sensor) });
  });

  return sequelize.transaction(async (transaction) => {
    const lote = await LoteEnvio.create(
      {
        dispositivo_id: dispositivo.id,
        origen: entrada.origen,
        intento: entrada.intento,
        enviado_en: entrada.enviado_en ?? null,
        lecturas_recibidas: entrada.lecturas.length,
        lecturas_aceptadas: filas.length,
        lecturas_rechazadas: errores.length,
      },
      { transaction },
    );

    const insertadas = filas.length
      ? await sequelize.query<{ id: number; sensor_id: number; medido_en: Date }>(
          `INSERT INTO lecturas (sensor_id, medido_en, valor, valor_crudo, calidad, observacion, lote_id)
           SELECT sensor_id, medido_en, valor, valor_crudo, calidad, observacion, lote_id
           FROM jsonb_to_recordset($1::jsonb) AS x (
               sensor_id int, medido_en timestamptz, valor float8, valor_crudo float8,
               calidad text, observacion text, lote_id bigint)
           ON CONFLICT (sensor_id, medido_en) DO NOTHING
           RETURNING id, sensor_id, medido_en`,
          {
            bind: [JSON.stringify(filas.map(({ indice: _i, etiqueta: _e, ...fila }) => ({ ...fila, lote_id: lote.id })))],
            type: QueryTypes.SELECT,
            transaction,
          },
        )
      : [];

    // Las que no volvieron en RETURNING ya existían: reenvío de un lote anterior
    const guardadas = new Set(insertadas.map((l) => `${l.sensor_id}|${new Date(l.medido_en).getTime()}`));
    const duplicadas = filas.filter((f) => !guardadas.has(`${f.sensor_id}|${f.medido_en.getTime()}`));
    for (const f of duplicadas) {
      errores.push({ indice: f.indice, sensor: f.etiqueta, motivo: 'Ya estaba registrada (reenvío de un lote anterior)' });
    }
    errores.sort((a, b) => a.indice - b.indice);

    const duracion_ms = Math.round(performance.now() - inicio);
    await lote.update(
      {
        lecturas_aceptadas: insertadas.length,
        lecturas_rechazadas: errores.length,
        errores: errores.length ? errores : null,
        duracion_ms,
      },
      { transaction },
    );
    await dispositivo.update({ ultima_conexion: ahora }, { transaction });

    const porCalidad = (calidad: CalidadLectura) =>
      filas.filter((f) => f.calidad === calidad && guardadas.has(`${f.sensor_id}|${f.medido_en.getTime()}`)).length;

    return {
      lote_id: lote.id,
      recibidas: entrada.lecturas.length,
      aceptadas: insertadas.length,
      rechazadas: errores.length,
      duplicadas: duplicadas.length,
      invalidas: porCalidad('INVALIDA'),
      sospechosas: porCalidad('SOSPECHOSA'),
      hora_servidor: aEpoch(ahora),
      duracion_ms,
      ...(errores.length ? { errores } : {}),
    };
  });
}

/** GET /api/v1/lecturas: siempre acotado en el tiempo para aprovechar los chunks. */
export async function listarLecturas(filtros: FiltrosLecturas) {
  const hasta = filtros.hasta ?? new Date();
  const desde = filtros.desde ?? new Date(hasta.getTime() - DIA);
  if (desde >= hasta) throw HttpError.badRequest('desde debe ser anterior a hasta');
  if (hasta.getTime() - desde.getTime() > MAX_RANGO_CONSULTA_MS) {
    throw HttpError.badRequest('El rango máximo es de 31 días: para más datos usa KNIME o la vista v_lecturas_detalle');
  }

  const where: WhereOptions = { medido_en: { [Op.gte]: desde, [Op.lt]: hasta } };
  if (filtros.sensor_id) Object.assign(where, { sensor_id: filtros.sensor_id });
  if (filtros.calidad) Object.assign(where, { calidad: filtros.calidad });

  const dispositivo = filtros.dispositivo ? await buscarDispositivo(filtros.dispositivo) : null;

  const { rows, count } = await Lectura.findAndCountAll({
    where,
    include: [
      {
        association: 'sensor',
        attributes: ['id', 'etiqueta', 'dispositivo_id'],
        where: dispositivo ? { dispositivo_id: dispositivo.id } : undefined,
        required: true,
      },
    ],
    order: [['medido_en', filtros.orden.toUpperCase()]],
    limit: filtros.limit,
    offset: filtros.offset,
  });

  return { rows, count, rango: { desde, hasta } };
}
