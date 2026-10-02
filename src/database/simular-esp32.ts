import { parseArgs } from 'node:util';
import { sequelize } from '../config/database';
import { env } from '../config/env';

/**
 * Simulador del ESP32: se comporta como el firmware real contra la API.
 *
 *   npm run simular                                  lote cada 20 s + latido cada 60 s
 *   npm run simular -- --intervalo 2 --latido 10     modo rápido para probar
 *   npm run simular -- --historico 120               primero rellena 2 h hacia atrás (BUFFER)
 *   npm run simular -- --historico 90 --congelar temperatura_agua --ciclos 1
 *   npm run simular -- --limpiar                     borra esp32_sim con sus lecturas, lotes y alertas
 *
 * Usa su propio dispositivo (esp32_sim) para no mezclar datos simulados con
 * los de la estación real esp32_01, que alimentan KNIME y FlowiseAI.
 */

const { values: op } = parseArgs({
  options: {
    url: { type: 'string', default: `http://localhost:${env.PORT}` },
    dispositivo: { type: 'string', default: 'esp32_sim' },
    intervalo: { type: 'string', default: '20' },
    latido: { type: 'string', default: '60' },
    ciclos: { type: 'string', default: '0' },
    historico: { type: 'string', default: '0' },
    congelar: { type: 'string' },
    'prob-anomalia': { type: 'string', default: '0.05' },
    'prob-corte': { type: 'string', default: '0.02' },
    limpiar: { type: 'boolean', default: false },
    forzar: { type: 'boolean', default: false },
    ayuda: { type: 'boolean', short: 'h', default: false },
  },
});

const API = `${op.url.replace(/\/$/, '')}/api/v1`;
const DISPOSITIVO = op.dispositivo;
const INTERVALO_S = Number(op.intervalo);
const LATIDO_S = Number(op.latido);
const CICLOS = Number(op.ciclos);
const HISTORICO_MIN = Number(op.historico);
const PROB_ANOMALIA = Number(op['prob-anomalia']);
const PROB_CORTE = Number(op['prob-corte']);
const MAX_POR_LOTE = 498; // múltiplo de 3 sensores, bajo el tope de 500 de la API
const ESTACION_REAL = 'esp32_01';

interface SensorSimulado {
  etiqueta: string;
  tipo: string;
  nombre: string;
  base: number;
  /** Variación diaria (máximo a las 15:00). */
  amplitud: number;
  ruido: number;
  decimales: number;
}

const SENSORES: SensorSimulado[] = [
  { etiqueta: 'temperatura_aire', tipo: 'DHT22_TEMP', nombre: 'Temperatura del aire (simulada)', base: 23, amplitud: 3, ruido: 0.12, decimales: 1 },
  { etiqueta: 'humedad_aire', tipo: 'DHT22_HUM', nombre: 'Humedad del aire (simulada)', base: 62, amplitud: -8, ruido: 0.5, decimales: 1 },
  { etiqueta: 'temperatura_agua', tipo: 'DS18B20_TEMP', nombre: 'Temperatura del agua (simulada)', base: 19.5, amplitud: 1, ruido: 0.05, decimales: 2 },
];

type Lectura = { sensor: string; valor: number | null; medido_en: number };

const ahoraEpoch = () => Math.floor(Date.now() / 1000);
const hora = () => new Date().toLocaleTimeString('es-CO', { hour12: false });
const azar = (min: number, max: number) => min + Math.random() * (max - min);
/** Ruido gaussiano (Box-Muller). */
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

const valoresCongelados = new Map<string, number>();

function valorEn(sensor: SensorSimulado, epoch: number) {
  const congelado = valoresCongelados.get(sensor.etiqueta);
  if (congelado !== undefined) return congelado;
  const horaDelDia = ((epoch / 3600) % 24) - 5; // hora de Bogotá (UTC-5)
  const ciclo = Math.sin((2 * Math.PI * (horaDelDia - 9)) / 24);
  const valor = sensor.base + sensor.amplitud * ciclo + gauss() * sensor.ruido;
  return Number(valor.toFixed(sensor.decimales));
}

function generarCiclo(epoch: number): Lectura[] {
  return SENSORES.map((s) => ({ sensor: s.etiqueta, valor: valorEn(s, epoch), medido_en: epoch }));
}

/** Altera una lectura del ciclo para provocar una anomalía. Devuelve su descripción. */
function inyectarAnomalia(lecturas: Lectura[]): string {
  const por = (etiqueta: string) => lecturas.find((l) => l.sensor === etiqueta)!;
  const casos: [string, () => void][] = [
    ['salto +6 °C en temperatura_aire', () => (por('temperatura_aire').valor! += 6)],
    ['temperatura_aire 47.5 °C (fuera de 0..45)', () => (por('temperatura_aire').valor = 47.5)],
    ['humedad_aire 130 % (fuera del rango físico)', () => (por('humedad_aire').valor = 130)],
    ['DHT22 devolvió NaN (null)', () => (por('temperatura_aire').valor = null)],
    ['DS18B20 sin respuesta (0.0)', () => (por('temperatura_agua').valor = 0)],
  ];
  const [descripcion, aplicar] = casos[Math.floor(Math.random() * casos.length)]!;
  aplicar();
  return descripcion;
}

