import { QueryTypes, type CreationAttributes } from 'sequelize';
import { sequelize } from '../../config/database';
import { env } from '../../config/env';
import { Anomalia, ReglaUmbral } from '../../models';
import { registrarAlertas, resolverAlertasInactivas } from '../alertas/alertas.service';
import { reglasAplicables } from '../anomalias/anomalias.detector';

/** "45 min", "3 h 20 min", "23 días". */
function duracion(minutos: number) {
  if (minutos >= 2 * 1440) return `${Math.floor(minutos / 1440)} días`;
  if (minutos >= 60) return `${Math.floor(minutos / 60)} h ${Math.round(minutos % 60)} min`;
  return `${Math.round(minutos)} min`;
}

/**
 * SENSOR_SIN_DATOS: sensores activos (de dispositivos activos) cuya última
 * lectura es más vieja que la `ventana_minutos` de su regla. Se registra UNA
 * anomalía por hueco: si ya se reportó este mismo silencio, no se repite.
 */
async function detectarSensoresSinDatos() {
  const reglas = await ReglaUmbral.findAll({ where: { activa: true, tipo_anomalia: 'SENSOR_SIN_DATOS' } });
  if (reglas.length === 0) return [];

  const sensores = await sequelize.query<{
    id: number;
    etiqueta: string;
    tipo_sensor_id: number;
    creado_en: Date;
    ultima: Date | null;
    ya_reportado: Date | null;
  }>(
    `SELECT s.id, s.etiqueta, s.tipo_sensor_id, s.creado_en, u.ultima,
            (SELECT max(a.lectura_medido_en) FROM anomalias a
             WHERE a.sensor_id = s.id AND a.tipo = 'SENSOR_SIN_DATOS') AS ya_reportado
     FROM sensores s
     JOIN dispositivos d ON d.id = s.dispositivo_id
     LEFT JOIN LATERAL (
         SELECT l.medido_en AS ultima FROM lecturas l
         WHERE l.sensor_id = s.id ORDER BY l.medido_en DESC LIMIT 1
     ) u ON true
     WHERE s.activo AND d.activo`,
    { type: QueryTypes.SELECT },
  );

  const ahora = Date.now();
  const nuevas: { datos: CreationAttributes<Anomalia>; etiqueta: string }[] = [];

  for (const sensor of sensores) {
    // Sin lecturas nunca: se cuenta desde que se registró el sensor
    const referencia = new Date(sensor.ultima ?? sensor.creado_en);
    if (sensor.ya_reportado && new Date(sensor.ya_reportado).getTime() >= referencia.getTime()) continue;

    for (const regla of reglasAplicables(reglas, sensor)) {
      const minutos = (ahora - referencia.getTime()) / 60_000;
      const ventana = regla.ventana_minutos!;
      if (minutos <= ventana) continue;

      nuevas.push({
        etiqueta: sensor.etiqueta,
        datos: {
          sensor_id: sensor.id,
          regla_id: regla.id,
          lectura_id: null,
          lectura_medido_en: referencia,
          tipo: 'SENSOR_SIN_DATOS',
          metodo: regla.metodo,
          severidad: regla.severidad,
          valor_observado: Math.round(minutos * 10) / 10,
          valor_esperado: ventana,
          desviacion: Math.round((minutos - ventana) * 10) / 10,
          score: Math.round((minutos / ventana) * 100) / 100,
          descripcion: sensor.ultima
            ? `Sin lecturas desde hace ${duracion(minutos)} (máximo ${ventana} min). Última: ${referencia.toISOString()}`
            : `El sensor nunca ha enviado datos (registrado hace ${duracion(minutos)})`,
          parametros: { regla: regla.nombre, ventana_minutos: ventana, ultima_lectura: sensor.ultima },
        },
      });
      break; // una anomalía por sensor y hueco
    }
  }

  if (nuevas.length === 0) return [];
  const creadas = await Anomalia.bulkCreate(nuevas.map((n) => n.datos), { returning: true });
  return creadas.map((anomalia, i) => ({ anomalia, etiqueta: nuevas[i]!.etiqueta }));
}

/**
 * Una pasada de vigilancia: sensores sin datos → anomalías y alertas; luego
 * resuelve las alertas cuyo problema ya pasó.
 */
export async function ejecutarVigilancia() {
  const inicio = performance.now();
  const sinDatos = await detectarSensoresSinDatos();
  const alertas = await registrarAlertas(sinDatos);
  const resueltas = await resolverAlertasInactivas();
  return {
    sensores_sin_datos: sinDatos.length,
    alertas_abiertas: alertas.abiertas,
    alertas_actualizadas: alertas.actualizadas,
    alertas_resueltas: resueltas,
    duracion_ms: Math.round(performance.now() - inicio),
  };
}

let temporizador: NodeJS.Timeout | null = null;
let ejecutando = false;

/** Programa la vigilancia cada VIGILANCIA_INTERVALO_SEG (0 = desactivada). */
export function iniciarVigilancia() {
  if (env.VIGILANCIA_INTERVALO_SEG === 0 || temporizador) return;

  const pasada = async () => {
    if (ejecutando) return;
    ejecutando = true;
    try {
      const r = await ejecutarVigilancia();
      if (r.sensores_sin_datos || r.alertas_abiertas || r.alertas_resueltas) {
        console.log(
          `[vigilancia] sin datos: ${r.sensores_sin_datos}, alertas abiertas: ${r.alertas_abiertas}, resueltas: ${r.alertas_resueltas}`,
        );
      }
    } catch (error) {
      console.error('[vigilancia] error:', (error as Error).message);
    } finally {
      ejecutando = false;
    }
  };

  temporizador = setInterval(pasada, env.VIGILANCIA_INTERVALO_SEG * 1000);
  setTimeout(pasada, 5_000).unref();
  console.log(`Vigilancia activa cada ${env.VIGILANCIA_INTERVALO_SEG} s`);
}

export function detenerVigilancia() {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}
