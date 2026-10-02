import { z } from 'zod';
import { filtroBooleano, filtroId, filtroTexto, idRelacion, texto, textoOpcional } from '../../utils/esquemas';

const base = z.object({
  // No puede ser solo números: /dispositivos/:id distingue id numérico de código
  codigo: z
    .string()
    .trim()
    .regex(/^(?!\d+$)[A-Za-z0-9_-]{1,64}$/, 'Letras, números, _ o - (máx. 64) y no solo números, ej. esp32_01'),
  nombre: texto(120),
  descripcion: textoOpcional(),
  modelo: texto(60).default('ESP32'),
  version_firmware: textoOpcional(30),
  direccion_mac: z
    .string()
    .trim()
    .regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/, 'Formato AA:BB:CC:DD:EE:FF')
    .nullable()
    .optional(),
  direccion_ip: z.union([z.ipv4(), z.ipv6()]).nullable().optional(),
  activo: z.boolean().optional(),
  ubicacion_id: idRelacion().nullable().optional(),
});

export const esquemaCrearDispositivo = base.strict();
// `ultima_conexion` no se edita: la actualiza la API al recibir datos
export const esquemaActualizarDispositivo = base.omit({ modelo: true }).extend({ modelo: texto(60) }).partial().strict();

export const esquemaFiltrosDispositivo = z.object({
  codigo: filtroTexto(),
  activo: filtroBooleano(),
  ubicacion_id: filtroId(),
});

export const esquemaRefDispositivo = z.object({ ref: z.string().trim().min(1) });
