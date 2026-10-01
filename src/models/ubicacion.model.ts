import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AutoIncrement, Column, CreatedAt, DataType, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { Dispositivo } from './dispositivo.model';

/** 2/12 · Ubicaciones físicas donde se despliegan los dispositivos. */
@Table({ tableName: 'ubicaciones' })
export class Ubicacion extends Model<InferAttributes<Ubicacion>, InferCreationAttributes<Ubicacion>> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id!: CreationOptional<number>;

  @Column({ type: DataType.STRING(120), allowNull: false })
  nombre!: string;

  @Column(DataType.TEXT)
  descripcion!: CreationOptional<string | null>;

  @Column(DataType.STRING(40))
  tipo_ambiente!: CreationOptional<string | null>;

  @Column({ type: DataType.DECIMAL(9, 6), validate: { min: -90, max: 90 } })
  latitud!: CreationOptional<number | null>;

  @Column({ type: DataType.DECIMAL(9, 6), validate: { min: -180, max: 180 } })
  longitud!: CreationOptional<number | null>;

  @Column(DataType.DECIMAL(7, 2))
  altitud_m!: CreationOptional<number | null>;

  @CreatedAt
  creado_en!: CreationOptional<Date>;

  @UpdatedAt
  actualizado_en!: CreationOptional<Date>;

  @HasMany(() => Dispositivo, 'ubicacion_id')
  dispositivos?: NonAttribute<Dispositivo[]>;
}
