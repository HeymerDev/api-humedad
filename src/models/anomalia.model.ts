import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import {
  AutoIncrement,
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  ForeignKey,
  HasMany,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import { Alerta } from './alerta.model';
import {
  METODOS_DETECCION,
  SEVERIDADES,
  TIPOS_ANOMALIA,
  type MetodoDeteccion,
  type Severidad,
  type TipoAnomalia,
} from './enums';
import { ReglaUmbral } from './regla-umbral.model';
import { Sensor } from './sensor.model';

/**
 * 9/12 · Valores atípicos detectados.
 * (lectura_id, lectura_medido_en) es una FK compuesta hacia la hypertable
 * `lecturas`; Sequelize no soporta asociaciones con FK compuesta, así que se
 * expone como columnas y la lectura se consulta con `where`.
 */
@Table({ tableName: 'anomalias', updatedAt: false })
export class Anomalia extends Model<InferAttributes<Anomalia>, InferCreationAttributes<Anomalia>> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id!: CreationOptional<number>;

  @ForeignKey(() => Sensor)
  @Column({ type: DataType.INTEGER, allowNull: false })
  sensor_id!: number;

  @ForeignKey(() => ReglaUmbral)
  @Column(DataType.INTEGER)
  regla_id!: CreationOptional<number | null>;

  /** NULL en SENSOR_SIN_DATOS (no hay lectura que la origine). */
  @Column(DataType.BIGINT)
  lectura_id!: CreationOptional<number | null>;

  @Column({ type: DataType.DATE, allowNull: false })
  lectura_medido_en!: Date;

  @Column({ type: DataType.STRING(40), allowNull: false, validate: { isIn: [TIPOS_ANOMALIA] } })
  tipo!: TipoAnomalia;

  @Column({ type: DataType.STRING(30), allowNull: false, validate: { isIn: [METODOS_DETECCION] } })
  metodo!: MetodoDeteccion;

  @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'MEDIA', validate: { isIn: [SEVERIDADES] } })
  severidad!: CreationOptional<Severidad>;

  @Column({ type: DataType.DOUBLE, allowNull: false })
  valor_observado!: number;

  @Column(DataType.DOUBLE)
  valor_esperado!: CreationOptional<number | null>;

  @Column(DataType.DOUBLE)
  desviacion!: CreationOptional<number | null>;

  @Column({ type: DataType.DOUBLE, validate: { min: 0 } })
  score!: CreationOptional<number | null>;

  @Column(DataType.TEXT)
  descripcion!: CreationOptional<string | null>;

  @Column(DataType.JSONB)
  parametros!: CreationOptional<Record<string, unknown> | null>;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false })
  revisada!: CreationOptional<boolean>;

  @CreatedAt
  detectado_en!: CreationOptional<Date>;

  @BelongsTo(() => Sensor, 'sensor_id')
  sensor?: NonAttribute<Sensor>;

  @BelongsTo(() => ReglaUmbral, 'regla_id')
  regla?: NonAttribute<ReglaUmbral | null>;

  @HasMany(() => Alerta, 'anomalia_id')
  alertas?: NonAttribute<Alerta[]>;
}
