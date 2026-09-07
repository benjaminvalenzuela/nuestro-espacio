/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  PANORAMAS · reglas de dominio compartidas
 *
 *  Vive en `shared` y no en el frontend porque el seed del backend necesita
 *  EXACTAMENTE la misma normalización: si el navegador y el script de carga
 *  discreparan aunque fuese en una tilde, la lista acabaría con duplicados
 *  invisibles ("Ir al cerro" y "Ir al Cerro") que además desvirtúan las
 *  probabilidades de la ruleta.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Marcadores fuera del rango imprimible: no pueden aparecer en un nombre. */
const CENTINELA_ENIE = '\u0001';
const CENTINELA_DIERESIS = '\u0002';

/**
 * Clave de deduplicación: sin tildes, en minúsculas y con espacios colapsados.
 *
 * El rango U+0300–U+036F son las marcas diacríticas combinantes: tras `NFD`,
 * la tilde de "Cristóbal" queda como carácter aparte y aquí se descarta.
 *
 * LA Ñ ES LA EXCEPCIÓN, y es deliberada. `NFD` también la descompone en `n` +
 * tilde, así que un borrado ingenuo de diacríticos haría de "Año nuevo" y
 * "Ano nuevo" el mismo panorama. En español la ñ es una letra por derecho
 * propio, no una n adornada: se aparta antes de descomponer y se restituye
 * después. Lo mismo vale para la ü de "pingüino".
 */
export function normalizarNombre(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/ñ/g, CENTINELA_ENIE)
    .replace(/ü/g, CENTINELA_DIERESIS)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll(CENTINELA_ENIE, 'ñ')
    .replaceAll(CENTINELA_DIERESIS, 'ü')
    .replace(/\s+/g, ' ');
}
