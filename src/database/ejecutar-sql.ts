import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client, type DatabaseError, type QueryResult } from 'pg';
import { env } from '../config/env';

/**
 * Ejecuta un archivo .sql completo contra la base de datos en UNA transacción:
 * si algo falla no queda nada a medias.
 *
 *   npm run db:schema       -> database/schema.sql
 *   npm run db:seed         -> database/seed.sql
 *   npm run db:evidencias   -> database/consultas/evidencias.sql
 *
 *   tsx src/database/ejecutar-sql.ts <archivo.sql> [--probar] [--todo]
 *     --probar  ejecuta todo y al final hace ROLLBACK (valida sin dejar cambios)
 *     --todo    imprime cada resultado con filas, no solo el último
 */

// Avisos esperables al re-ejecutar un script idempotente ("already exists, skipping")
const AVISO_IDEMPOTENTE = /already exists|already a hypertable|does not exist, skipping/i;

function lineaDe(sql: string, posicion: number) {
  return sql.slice(0, posicion - 1).split('\n').length;
}

async function main() {
  const argumentos = process.argv.slice(2);
  const archivo = argumentos.find((a) => !a.startsWith('--'));
  const probar = argumentos.includes('--probar');
  const todo = argumentos.includes('--todo');

  if (!archivo) {
    console.error('Uso: tsx src/database/ejecutar-sql.ts <archivo.sql> [--probar] [--todo]');
    process.exit(1);
  }

  const sql = readFileSync(resolve(archivo), 'utf8');
  const cliente = new Client({
    connectionString: env.DATABASE_URL,
    ssl: env.DB_SSL ? { rejectUnauthorized: true } : undefined,
  });

  let omitidos = 0;
  cliente.on('notice', (aviso) => {
    if (AVISO_IDEMPOTENTE.test(aviso.message ?? '')) omitidos++;
    else console.log(`  [${aviso.severity ?? 'NOTICE'}] ${aviso.message}`);
  });

  await cliente.connect();
  const inicio = performance.now();

  try {
    await cliente.query('BEGIN');
    const resultado = (await cliente.query(sql)) as unknown as QueryResult | QueryResult[];
    await cliente.query(probar ? 'ROLLBACK' : 'COMMIT');

    const resultados = Array.isArray(resultado) ? resultado : [resultado];
    const aMostrar = todo ? resultados.filter((r) => r.rows.length > 0) : resultados.slice(-1);
    for (const r of aMostrar) if (r.rows.length > 0) console.table(r.rows);

    if (omitidos > 0) console.log(`  (${omitidos} objetos ya existían y se omitieron)`);
    const ms = Math.round(performance.now() - inicio);
    console.log(`${probar ? 'Probado y revertido (ROLLBACK)' : 'Aplicado'}: ${archivo} en ${ms} ms`);
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    const e = error as DatabaseError;
    const linea = e.position ? ` (línea ${lineaDe(sql, Number(e.position))})` : '';
    console.error(`Error en ${archivo}${linea}: ${e.message}`);
    if (e.detail) console.error(`  Detalle: ${e.detail}`);
    if (e.where) console.error(`  Contexto: ${e.where}`);
    console.error('No se aplicó ningún cambio (ROLLBACK).');
    process.exitCode = 1;
  } finally {
    await cliente.end();
  }
}

void main();
