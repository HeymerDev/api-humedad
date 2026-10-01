import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AutoIncrement, BelongsTo, Column, CreatedAt, DataType, ForeignKey, Model, PrimaryKey, Table } from 'sequelize-typescript';
import { Dispositivo } from './dispositivo.model';
import { OpcionMenu } from './opcion-menu.model';

/** 12/12 · Registro de cada consulta del menú hecha desde el teclado del ESP32. */
@Table({ tableName: 'consultas_menu', updatedAt: false })
export class ConsultaMenu extends Model<InferAttributes<ConsultaMenu>, InferCreationAttributes<ConsultaMenu>> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  id!: CreationOptional<number>;

  @ForeignKey(() => OpcionMenu)
  @Column({ type: DataType.INTEGER, allowNull: false })
  opcion_menu_id!: number;

  @ForeignKey(() => Dispositivo)
  @Column({ type: DataType.INTEGER, allowNull: false })
  dispositivo_id!: number;

  @CreatedAt
  consultado_en!: CreationOptional<Date>;

  @Column({ type: DataType.INTEGER, validate: { min: 0 } })
  duracion_ms!: CreationOptional<number | null>;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  exitosa!: CreationOptional<boolean>;

  @Column(DataType.JSONB)
  parametros!: CreationOptional<Record<string, unknown> | null>;

  /** Obligatorio cuando `exitosa` es false. */
  @Column(DataType.TEXT)
  error!: CreationOptional<string | null>;

  @BelongsTo(() => OpcionMenu, 'opcion_menu_id')
  opcion_menu?: NonAttribute<OpcionMenu>;

  @BelongsTo(() => Dispositivo, 'dispositivo_id')
  dispositivo?: NonAttribute<Dispositivo>;
}