async function api<T = any>(metodo: string, ruta: string, cuerpo?: unknown): Promise<{ status: number; json: T }> {
  const respuesta = await fetch(API + ruta, {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(15_000),
  });
  const texto = await respuesta.text();
  return { status: respuesta.status, json: texto ? JSON.parse(texto) : null };
}

/** Crea el dispositivo simulado y sus sensores si no existen. */
async function prepararDispositivo() {
  let r = await api('GET', `/dispositivos/${DISPOSITIVO}`);
  if (r.status === 404) {
    r = await api('POST', '/dispositivos', {
      codigo: DISPOSITIVO,
      nombre: `Simulador ${DISPOSITIVO}`,
      descripcion: 'Dispositivo creado por npm run simular (datos de prueba)',
      version_firmware: 'sim-1.0',
    });
    if (r.status !== 201) throw new Error(`No se pudo crear ${DISPOSITIVO}: ${JSON.stringify(r.json)}`);
    console.log(`Dispositivo ${DISPOSITIVO} creado`);
  } else if (r.status !== 200) {
    throw new Error(`La API respondió ${r.status} al buscar ${DISPOSITIVO}: ¿está corriendo en ${op.url}?`);
  }
  const dispositivoId = r.json.data.id as number;

  const existentes = new Set(
    ((await api('GET', `/dispositivos/${DISPOSITIVO}/sensores`)).json.data as { etiqueta: string }[]).map((s) => s.etiqueta),
  );
  for (const s of SENSORES.filter((s) => !existentes.has(s.etiqueta))) {
    const tipo = await api('GET', `/tipos-sensor/${s.tipo}`);
    if (tipo.status !== 200) throw new Error(`Falta el tipo ${s.tipo}: ejecuta npm run db:seed`);
    const creado = await api('POST', '/sensores', {
      etiqueta: s.etiqueta,
      nombre: s.nombre,
      dispositivo_id: dispositivoId,
      tipo_sensor_id: tipo.json.data.id,
    });
    if (creado.status !== 201) throw new Error(`No se pudo crear el sensor ${s.etiqueta}: ${JSON.stringify(creado.json)}`);
    console.log(`Sensor ${s.etiqueta} creado`);
  }
}

const estado = { buffer: [] as Lectura[], reconexiones: 0, enviosFallidos: 0, corteRestante: 0, inicio: Date.now(), enviados: 0, anomalias: 0 };

/** Envía un lote como el firmware: hasta 3 intentos; si fallan, vuelve al buffer. */
async function enviarLote(lecturas: Lectura[], origen: 'TIEMPO_REAL' | 'BUFFER', etiqueta = '') {
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const r = await api('POST', '/lecturas', { dispositivo: DISPOSITIVO, origen, intento, enviado_en: ahoraEpoch(), lecturas });
      if (r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (r.status !== 201) {
        // 4xx: reintentar no sirve (el firmware descarta el lote)
        console.log(`${hora()} lote rechazado ${r.status}: ${JSON.stringify(r.json?.error)}`);
        return;
      }
      const d = r.json.data;
      estado.enviados += d.aceptadas;
      estado.anomalias += d.anomalias ?? 0;
      const detalle = [
        `${d.aceptadas} ok`,
        d.rechazadas ? `${d.rechazadas} rech` : '',
        d.duplicadas ? `${d.duplicadas} dup` : '',
        d.anomalias ? `${d.anomalias} anom` : '',
        d.alertas_abiertas ? `${d.alertas_abiertas} alerta nueva` : '',
      ].filter(Boolean);
      console.log(`${hora()} ${origen === 'BUFFER' ? 'BUFFER ' : ''}lote ${d.lote_id}: ${detalle.join(' · ')} (${d.duracion_ms} ms)${etiqueta ? `  ← ${etiqueta}` : ''}`);
      return;
    } catch (error) {
      console.log(`${hora()} intento ${intento} falló: ${(error as Error).message}`);
    }
  }
  estado.enviosFallidos++;
  estado.buffer.push(...lecturas);
  console.log(`${hora()} sin conexión: ${lecturas.length} lecturas al buffer (total ${estado.buffer.length})`);
}

async function vaciarBuffer() {
  while (estado.buffer.length > 0) {
    const parte = estado.buffer.splice(0, MAX_POR_LOTE);
    await enviarLote(parte, 'BUFFER');
    if (estado.buffer.includes(parte[0]!)) break; // volvió al buffer: seguir más tarde
  }
}

