import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AutoIncrement, BelongsTo, Column, DataType, ForeignKey, Model, PrimaryKey, Table } from 'sequelize-typescript';
import { Dispositivo } from './dispositivo.model';

/**
 * 7/12 · Latidos periódicos del ESP32 (opción 7 del menú). HYPERTABLE de
 * TimescaleDB (chunk de 7 días) con PK compuesta (id, registrado_en).
 */
@Table({ tableName: 'estados_conexion', timestamps: false })
export class EstadoConexion extends Model<InferAttributes<EstadoConexion>, InferCreationAttributes<EstadoConexion>> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  id!: CreationOptional<number>;

  @PrimaryKey
  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  registrado_en!: CreationOptional<Date>;

  @ForeignKey(() => Dispositivo)
  @Column({ type: DataType.INTEGER, allowNull: false })
  dispositivo_id!: number;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  ntp_sincronizado!: CreationOptional<boolean>;

  @Column({ type: DataType.INTEGER, validate: { min: -127, max: 0 } })
  rssi_dbm!: CreationOptional<number | null>;

  @Column({ type: DataType.TEXT, validate: { len: [0, 45] } })
  direccion_ip!: CreationOptional<string | null>;

  @Column(DataType.BIGINT)
  uptime_s!: CreationOptional<number | null>;

  @Column(DataType.INTEGER)
  heap_libre_bytes!: CreationOptional<number | null>;

  /** Lecturas guardadas en el ESP32 pendientes de enviar. */
  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  lecturas_en_buffer!: CreationOptional<number>;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  reconexiones_wifi!: CreationOptional<number>;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  envios_fallidos!: CreationOptional<number>;

  @Column({ type: DataType.TEXT, validate: { len: [0, 30] } })
  version_firmware!: CreationOptional<string | null>;

  @BelongsTo(() => Dispositivo, 'dispositivo_id')
  dispositivo?: NonAttribute<Dispositivo>;
}
