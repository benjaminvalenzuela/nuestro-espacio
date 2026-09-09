import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  CONTRASTE DE LOS COLORES, MEDIDO
 *
 *  Este test existe porque el fallo que arregla no se ve mirando el código.
 *  `bg-acento text-white` parece perfectamente razonable; lo que no se ve es
 *  que en tema oscuro el acento se aclara para verse sobre el fondo y el
 *  resultado es texto blanco sobre rosa claro: 2,7:1, ilegible al sol.
 *
 *  Tampoco se ve retocando un hex «para que quede un poco más bonito». Ahí es
 *  donde este test se pone rojo, que es todo lo que se le pide.
 *
 *  El umbral es 4,5:1, el mínimo de WCAG AA para texto normal. Los pares
 *  listados son los que la app usa de verdad, no todas las combinaciones
 *  posibles: un par que nadie pinta no merece un test.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CSS = readFileSync(resolve(import.meta.dirname, '../src/styles/global.css'), 'utf8');

const MINIMO_AA = 4.5;

/**
 * Los tokens se leen del CSS de verdad, no se copian aquí. Copiarlos
 * convertiría el test en una segunda fuente de verdad que se desincroniza en
 * silencio: mediría el contraste de unos colores que ya no son los que se
 * pintan.
 */
function tokens(bloque: string): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const m of bloque.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    salida[m[1]!] = m[2]!.toLowerCase();
  }
  return salida;
}

// El primer bloque `:root` es el tema claro; el resto del archivo redefine los
// mismos nombres para el oscuro.
const corte = CSS.indexOf(":root[data-tema='dark']");
expect(corte).toBeGreaterThan(0);

const CLARO = tokens(CSS.slice(0, corte));
const OSCURO = { ...CLARO, ...tokens(CSS.slice(corte)) };

function luminancia(hex: string): number {
  const canal = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lineal = canal.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lineal[0]! + 0.7152 * lineal[1]! + 0.0722 * lineal[2]!;
}

function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/**
 * LO QUE ESTA LISTA DEJA FUERA, A SABIENDAS.
 *
 * `--tinta-tenue` es el tercer escalón de la escala de grises y en tema claro
 * da 2,9:1 sobre blanco. No pasa AA y no está en la lista de abajo.
 *
 * No es un olvido: la escala tiene tres niveles a propósito —tinta,
 * tinta-suave, tinta-tenue— y subir el tercero por encima de 4,5:1 lo deja
 * casi pegado al segundo, con lo que la jerarquía visual de toda la app se
 * aplana para ganar un nivel de contraste en textos de apoyo.
 *
 * Lo que sí se hizo fue sacar de `tinta-tenue` los textos donde de verdad
 * importa leer: la leyenda del calendario usa `tinta-suave`, que sí pasa.
 */

/**
 * Pares [nombre, texto, fondo] que DEBEN cumplir AA en los dos temas.
 *
 * Las cuatro fases entran aquí desde que el rojo y el ámbar del tema claro
 * bajaron un peldaño de luminosidad (#d93838 → #c62828, #d97706 → #92400e).
 * Antes daban 3,99:1 y 2,89:1 y vivían en una lista aparte de excepciones
 * toleradas; esa lista ya no existe, y no debería volver.
 */
const PARES: [string, string, string][] = [
  ['acento sobre tarjeta', 'acento', 'superficie'],
  ['acento sobre su tinte', 'acento', 'acento-suave'],
  ['acento sobre el fondo', 'acento', 'fondo'],
  ['salvia sobre tarjeta', 'salvia', 'superficie'],
  ['salvia sobre su tinte', 'salvia', 'salvia-suave'],
  ['salvia sobre el fondo', 'salvia', 'fondo'],
  ['peligro sobre tarjeta', 'peligro', 'superficie'],
  ['tinta sobre tarjeta', 'tinta', 'superficie'],
  ['tinta-suave sobre tarjeta', 'tinta-suave', 'superficie'],
  ['botón principal', 'sobre-acento', 'boton-acento-fondo'],
  ['botón principal al pasar por encima', 'sobre-acento', 'boton-acento-hover'],
  ['botón de confirmar', 'sobre-ok', 'boton-ok-fondo'],
  ['fase menstruación', 'ciclo-menstruacion-tinta', 'ciclo-menstruacion-fondo'],
  ['fase folicular', 'ciclo-folicular-tinta', 'ciclo-folicular-fondo'],
  ['fase ovulación', 'ciclo-ovulacion-tinta', 'ciclo-ovulacion-fondo'],
  ['fase lútea', 'ciclo-lutea-tinta', 'ciclo-lutea-fondo'],
  ['círculo de hoy', 'ciclo-sobre-neutro', 'ciclo-neutro'],
];

/**
 * Marcas que se pintan ENCIMA de cualquiera de las cuatro fases: el punto de
 * síntomas y el aro de la ventana fértil. No son texto, así que el mínimo es
 * el 3:1 de WCAG para objetos gráficos.
 *
 * Este es el test que justifica que esas dos marcas sean neutras en vez de
 * llevar color de fase: tienen que funcionar sobre los cuatro fondos, y un
 * color temático solo puede garantizarlo sobre el suyo.
 */
const MINIMO_GRAFICO = 3;

const FONDOS_DE_FASE = [
  'ciclo-menstruacion-fondo',
  'ciclo-folicular-fondo',
  'ciclo-ovulacion-fondo',
  'ciclo-lutea-fondo',
];

describe.each([
  ['claro', CLARO],
  ['oscuro', OSCURO],
])('Contraste en tema %s', (_tema, paleta) => {
  const dame = (nombre: string) => {
    const v = paleta[nombre];
    expect(v, `falta el token --${nombre}`).toBeTruthy();
    return v!;
  };

  it.each(PARES)('%s alcanza AA', (_nombre, texto, fondo) => {
    expect(contraste(dame(texto), dame(fondo))).toBeGreaterThanOrEqual(MINIMO_AA);
  });

  it.each(FONDOS_DE_FASE)('el punto de síntomas se ve sobre %s', (fondo) => {
    expect(contraste(dame('ciclo-neutro'), dame(fondo))).toBeGreaterThanOrEqual(MINIMO_GRAFICO);
  });

  it.each(['ciclo-folicular-fondo', 'ciclo-lutea-fondo'])(
    'el aro de día fértil se ve sobre %s',
    (fondo) => {
      expect(contraste(dame('ciclo-fertil'), dame(fondo))).toBeGreaterThanOrEqual(MINIMO_GRAFICO);
    },
  );
});

describe('Contraste · la propia medición', () => {
  /**
   * Un test de contraste que midiera mal daría luz verde a una paleta
   * ilegible. Estos tres son los valores que define la especificación, así
   * que si la fórmula se rompe, se rompen aquí primero.
   */
  it('negro sobre blanco da 21:1', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('un color contra sí mismo da 1:1', () => {
    expect(contraste('#3c7a52', '#3c7a52')).toBeCloseTo(1, 5);
  });

  it('el orden de los argumentos no cambia el resultado', () => {
    expect(contraste('#ffffff', '#767676')).toBeCloseTo(contraste('#767676', '#ffffff'), 6);
  });

  it('detecta un par que NO pasa', () => {
    // Blanco sobre el rosa original: el fallo que se corrigió. 2,7:1.
    expect(contraste('#ffffff', '#e08195')).toBeLessThan(MINIMO_AA);
  });
});
