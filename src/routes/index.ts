import { Router } from 'express';
import { alertasRouter } from '../modules/alertas/alertas.routes';
import { anomaliasRouter } from '../modules/anomalias/anomalias.routes';
import { dispositivosRouter } from '../modules/dispositivos/dispositivos.routes';
import { estadosConexionRouter } from '../modules/estados-conexion/estados-conexion.routes';
import { lecturasRouter } from '../modules/lecturas/lecturas.routes';
import { lotesEnvioRouter } from '../modules/lotes-envio/lotes-envio.routes';
import { opcionesMenuRouter } from '../modules/opciones-menu/opciones-menu.routes';
import { reglasUmbralRouter } from '../modules/reglas-umbral/reglas-umbral.routes';
import { sensoresRouter } from '../modules/sensores/sensores.routes';
import { tiposSensorRouter } from '../modules/tipos-sensor/tipos-sensor.routes';
import { ubicacionesRouter } from '../modules/ubicaciones/ubicaciones.routes';
import { vigilanciaRouter } from '../modules/vigilancia/vigilancia.routes';

/** Router de la API v1: cada módulo (src/modules/<recurso>) se monta aquí. */
export const apiRouter = Router();

const recursos = {
  '/tipos-sensor': tiposSensorRouter,
  '/ubicaciones': ubicacionesRouter,
  '/dispositivos/:ref/estados-conexion': estadosConexionRouter,
  '/dispositivos': dispositivosRouter,
  '/sensores': sensoresRouter,
  '/reglas-umbral': reglasUmbralRouter,
  '/opciones-menu': opcionesMenuRouter,
  '/lecturas': lecturasRouter,
  '/lotes-envio': lotesEnvioRouter,
  '/anomalias': anomaliasRouter,
  '/alertas': alertasRouter,
  '/vigilancia': vigilanciaRouter,
};

for (const [ruta, router] of Object.entries(recursos)) apiRouter.use(ruta, router);

apiRouter.get('/', (_req, res) => {
  res.json({ data: { nombre: 'api-humedad', version: 'v1', recursos: Object.keys(recursos) } });
});
