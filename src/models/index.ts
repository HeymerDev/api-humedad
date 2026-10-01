import type { ModelCtor } from 'sequelize-typescript';
import { Alerta } from './alerta.model';
import { Anomalia } from './anomalia.model';
import { ConsultaMenu } from './consulta-menu.model';
import { Dispositivo } from './dispositivo.model';
import { EstadoConexion } from './estado-conexion.model';
import { Lectura } from './lectura.model';
import { LoteEnvio } from './lote-envio.model';
import { OpcionMenu } from './opcion-menu.model';
import { ReglaUmbral } from './regla-umbral.model';
import { Sensor } from './sensor.model';
import { TipoSensor } from './tipo-sensor.model';
import { Ubicacion } from './ubicacion.model';

export * from './enums';
export type { ErrorLectura } from './lote-envio.model';
export {
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
  Ubicacion,
};

/** Las 12 tablas del esquema, en el orden de database/schema.sql. */
export const modelos: ModelCtor[] = [
  TipoSensor,
  Ubicacion,
  Dispositivo,
  Sensor,
  LoteEnvio,
  Lectura,
  EstadoConexion,
  ReglaUmbral,
  Anomalia,
  Alerta,
  OpcionMenu,
  ConsultaMenu,
];
