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
import { Dispositivo } from './dispositivo.model';
import { ORIGENES_LOTE, type OrigenLote } from './enums';
import { Lectura } from './lectura.model';

/** Detalle de una lectura rechazada dentro de un lote. */
export interface ErrorLectura {
  indice: number;
  sensor?: string;
  motivo: string;
}

/**
 * 5/12 · Cada envío del ESP32. Permite auditar reintentos (`intento`) y
 * lecturas reenviadas desde el buffer offline (`origen = 'BUFFER'`).
 */
@Table({ tableName: 'lotes_envio', updatedAt: false })
export class LoteEnvio extends Model<InferAttributes<LoteEnvio>, InferCreationAttributes<LoteEnvio>> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  id!: CreationOptional<number>;

  @ForeignKey(() => Dispositivo)
  @Column({ type: DataType.INTEGER, allowNull: false })
  dispositivo_id!: number;

  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    defaultValue: 'TIEMPO_REAL',
    validate: { isIn: [ORIGENES_LOTE] },
  })
  origen!: CreationOptional<OrigenLote>;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 1, validate: { min: 1 } })
  intento!: CreationOptional<number>;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  lecturas_recibidas!: CreationOptional<number>;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  lecturas_aceptadas!: CreationOptional<number>;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  lecturas_rechazadas!: CreationOptional<number>;

  /** Hora del ESP32 (NTP) al enviar el lote. */
  @Column(DataType.DATE)
  enviado_en!: CreationOptional<Date | null>;

  /** Hora del servidor al recibir el lote. */
  @CreatedAt
  recibido_en!: CreationOptional<Date>;

  @Column(DataType.INTEGER)
  duracion_ms!: CreationOptional<number | null>;

  @Column(DataType.JSONB)
  errores!: CreationOptional<ErrorLectura[] | null>;

  @BelongsTo(() => Dispositivo, 'dispositivo_id')
  dispositivo?: NonAttribute<Dispositivo>;

  @HasMany(() => Lectura, 'lote_id')
  lecturas?: NonAttribute<Lectura[]>;
}
