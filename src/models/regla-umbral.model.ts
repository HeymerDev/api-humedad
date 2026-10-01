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
  UpdatedAt,
} from 'sequelize-typescript';
import { Anomalia } from './anomalia.model';
import {
  METODOS_DETECCION,
  SEVERIDADES,
  TIPOS_ANOMALIA,
  type MetodoDeteccion,
  type Severidad,
  type TipoAnomalia,
} from './enums';
import { Sensor } from './sensor.model';
import { TipoSensor } from './tipo-sensor.model';

/**
 * 8/12 · Reglas del detector de anomalías.
 * Alcance: un sensor (`sensor_id`), un tipo de sensor (`tipo_sensor_id`) o
 * global (ambos NULL). La BD impide llenar los dos y exige los parámetros
 * de cada `tipo_anomalia`.
 */
@Table({ tableName: 'reglas_umbral' })
export class ReglaUmbral extends Model<InferAttributes<ReglaUmbral>, InferCreationAttributes<ReglaUmbral>> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id!: CreationOptional<number>;

  @Column({ type: DataType.STRING(120), allowNull: false })
  nombre!: string;

  @Column(DataType.TEXT)
  descripcion!: CreationOptional<string | null>;

  @Column({ type: DataType.STRING(40), allowNull: false, validate: { isIn: [TIPOS_ANOMALIA] } })
  tipo_anomalia!: TipoAnomalia;

  @Column({
    type: DataType.STRING(30),
    allowNull: false,
    defaultValue: 'UMBRAL',
    validate: { isIn: [METODOS_DETECCION] },
  })
  metodo!: CreationOptional<MetodoDeteccion>;

  @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'MEDIA', validate: { isIn: [SEVERIDADES] } })
  severidad!: CreationOptional<Severidad>;

  @Column(DataType.DOUBLE)
  valor_min!: CreationOptional<number | null>;

  @Column(DataType.DOUBLE)
  valor_max!: CreationOptional<number | null>;

  /** Salto máximo permitido entre lecturas (o respecto de la media de la ventana). */
  @Column(DataType.DOUBLE)
  delta_max!: CreationOptional<number | null>;

  /** ZSCORE: |z| máximo. IQR: k de Q1 - k*IQR .. Q3 + k*IQR. */
  @Column(DataType.DOUBLE)
  factor!: CreationOptional<number | null>;

  @Column(DataType.INTEGER)
  ventana_minutos!: CreationOptional<number | null>;

  @Column(DataType.INTEGER)
  minimo_muestras!: CreationOptional<number | null>;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  activa!: CreationOptional<boolean>;

  @ForeignKey(() => Sensor)
  @Column(DataType.INTEGER)
  sensor_id!: CreationOptional<number | null>;

  @ForeignKey(() => TipoSensor)
  @Column(DataType.INTEGER)
  tipo_sensor_id!: CreationOptional<number | null>;

  @CreatedAt
  creado_en!: CreationOptional<Date>;

  @UpdatedAt
  actualizado_en!: CreationOptional<Date>;

  @BelongsTo(() => Sensor, 'sensor_id')
  sensor?: NonAttribute<Sensor | null>;

  @BelongsTo(() => TipoSensor, 'tipo_sensor_id')
  tipo_sensor?: NonAttribute<TipoSensor | null>;

  @HasMany(() => Anomalia, 'regla_id')
  anomalias?: NonAttribute<Anomalia[]>;
}
