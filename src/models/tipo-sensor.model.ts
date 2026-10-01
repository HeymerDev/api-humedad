import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AutoIncrement, Column, CreatedAt, DataType, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { ReglaUmbral } from './regla-umbral.model';
import { Sensor } from './sensor.model';

/** 1/12 · Catálogo de tipos de sensor y sus rangos físicos. */
@Table({ tableName: 'tipos_sensor' })
export class TipoSensor extends Model<InferAttributes<TipoSensor>, InferCreationAttributes<TipoSensor>> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id!: CreationOptional<number>;

  @Column({ type: DataType.STRING(40), allowNull: false })
  codigo!: string;

  @Column({ type: DataType.STRING(120), allowNull: false })
  nombre!: string;

  @Column(DataType.STRING(80))
  fabricante!: CreationOptional<string | null>;

  @Column(DataType.TEXT)
  descripcion!: CreationOptional<string | null>;

  @Column({ type: DataType.STRING(60), allowNull: false })
  magnitud!: string;

  @Column({ type: DataType.STRING(20), allowNull: false })
  unidad!: string;

  @Column({ type: DataType.DECIMAL(10, 4), allowNull: false })
  rango_min!: number;

  @Column({ type: DataType.DECIMAL(10, 4), allowNull: false })
  rango_max!: number;

  @Column(DataType.DECIMAL(10, 4))
  precision!: CreationOptional<number | null>;

  @CreatedAt
  creado_en!: CreationOptional<Date>;

  @UpdatedAt
  actualizado_en!: CreationOptional<Date>;

  @HasMany(() => Sensor, 'tipo_sensor_id')
  sensores?: NonAttribute<Sensor[]>;

  @HasMany(() => ReglaUmbral, 'tipo_sensor_id')
  reglas?: NonAttribute<ReglaUmbral[]>;
}
