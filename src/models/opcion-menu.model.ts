import type { CreationOptional, InferAttributes, InferCreationAttributes, NonAttribute } from 'sequelize';
import { AutoIncrement, Column, CreatedAt, DataType, HasMany, Model, PrimaryKey, Table, UpdatedAt } from 'sequelize-typescript';
import { ConsultaMenu } from './consulta-menu.model';

/**
 * 11/12 · Opciones del menú del teclado matricial y el concepto de analítica
 * que aplica cada una (entregable del componente 2 del taller).
 */
@Table({ tableName: 'opciones_menu' })
export class OpcionMenu extends Model<InferAttributes<OpcionMenu>, InferCreationAttributes<OpcionMenu>> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id!: CreationOptional<number>;

  /** Tecla del teclado 4x4: 0-9 o A-D ('*' y '#' son volver / confirmar). */
  @Column({ type: DataType.STRING(1), allowNull: false, validate: { is: /^[0-9A-D]$/ } })
  tecla!: string;

  /** Texto para el LCD: ASCII imprimible, máximo 16 caracteres. */
  @Column({ type: DataType.STRING(16), allowNull: false, validate: { is: /^[ -~]{1,16}$/ } })
  titulo!: string;

  @Column(DataType.TEXT)
  descripcion!: CreationOptional<string | null>;

  @Column({ type: DataType.TEXT, allowNull: false })
  concepto_analitica!: string;

  /** Ruta de la API que resuelve la opción (ej. /api/v1/analitica/promedio-hora). */
  @Column({ type: DataType.STRING(120), allowNull: false, validate: { is: /^\/api\// } })
  endpoint!: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  activa!: CreationOptional<boolean>;

  @CreatedAt
  creado_en!: CreationOptional<Date>;

  @UpdatedAt
  actualizado_en!: CreationOptional<Date>;

  @HasMany(() => ConsultaMenu, 'opcion_menu_id')
  consultas?: NonAttribute<ConsultaMenu[]>;
}