async function enviarLatido() {
  try {
    await api('POST', `/dispositivos/${DISPOSITIVO}/estados-conexion`, {
      ntp_sincronizado: true,
      rssi_dbm: Math.round(azar(-78, -48)),
      ip: '192.168.1.77',
      uptime_s: Math.round((Date.now() - estado.inicio) / 1000),
      heap_libre_bytes: Math.round(azar(150_000, 190_000)),
      lecturas_en_buffer: estado.buffer.length,
      reconexiones_wifi: estado.reconexiones,
      envios_fallidos: estado.enviosFallidos,
      version_firmware: 'sim-1.0',
    });
  } catch (error) {
    console.log(`${hora()} latido falló: ${(error as Error).message}`);
  }
}

/** Genera y envía lecturas pasadas como si el ESP32 vaciara su buffer. */
async function rellenarHistorico() {
  const fin = ahoraEpoch();
  let t = fin - HISTORICO_MIN * 60;
  let lecturas: Lectura[] = [];
  console.log(`Rellenando ${HISTORICO_MIN} min de histórico...`);
  // El histórico respeta la cadencia real del ESP32 (LECTURA_INTERVALO_SEG), no el --intervalo de la simulación
  for (; t < fin; t += env.LECTURA_INTERVALO_SEG) {
    lecturas.push(...generarCiclo(t));
    if (lecturas.length >= MAX_POR_LOTE) {
      await enviarLote(lecturas, 'BUFFER');
      lecturas = [];
    }
  }
  if (lecturas.length) await enviarLote(lecturas, 'BUFFER');
}

async function limpiar() {
  if (DISPOSITIVO === ESTACION_REAL) {
    throw new Error(`--limpiar nunca borra la estación real ${ESTACION_REAL}`);
  }

  try {
    // Cascada: sensores → lecturas, anomalías, alertas, reglas; dispositivo → lotes, latidos, consultas
    const [, meta] = await sequelize.query('DELETE FROM dispositivos WHERE codigo = :codigo', {
      replacements: { codigo: DISPOSITIVO },
    });
    const borrados = (meta as { rowCount?: number }).rowCount ?? 0;
    console.log(borrados ? `${DISPOSITIVO} borrado con todos sus datos` : `${DISPOSITIVO} no existía`);
  } finally {
    await sequelize.close();
  }
}

async function main() {
  if (op.ayuda) {
    console.log('Opciones: --url --dispositivo --intervalo --latido --ciclos --historico --congelar <etiqueta> --prob-anomalia --prob-corte --limpiar --forzar');
    return;
  }
  if (op.limpiar) return limpiar();
  if (DISPOSITIVO === ESTACION_REAL && !op.forzar) {
    throw new Error(
      `No simules sobre ${ESTACION_REAL}: mezclarías datos falsos con los reales de KNIME y FlowiseAI. Usa --forzar si de verdad lo quieres.`,
    );
  }

  await prepararDispositivo();
  if (op.congelar) {
    const sensor = SENSORES.find((s) => s.etiqueta === op.congelar);
    if (!sensor) throw new Error(`--congelar: sensor desconocido ${op.congelar}`);
    valoresCongelados.set(sensor.etiqueta, valorEn(sensor, ahoraEpoch()));
    console.log(`${sensor.etiqueta} congelado en ${valoresCongelados.get(sensor.etiqueta)}`);
  }
  if (HISTORICO_MIN > 0) await rellenarHistorico();

  console.log(`Simulando ${DISPOSITIVO} contra ${API}: lote cada ${INTERVALO_S} s, latido cada ${LATIDO_S} s (Ctrl+C para salir)`);
  let ciclo = 0;
  let ultimoLatido = 0;

  const resumen = () =>
    console.log(`\nResumen: ${estado.enviados} lecturas guardadas, ${estado.anomalias} anomalías, ${estado.buffer.length} en buffer`);
  process.on('SIGINT', () => {
    resumen();
    process.exit(0);
  });

  while (CICLOS === 0 || ciclo < CICLOS) {
    ciclo++;
    const lecturas = generarCiclo(ahoraEpoch());
    const anomalia = Math.random() < PROB_ANOMALIA ? inyectarAnomalia(lecturas) : '';

    if (estado.corteRestante === 0 && Math.random() < PROB_CORTE) {
      estado.corteRestante = Math.round(azar(3, 6));
      estado.reconexiones++;
      console.log(`${hora()} ✂ corte de Wi-Fi simulado (${estado.corteRestante} ciclos)`);
    }

    if (estado.corteRestante > 0) {
      estado.corteRestante--;
      estado.buffer.push(...lecturas);
      console.log(`${hora()} sin Wi-Fi: lecturas al buffer (${estado.buffer.length})${anomalia ? `  ← ${anomalia}` : ''}`);
    } else {
      await vaciarBuffer();
      await enviarLote(lecturas, 'TIEMPO_REAL', anomalia);
      if (Date.now() - ultimoLatido >= LATIDO_S * 1000) {
        await enviarLatido();
        ultimoLatido = Date.now();
      }
    }

    if (CICLOS === 0 || ciclo < CICLOS) await new Promise((r) => setTimeout(r, INTERVALO_S * 1000));
  }
  await vaciarBuffer();
  resumen();
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
