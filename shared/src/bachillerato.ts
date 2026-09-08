import { PERSONAS, type Persona } from './enums.js';
import { normalizarNombre } from './panoramas.js';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  BACHILLERATO (tutti frutti / basta)
 *
 *  Sale una letra al azar, los dos escriben una palabra por categoría, alguien
 *  pulsa STOP y se cuentan los puntos:
 *
 *      0    no escribiste nada
 *      50   los dos escribieron lo mismo
 *      100  escribiste algo distinto a lo del otro
 *
 *  DECISIONES QUE NO SE VEN PERO IMPORTAN:
 *
 *  · "Lo mismo" se decide con la misma normalización que los panoramas: sin
 *    tildes, sin mayúsculas y sin espacios de sobra. "Ámbar" y "ambar" son la
 *    misma palabra, y discutirlo a las once de la noche no le gusta a nadie.
 *
 *  · Una palabra que NO EMPIEZA POR LA LETRA vale cero. Es la única regla del
 *    juego que la máquina puede arbitrar sin ambigüedad, así que la arbitra.
 *
 *  · Si el otro no escribió nada y tú sí, son 100: tu palabra no se parece a
 *    nada. Que el rival no conteste no puede penalizarte.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const PUNTOS_VACIO = 0;
export const PUNTOS_REPETIDO = 50;
export const PUNTOS_UNICO = 100;

/**
 * Alfabeto de la ruleta. Sin Ñ, K, W, X ni Y: en español apenas hay palabras
 * comunes con ellas y sacarlas solo produce rondas en blanco.
 */
export const LETRAS = 'ABCDEFGHIJLMNOPRSTUV'.split('');

export const CATEGORIAS_POR_DEFECTO = [
  'Nombre', 'Animal', 'Comida', 'Color', 'País o ciudad', 'Objeto',
];

export const MAX_CATEGORIAS = 20;
export const MAX_LARGO_CATEGORIA = 40;
export const MAX_LARGO_RESPUESTA = 40;

/**
 * "Lo mismo" se decide con la MISMA normalización que los panoramas, importada
 * de allí en vez de reescrita.
 *
 * Duplicarla habría sido más rápido y habría envejecido mal: el día que se
 * corrigiera un caso raro en un sitio, el otro seguiría con el fallo y dos
 * partes de la app discreparían sobre si dos palabras son iguales.
 */
export const normalizarRespuesta = normalizarNombre;

/** ¿Empieza por la letra que tocó? Compara ya normalizado, para que "Á" valga por "A". */
export function empiezaPorLetra(respuesta: string, letra: string): boolean {
  const limpia = normalizarRespuesta(respuesta);
  if (limpia.length === 0) return false;
  return limpia.startsWith(normalizarRespuesta(letra));
}

export interface ResultadoCelda {
  respuesta: string;
  puntos: number;
  /** Por qué esos puntos, para poder explicarlo en pantalla. */
  motivo: 'vacia' | 'letra_incorrecta' | 'repetida' | 'unica';
}

export type RespuestasPersona = Record<string, string>;
export type RespuestasPartida = Partial<Record<Persona, RespuestasPersona>>;

export interface ResultadoRonda {
  /** Por categoría y persona. */
  celdas: Record<string, Partial<Record<Persona, ResultadoCelda>>>;
  puntajes: Record<Persona, number>;
}

function evaluarCelda(
  propia: string,
  ajena: string,
  letra: string,
): ResultadoCelda {
  const limpiaPropia = normalizarRespuesta(propia ?? '');

  if (limpiaPropia.length === 0) {
    return { respuesta: '', puntos: PUNTOS_VACIO, motivo: 'vacia' };
  }
  if (!empiezaPorLetra(propia, letra)) {
    return { respuesta: propia.trim(), puntos: PUNTOS_VACIO, motivo: 'letra_incorrecta' };
  }

  const limpiaAjena = normalizarRespuesta(ajena ?? '');
  // El rival solo "repite" si su palabra también es válida: una palabra que no
  // empieza por la letra no cuenta como coincidencia.
  const ajenaValida = limpiaAjena.length > 0 && empiezaPorLetra(ajena, letra);

  if (ajenaValida && limpiaAjena === limpiaPropia) {
    return { respuesta: propia.trim(), puntos: PUNTOS_REPETIDO, motivo: 'repetida' };
  }
  return { respuesta: propia.trim(), puntos: PUNTOS_UNICO, motivo: 'unica' };
}

export function puntuarRonda(
  categorias: string[],
  respuestas: RespuestasPartida,
  letra: string,
): ResultadoRonda {
  const celdas: ResultadoRonda['celdas'] = {};
  const puntajes: Record<Persona, number> = { a: 0, b: 0 };

  for (const categoria of categorias) {
    celdas[categoria] = {};
    for (const persona of PERSONAS) {
      const otra: Persona = persona === 'a' ? 'b' : 'a';
      const celda = evaluarCelda(
        respuestas[persona]?.[categoria] ?? '',
        respuestas[otra]?.[categoria] ?? '',
        letra,
      );
      celdas[categoria]![persona] = celda;
      puntajes[persona] += celda.puntos;
    }
  }

  return { celdas, puntajes };
}

export type Ganador = Persona | 'empate';

export function ganadorDe(puntajes: Record<Persona, number>): Ganador {
  if (puntajes.a === puntajes.b) return 'empate';
  return puntajes.a > puntajes.b ? 'a' : 'b';
}

/**
 * Elige letra a partir de una semilla del servidor.
 *
 * Determinista a propósito: los dos dispositivos calculan la MISMA letra desde
 * la misma semilla, así que la ruleta gira igual en las dos pantallas sin
 * necesidad de que una le mande el resultado a la otra. Es el mismo principio
 * que la ruleta de panoramas.
 */
export function letraDeSemilla(semilla: number): string {
  const indice = Math.abs(Math.floor(semilla)) % LETRAS.length;
  return LETRAS[indice]!;
}

export function indiceDeLetra(letra: string): number {
  const i = LETRAS.indexOf(letra.toUpperCase());
  return i >= 0 ? i : 0;
}

/** Valida el nombre de una categoría con las mismas reglas que el resto de textos. */
export function categoriaValida(v: string): boolean {
  const limpia = v.trim();
  return (
    limpia.length >= 2 &&
    limpia.length <= MAX_LARGO_CATEGORIA &&
    !/[<>]/.test(limpia)
  );
}
