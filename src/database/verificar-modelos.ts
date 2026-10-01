import { Op, QueryTypes } from 'sequelize';
import { sequelize } from '../config/database';
import {
  Alerta,
  Anomalia,
  ConsultaMenu,
  Dispositivo,
  EstadoConexion,
  Lectura,
  LoteEnvio,
  OpcionMenu,
  ReglaUmbral,
  Sensor,
  TipoSensor,
  modelos,
} from '../models';

/**
 * Verifica que los modelos reflejan database/schema.sql:
 *   1. Columnas: nombre, tipo y nulabilidad de cada modelo contra la BD real.
 *   2. Lectura: un SELECT por modelo y las asociaciones principales.
 *   3. Escritura: inserta una fila en cada tabla dentro de una transacción
 *      que se revierte (no deja datos).
 *
 *   npm run db:verificar
 */

interface ColumnaBd {
  tipo: string;
  allowNull: boolean;
}

/** Unifica cómo nombran los tipos Sequelize (toSql) y PostgreSQL (format_type). */
function normalizarTipo(tipo: string) {
  return tipo
    .toUpperCase()
    .replace('CHARACTER VARYING', 'VARCHAR')
    .replace('NUMERIC', 'DECIMAL')
    .replace(/\s+/g, '');
}

/**
 * Columnas reales de la tabla. Se usa format_type() en vez de describeTable
 * porque este último no informa la precisión de NUMERIC(p, s).
 */
async function columnasDe(tabla: string): Promise<Record<string, ColumnaBd>> {
  const filas = await sequelize.query<{ columna: string; tipo: string; admite_null: boolean }>(
    `SELECT a.attname AS columna, format_type(a.atttypid, a.atttypmod) AS tipo, NOT a.attnotnull AS admite_null
     FROM pg_attribute a
     WHERE a.attrelid = to_regclass(:tabla) AND a.attnum > 0 AND NOT a.attisdropped`,
    { replacements: { tabla }, type: QueryTypes.SELECT },
  );
  return Object.fromEntries(filas.map((f) => [f.columna, { tipo: f.tipo, allowNull: f.admite_null }]));
}

async function verificarColumnas() {
  let diferencias = 0;
  const resumen: Record<string, string | number>[] = [];

  for (const modelo of modelos) {
    const tabla = modelo.getTableName() as string;
    const columnasBd = await columnasDe(tabla);
    const atributos = Object.values(modelo.getAttributes());
    const problemas: string[] = [];

    for (const atributo of atributos) {
      const campo = atributo.field ?? '';
      const columna = columnasBd[campo];
      if (!columna) {
        problemas.push(`${campo}: no existe en la BD`);
        continue;
      }
      const tipoModelo = normalizarTipo((atributo.type as { toSql(): string }).toSql());
      const tipoBd = normalizarTipo(columna.tipo);
      if (tipoModelo !== tipoBd) problemas.push(`${campo}: tipo ${tipoModelo} en el modelo, ${tipoBd} en la BD`);

      const modeloAdmiteNull = atributo.allowNull !== false && !atributo.primaryKey;
      if (modeloAdmiteNull !== columna.allowNull) {
        problemas.push(`${campo}: NULL ${modeloAdmiteNull ? 'permitido' : 'prohibido'} en el modelo y al revés en la BD`);
      }
    }

    const camposModelo = new Set(atributos.map((a) => a.field));
    for (const columna of Object.keys(columnasBd)) {
      if (!camposModelo.has(columna)) problemas.push(`${columna}: existe en la BD pero falta en el modelo`);
    }

    diferencias += problemas.length;
    resumen.push({ tabla, columnas: Object.keys(columnasBd).length, resultado: problemas.length ? 'DIFERENCIAS' : 'OK' });
    for (const problema of problemas) console.log(`  [${tabla}] ${problema}`);
  }

  console.table(resumen);
  return diferencias;
}

