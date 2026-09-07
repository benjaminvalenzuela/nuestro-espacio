import type { Persona } from '../enums.js';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  CÓDIGO DE VINCULACIÓN
 *
 *  Formato canónico:   A-K3F9-2XQ7-M8T4
 *                      │ └────────────┘
 *                      │       cuerpo: 12 caracteres
 *                      └─ persona ('A' o 'B')
 *
 *  El prefijo evita que haya que preguntar "¿eres la persona A o la B?": el
 *  propio código lo dice, y la app elige el asiento sola.
 *
 *  Alfabeto de 30 símbolos SIN caracteres ambiguos (no hay I, L, O, U): quien
 *  copie el código a mano desde un papel no puede confundir 0 con O ni 1 con l.
 *
 *  ENTROPÍA: 30^12 ≈ 5,3 × 10^17 combinaciones. A 10 intentos por segundo —
 *  imposible en la práctica, porque App Check bloquea a los clientes que no son
 *  el navegador — un ataque por fuerza bruta tardaría más de mil millones de
 *  años. Riesgo residual documentado y aceptado.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const ALFABETO_CODIGO = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const LARGO_CUERPO = 12;

/** Quita separadores, pasa a mayúsculas y descarta lo que no sea del alfabeto. */
export function normalizarCodigo(entrada: string): string {
  return entrada
    .toUpperCase()
    .split('')
    .filter((c) => c === 'A' || c === 'B' || ALFABETO_CODIGO.includes(c))
    .join('');
}

/** Da forma legible: A-K3F9-2XQ7-M8T4 */
export function formatearCodigo(persona: Persona, cuerpo: string): string {
  const grupos = cuerpo.match(/.{1,4}/g) ?? [];
  return `${persona.toUpperCase()}-${grupos.join('-')}`;
}

export interface CodigoParseado {
  persona: Persona;
  /** Cadena canónica exacta que se compara contra el asiento en el servidor. */
  canonico: string;
}

/**
 * Interpreta lo que la persona escribió. Tolera minúsculas, espacios y guiones
 * de más o de menos: quien teclea un código desde el móvil no debería pelearse
 * con el formato.
 */
export function parsearCodigo(entrada: string): CodigoParseado | null {
  const limpio = normalizarCodigo(entrada);
  if (limpio.length !== LARGO_CUERPO + 1) return null;

  const letra = limpio[0];
  if (letra !== 'A' && letra !== 'B') return null;

  const cuerpo = limpio.slice(1);
  if (![...cuerpo].every((c) => ALFABETO_CODIGO.includes(c))) return null;

  const persona = letra.toLowerCase() as Persona;
  return { persona, canonico: formatearCodigo(persona, cuerpo) };
}

/**
 * Genera un cuerpo de código a partir de una fuente de bytes criptográfica.
 *
 * `siguienteByte` debe venir de un CSPRNG (crypto.randomBytes / getRandomValues).
 * Se usa MUESTREO POR RECHAZO: 256 no es múltiplo de 30, así que aplicar el
 * módulo sin más haría que los 16 primeros símbolos del alfabeto salieran algo
 * más a menudo. Descartar los bytes ≥ 240 mantiene la distribución uniforme y
 * la entropía real en los 5,3 × 10^17 anunciados.
 */
export function generarCuerpo(siguienteByte: () => number): string {
  const limite = 256 - (256 % ALFABETO_CODIGO.length); // 240
  let cuerpo = '';
  while (cuerpo.length < LARGO_CUERPO) {
    const b = siguienteByte();
    if (b >= limite) continue;
    cuerpo += ALFABETO_CODIGO[b % ALFABETO_CODIGO.length];
  }
  return cuerpo;
}
