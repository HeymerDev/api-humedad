import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AutoIncrement, BelongsTo, Column, CreatedAt, DataType, ForeignKey, Model, PrimaryKey, Table } from 'sequelize-typescript';
import { Anomalia } from './anomalia.model';
import {
  ESTADOS_ALERTA,
  SEVERIDADES,
  TIPOS_ANOMALIA,
  type EstadoAlerta,
  type Severidad,
  type TipoAnomalia,
} from './enums';
import { Sensor } from './sensor.model';

/**
 * 10/12 · Alertas generadas desde anomalías. Agrupan las repetidas: como
 * máximo una alerta no RESUELTA por (sensor_id, tipo), que suma `ocurrencias`.
 */
@Table({ tableName: 'alertas', updatedAt: false })
export class Alerta extends Model<InferAttributes<Alerta>, InferCreationAttributes<Alerta>> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id!: CreationOptional<number>;

  @ForeignKey(() => Sensor)
  @Column({ type: DataType.INTEGER, allowNull: false })
  sensor_id!: number;

  /** Anomalía que abrió la alerta. */
  @ForeignKey(() => Anomalia)
  @Column(DataType.INTEGER)
  anomalia_id!: CreationOptional<number | null>;

  @Column({ type: DataType.STRING(40), allowNull: false, validate: { isIn: [TIPOS_ANOMALIA] } })
  tipo!: TipoAnomalia;

  @Column({ type: DataType.STRING(160), allowNull: false })
  titulo!: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  mensaje!: string;

  @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'MEDIA', validate: { isIn: [SEVERIDADES] } })
  severidad!: CreationOptional<Severidad>;

  @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'ABIERTA', validate: { isIn: [ESTADOS_ALERTA] } })
  estado!: CreationOptional<EstadoAlerta>;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 1, validate: { min: 1 } })
  ocurrencias!: CreationOptional<number>;

  @CreatedAt
  creado_en!: CreationOptional<Date>;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  ultima_ocurrencia_en!: CreationOptional<Date>;

  @Column(DataType.DATE)
  reconocido_en!: CreationOptional<Date | null>;

  @Column(DataType.DATE)
  resuelto_en!: CreationOptional<Date | null>;

  @BelongsTo(() => Sensor, 'sensor_id')
  sensor?: NonAttribute<Sensor>;

  @BelongsTo(() => Anomalia, 'anomalia_id')
  anomalia?: NonAttribute<Anomalia | null>;
}