async function verificarLectura() {
  for (const modelo of modelos) await modelo.findOne();

  const sensores = await Sensor.findAll({
    include: ['tipo_sensor', { association: 'dispositivo', include: ['ubicacion'] }],
    order: [['id', 'ASC']],
  });
  console.table(
    sensores.map((s) => ({
      sensor: s.etiqueta,
      tipo: s.tipo_sensor?.codigo,
      rango: `${s.tipo_sensor?.rango_min} .. ${s.tipo_sensor?.rango_max} ${s.tipo_sensor?.unidad}`,
      dispositivo: s.dispositivo?.codigo,
      ubicacion: s.dispositivo?.ubicacion?.nombre,
    })),
  );

  const reglas = await ReglaUmbral.findAll({ include: ['tipo_sensor', 'sensor'], order: [['id', 'ASC']] });
  console.table(
    reglas.map((r) => ({
      regla: r.nombre,
      tipo: r.tipo_anomalia,
      alcance: r.sensor?.etiqueta ?? r.tipo_sensor?.codigo ?? 'GLOBAL',
    })),
  );

  const menu = await OpcionMenu.findAll({ order: [['tecla', 'ASC']] });
  console.table(menu.map((o) => ({ tecla: o.tecla, titulo: o.titulo, endpoint: o.endpoint })));

  const ultima = await Lectura.findOne({
    where: { medido_en: { [Op.gte]: new Date(Date.now() - 365 * 24 * 3600 * 1000) } },
    include: ['sensor', 'lote'],
    order: [['medido_en', 'DESC']],
  });
  const tipo = await TipoSensor.findOne();
  console.log('Tipos de dato en JS:', {
    'lecturas.id (BIGINT)': typeof ultima?.id,
    'lecturas.valor (DOUBLE)': typeof ultima?.valor,
    'lecturas.medido_en (TIMESTAMPTZ)': ultima?.medido_en instanceof Date ? 'Date' : typeof ultima?.medido_en,
    'tipos_sensor.rango_min (NUMERIC)': typeof tipo?.rango_min,
  });
}

async function verificarEscritura() {
  const transaccion = await sequelize.transaction();
  try {
    const opciones = { transaction: transaccion };
    const sensor = await Sensor.findOne({ ...opciones, order: [['id', 'ASC']] });
    const dispositivo = await Dispositivo.findOne(opciones);
    const opcion = await OpcionMenu.findOne(opciones);
    const regla = await ReglaUmbral.findOne(opciones);
    if (!sensor || !dispositivo || !opcion || !regla) throw new Error('Faltan datos semilla: ejecuta npm run db:seed');

    const lote = await LoteEnvio.create(
      { dispositivo_id: dispositivo.id, lecturas_recibidas: 1, lecturas_aceptadas: 1, errores: [] },
      opciones,
    );
    const lectura = await Lectura.create(
      { sensor_id: sensor.id, lote_id: lote.id, valor: 21.5, valor_crudo: 21.5, medido_en: new Date() },
      opciones,
    );
    await EstadoConexion.create({ dispositivo_id: dispositivo.id, rssi_dbm: -60, uptime_s: 120 }, opciones);
    const anomalia = await Anomalia.create(
      {
        sensor_id: sensor.id,
        regla_id: regla.id,
        lectura_id: lectura.id,
        lectura_medido_en: lectura.medido_en,
        tipo: regla.tipo_anomalia,
        metodo: regla.metodo,
        valor_observado: lectura.valor,
        parametros: { prueba: true },
      },
      opciones,
    );
    await Alerta.create(
      { sensor_id: sensor.id, anomalia_id: anomalia.id, tipo: anomalia.tipo, titulo: 'Prueba', mensaje: 'Prueba' },
      opciones,
    );
    await ConsultaMenu.create({ opcion_menu_id: opcion.id, dispositivo_id: dispositivo.id, duracion_ms: 12 }, opciones);

    console.log('Escritura OK en lotes_envio, lecturas, estados_conexion, anomalias, alertas y consultas_menu', {
      lote_id: lote.id,
      lectura: { id: lectura.id, medido_en: lectura.medido_en, calidad: lectura.calidad },
      anomalia_id: anomalia.id,
    });
  } finally {
    await transaccion.rollback();
    console.log('(transacción revertida: no quedó ningún dato de prueba)');
  }
}

async function main() {
  try {
    console.log('1) Columnas de los modelos contra la BD');
    const diferencias = await verificarColumnas();
    console.log('\n2) Lectura y asociaciones');
    await verificarLectura();
    console.log('\n3) Escritura (con ROLLBACK)');
    await verificarEscritura();

    if (diferencias > 0) {
      console.error(`\n${diferencias} diferencias entre modelos y BD`);
      process.exitCode = 1;
    } else {
      console.log('\nModelos verificados: 12/12 coinciden con la BD');
    }
  } catch (error) {
    console.error('Error verificando modelos:', error);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

void main();
