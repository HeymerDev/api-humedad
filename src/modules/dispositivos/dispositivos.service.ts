import { QueryTypes } from 'sequelize';
import { sequelize } from '../../config/database';
import { Dispositivo } from '../../models';
import { HttpError } from '../../utils/http-error';

/** Busca un dispositivo por id numérico o por código (ej. "esp32_01"). */
export async function buscarDispositivo(ref: string | number) {
  const dispositivo = /^\d+$/.test(String(ref))
    ? await Dispositivo.findByPk(Number(ref))
    : await Dispositivo.findOne({ where: { codigo: String(ref) } });
  if (!dispositivo) throw HttpError.notFound(`No existe el dispositivo ${ref}`);
  return dispositivo;
}

/** true si alguno de los sensores indicados tiene al menos una lectura. */
export async function tieneLecturas(filtro: { sensorId: number } | { dispositivoId: number }) {
  const [fila] = await sequelize.query<{ existe: boolean }>(
    'sensorId' in filtro
      ? 'SELECT EXISTS (SELECT 1 FROM lecturas WHERE sensor_id = :id) AS existe'
      : `SELECT EXISTS (
           SELECT 1 FROM lecturas l JOIN sensores s ON s.id = l.sensor_id WHERE s.dispositivo_id = :id
         ) AS existe`,
    { replacements: { id: 'sensorId' in filtro ? filtro.sensorId : filtro.dispositivoId }, type: QueryTypes.SELECT },
  );
  return fila?.existe ?? false;
}
