import { z } from 'zod';

/** Formatos de LCD soportados: columnas x filas. */
export const esquemaFormatoLcd = z.enum(['16x2', '20x4']).default('16x2');
export type FormatoLcd = z.output<typeof esquemaFormatoLcd>;

export interface SalidaLcd {
  columnas: number;
  filas: number;
  /** Cada página cabe en la pantalla: el ESP32 avanza con '#' y vuelve con '*'. */
  paginas: string[][];
}

/**
 * El HD44780 no tiene tildes ni '°': se pasa todo a ASCII imprimible.
 * "Máx 24.5°C" → "Max 24.5C".
 */
export function aAscii(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/°/g, '')
    .replace(/[^ -~]/g, '');
}

/** "temperatura_aire" → "T.aire", "humedad_suelo" → "H.suelo". */
export function abreviar(etiqueta: string) {
  const [primera = '', ...resto] = etiqueta.split('_');
  if (resto.length === 0) return aAscii(etiqueta).slice(0, 7);
  return aAscii(`${primera.charAt(0).toUpperCase()}.${resto.join('_')}`).slice(0, 7);
}

/** Número con decimales fijos y sin "-0". */
export function num(valor: number | null | undefined, decimales = 1) {
  if (valor == null || Number.isNaN(valor)) return '--';
  const texto = valor.toFixed(decimales);
  return /^-0\.?0*$/.test(texto) ? texto.slice(1) : texto;
}

/** Unidad apta para el LCD: "°C" → "C". */
export const unidadLcd = (unidad: string) => aAscii(unidad);

/**
 * Reparte bloques de líneas (normalmente un bloque por sensor, de 1 o 2
 * líneas) en páginas del tamaño del display, sin partir un bloque entre
 * páginas si cabe entero. Cada línea se recorta al ancho.
 */
export function paginar(bloques: string[][], formato: FormatoLcd): SalidaLcd {
  const [columnas, filas] = formato.split('x').map(Number) as [number, number];
  const paginas: string[][] = [];
  let actual: string[] = [];

  for (const bloque of bloques) {
    const lineas = bloque.map((l) => aAscii(l).slice(0, columnas));
    if (actual.length > 0 && actual.length + lineas.length > filas) {
      paginas.push(actual);
      actual = [];
    }
    for (const linea of lineas) {
      if (actual.length === filas) {
        paginas.push(actual);
        actual = [];
      }
      actual.push(linea);
    }
  }
  if (actual.length > 0) paginas.push(actual);
  return { columnas, filas, paginas };
}
