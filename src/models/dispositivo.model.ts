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
import { ConsultaMenu } from './consulta-menu.model';
import { EstadoConexion } from './estado-conexion.model';
import { LoteEnvio } from './lote-envio.model';
import { Sensor } from './sensor.model';
import { Ubicacion } from './ubicacion.model';

/** 3/12 · Placas ESP32. El ESP32 se identifica con `codigo` (ej. esp32_01). */
@Table({ tableName: 'dispositivos' })
export class Dispositivo extends Model<InferAttributes<Dispositivo>, InferCreationAttributes<Dispositivo>> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id!: CreationOptional<number>;

  @Column({ type: DataType.STRING(64), allowNull: false })
  codigo!: string;

  @Column({ type: DataType.STRING(120), allowNull: false })
  nombre!: string;

  @Column(DataType.TEXT)
  descripcion!: CreationOptional<string | null>;

  @Column({ type: DataType.STRING(60), allowNull: false })
  modelo!: string;

  @Column(DataType.STRING(30))
  version_firmware!: CreationOptional<string | null>;

  @Column(DataType.STRING(17))
  direccion_mac!: CreationOptional<string | null>;

  @Column(DataType.STRING(45))
  direccion_ip!: CreationOptional<string | null>;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  activo!: CreationOptional<boolean>;

  @Column(DataType.DATE)
  ultima_conexion!: CreationOptional<Date | null>;

  @ForeignKey(() => Ubicacion)
  @Column(DataType.INTEGER)
  ubicacion_id!: CreationOptional<number | null>;

  @CreatedAt
  creado_en!: CreationOptional<Date>;

  @UpdatedAt
  actualizado_en!: CreationOptional<Date>;

  @BelongsTo(() => Ubicacion, 'ubicacion_id')
  ubicacion?: NonAttribute<Ubicacion | null>;

  @HasMany(() => Sensor, 'dispositivo_id')
  sensores?: NonAttribute<Sensor[]>;

  @HasMany(() => LoteEnvio, 'dispositivo_id')
  lotes?: NonAttribute<LoteEnvio[]>;

  @HasMany(() => EstadoConexion, 'dispositivo_id')
  estados_conexion?: NonAttribute<EstadoConexion[]>;

  @HasMany(() => ConsultaMenu, 'dispositivo_id')
  consultas_menu?: NonAttribute<ConsultaMenu[]>;
}
