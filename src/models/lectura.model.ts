import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AutoIncrement, BelongsTo, Column, DataType, ForeignKey, Model, PrimaryKey, Table } from 'sequelize-typescript';
import { CALIDADES_LECTURA, type CalidadLectura } from './enums';
import { LoteEnvio } from './lote-envio.model';
import { Sensor } from './sensor.model';

/**
 * 6/12 · Serie temporal de mediciones. HYPERTABLE de TimescaleDB
 * (chunk de 1 día) con PK compuesta (id, medido_en).
 *
 * Por la PK compuesta no se usa `findByPk`: buscar con `where`. Las
 * consultas de analítica van en SQL crudo y SIEMPRE filtran por `medido_en`
 * para aprovechar el descarte de chunks.
 */
@Table({ tableName: 'lecturas', timestamps: false })
export class Lectura extends Model<InferAttributes<Lectura>, InferCreationAttributes<Lectura>> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  id!: CreationOptional<number>;

  /** Momento de la medición según el ESP32 (dimensión de tiempo de la hypertable). */
  @PrimaryKey
  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  medido_en!: CreationOptional<Date>;

  @Column({ type: DataType.DATE, allowNull: false, defaultValue: DataType.NOW })
  recibido_en!: CreationOptional<Date>;

  /** Valor calibrado. */
  @Column({ type: DataType.DOUBLE, allowNull: false })
  valor!: number;

  /** Valor tal como llegó del ESP32 (NULL en lecturas anteriores a v2). */
  @Column(DataType.DOUBLE)
  valor_crudo!: CreationOptional<number | null>;

  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    defaultValue: 'OK',
    validate: { isIn: [CALIDADES_LECTURA] },
  })
  calidad!: CreationOptional<CalidadLectura>;

  @Column(DataType.STRING(200))
  observacion!: CreationOptional<string | null>;

  @ForeignKey(() => Sensor)
  @Column({ type: DataType.INTEGER, allowNull: false })
  sensor_id!: number;

  @ForeignKey(() => LoteEnvio)
  @Column(DataType.BIGINT)
  lote_id!: CreationOptional<number | null>;

  @BelongsTo(() => Sensor, 'sensor_id')
  sensor?: NonAttribute<Sensor>;

  @BelongsTo(() => LoteEnvio, 'lote_id')
  lote?: NonAttribute<LoteEnvio | null>;
}
