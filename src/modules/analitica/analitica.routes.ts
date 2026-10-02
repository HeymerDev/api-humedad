import { Router } from 'express';
import { z } from 'zod';
import { validar } from '../../middlewares/validar';
import { ConsultaMenu, OpcionMenu, Sensor } from '../../models';
import { HttpError } from '../../utils/http-error';
import { esquemaFormatoLcd, paginar } from '../../utils/lcd';
import { buscarDispositivo } from '../dispositivos/dispositivos.service';
import {
  alertasActivas,
  estadoConexion,
  extremosDia,
  outliers,
  promedioHora,
  tendencia,
  valoresActuales,
  type Contexto,
  type Resultado,
} from './analitica.service';

/**
 * /api/v1/analitica/*  ·  una ruta por tecla del menú del teclado matricial.
 *
 * Query común:
 *   dispositivo  código o id (obligatorio)          ej. esp32_01
 *   lcd          16x2 (por defecto) | 20x4
 *   solo_lcd     true → responde solo { lcd } (menos memoria en el ESP32)
 *   registrar    false → no se guarda en consultas_menu (pruebas desde el navegador)
 *
 * Respuesta: { data, lcd: { columnas, filas, paginas: string[][] } }
 */
export const analiticaRouter = Router();

const esquemaComun = z.object({
  dispositivo: z.string({ error: 'Indica ?dispositivo=<código>, ej. esp32_01' }).trim().min(1),
  lcd: esquemaFormatoLcd,
  solo_lcd: z.stringbool().default(false),
  registrar: z.stringbool().default(true),
});

const minutos = (porDefecto: number) => z.coerce.number().int().min(5).max(1440).default(porDefecto);

/** Ids de opciones_menu por tecla (no cambian; se cachean). */
const opcionPorTecla = new Map<string, number>();
async function idOpcion(tecla: string) {
  if (!opcionPorTecla.has(tecla)) {
    const opcion = await OpcionMenu.findOne({ where: { tecla } });
    if (!opcion) return null;
    opcionPorTecla.set(tecla, opcion.id);
  }
  return opcionPorTecla.get(tecla)!;
}

/** Registra la consulta del teclado sin afectar la respuesta si el registro falla. */
async function registrarConsulta(tecla: string, dispositivoId: number, inicio: number, parametros: object, error?: unknown) {
  try {
    const opcionId = await idOpcion(tecla);
    if (!opcionId) return;
    await ConsultaMenu.create({
      opcion_menu_id: opcionId,
      dispositivo_id: dispositivoId,
      duracion_ms: Math.round(performance.now() - inicio),
      exitosa: !error,
      parametros: parametros as Record<string, unknown>,
      error: error ? String((error as Error).message ?? error).slice(0, 500) : null,
    });
  } catch (fallo) {
    console.error('No se pudo registrar la consulta del menú:', (fallo as Error).message);
  }
}

/** Define la ruta de una tecla: valida, arma el contexto, calcula, pagina el LCD y registra. */
function rutaAnalitica<E extends z.ZodRawShape>(
  ruta: string,
  tecla: string,
  extra: E,
  calcular: (ctx: Contexto, query: z.output<z.ZodObject<E>>) => Promise<Resultado>,
) {
  const esquema = esquemaComun.extend(extra);
  analiticaRouter.get(
    ruta,
    validar({ query: esquema as z.ZodType }, async ({ query: entrada }, _req, res) => {
      // El esquema se extiende con genéricos: se tipa explícitamente la parte común
      const query = entrada as z.output<typeof esquemaComun> & Record<string, unknown>;
      const inicio = performance.now();
      const dispositivo = await buscarDispositivo(query.dispositivo);
      const sensores = await Sensor.findAll({
        where: { dispositivo_id: dispositivo.id, activo: true },
        include: ['tipo_sensor'],
        order: [['id', 'ASC']],
      });
      const { dispositivo: _d, lcd: _l, solo_lcd: _s, registrar, ...parametros } = query;

      let resultado: Resultado;
      try {
        resultado = await calcular({ dispositivo, sensores }, query as unknown as z.output<z.ZodObject<E>>);
      } catch (error) {
        if (registrar) await registrarConsulta(tecla, dispositivo.id, inicio, parametros, error);
        throw error;
      }
      if (registrar) await registrarConsulta(tecla, dispositivo.id, inicio, parametros);

      const lcd = paginar(resultado.bloques, query.lcd);
      if (query.solo_lcd) {
        res.json({ lcd });
        return;
      }
      res.json({
        data: { opcion: tecla, dispositivo: dispositivo.codigo, generado_en: new Date(), ...resultado.data },
        lcd,
      });
    }),
  );
}

/** Tecla 1 · valor actual de cada sensor. */
rutaAnalitica('/valores-actuales', '1', {}, (ctx) => valoresActuales(ctx));

/** Tecla 2 · promedio de la última hora (?minutos=60). */
rutaAnalitica('/promedio-hora', '2', { minutos: minutos(60) }, (ctx, q) => promedioHora(ctx, q.minutos));

/** Tecla 3 · máximo y mínimo del día (?fecha=YYYY-MM-DD, por defecto hoy en APP_TIMEZONE). */
rutaAnalitica(
  '/extremos-dia',
  '3',
  { fecha: z.iso.date({ error: 'fecha debe ser YYYY-MM-DD' }).optional() },
  (ctx, q) => extremosDia(ctx, q.fecha ?? null),
);

/** Tecla 4 · desviación estándar y tendencia (?minutos=60). */
rutaAnalitica('/tendencia', '4', { minutos: minutos(60) }, (ctx, q) => tendencia(ctx, q.minutos));

/** Tecla 5 · outliers por Z-score e IQR (?minutos=60&z=3&k=1.5). */
rutaAnalitica(
  '/outliers',
  '5',
  {
    minutos: minutos(60),
    z: z.coerce.number().positive().max(10).default(3),
    k: z.coerce.number().positive().max(10).default(1.5),
  },
  (ctx, q) => outliers(ctx, q.minutos, q.z, q.k),
);

/** Tecla 6 · conteo de alertas activas. */
rutaAnalitica('/alertas-activas', '6', {}, (ctx) => alertasActivas(ctx));

/** Tecla 7 · estado de conexión a la nube. */
rutaAnalitica('/estado-conexion', '7', {}, (ctx) => estadoConexion(ctx));

/** GET /api/v1/analitica  ·  índice: qué ruta resuelve cada tecla. */
analiticaRouter.get('/', async (_req, res) => {
  const opciones = await OpcionMenu.findAll({ where: { activa: true }, order: [['tecla', 'ASC']] });
  if (opciones.length === 0) throw HttpError.notFound('No hay opciones de menú: ejecuta npm run db:seed');
  res.json({ data: opciones.map((o) => ({ tecla: o.tecla, titulo: o.titulo, endpoint: o.endpoint })) });
});
