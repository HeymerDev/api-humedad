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
import { Alerta } from './alerta.model';
import { Anomalia } from './anomalia.model';
import { Dispositivo } from './dispositivo.model';
import { Lectura } from './lectura.model';
import { ReglaUmbral } from './regla-umbral.model';
import { TipoSensor } from './tipo-sensor.model';

/**
 * 4/12 · Sensores de cada dispositivo. `etiqueta` es el nombre con el que el
 * ESP32 identifica el valor en el JSON (única por dispositivo).
 */
@Table({ tableName: 'sensores' })
export class Sensor extends Model<InferAttributes<Sensor>, InferCreationAttributes<Sensor>> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id!: CreationOptional<number>;

  @Column({ type: DataType.STRING(60), allowNull: false })
  etiqueta!: string;

  @Column({ type: DataType.STRING(120), allowNull: false })
  nombre!: string;

  @Column(DataType.TEXT)
  descripcion!: CreationOptional<string | null>;

  @Column(DataType.STRING(20))
  pin!: CreationOptional<string | null>;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  activo!: CreationOptional<boolean>;

  /** valor = valor_crudo * escala_calibracion + offset_calibracion */
  @Column({ type: DataType.DECIMAL(10, 4), allowNull: false, defaultValue: 0 })
  offset_calibracion!: CreationOptional<number>;

  @Column({ type: DataType.DECIMAL(10, 4), allowNull: false, defaultValue: 1 })
  escala_calibracion!: CreationOptional<number>;

  @ForeignKey(() => Dispositivo)
  @Column({ type: DataType.INTEGER, allowNull: false })
  dispositivo_id!: number;

  @ForeignKey(() => TipoSensor)
  @Column({ type: DataType.INTEGER, allowNull: false })
  tipo_sensor_id!: number;

  @CreatedAt
  creado_en!: CreationOptional<Date>;

  @UpdatedAt
  actualizado_en!: CreationOptional<Date>;

  @BelongsTo(() => Dispositivo, 'dispositivo_id')
  dispositivo?: NonAttribute<Dispositivo>;

  @BelongsTo(() => TipoSensor, 'tipo_sensor_id')
  tipo_sensor?: NonAttribute<TipoSensor>;

  @HasMany(() => Lectura, 'sensor_id')
  lecturas?: NonAttribute<Lectura[]>;

  @HasMany(() => ReglaUmbral, 'sensor_id')
  reglas?: NonAttribute<ReglaUmbral[]>;

  @HasMany(() => Anomalia, 'sensor_id')
  anomalias?: NonAttribute<Anomalia[]>;

  @HasMany(() => Alerta, 'sensor_id')
  alertas?: NonAttribute<Alerta[]>;
}
