/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  SIGNO ZODIACAL
 *
 *  Se deduce de la fecha de nacimiento: no es un campo que nadie escriba, es
 *  una consecuencia. Eso evita el estado inconsistente clásico —fecha de
 *  febrero y signo "Leo" porque alguien lo eligió mal en un desplegable.
 *
 *  Los límites son los convencionales del zodiaco tropical. Varían un día
 *  según la fuente y el año astronómico real; aquí se fijan de una vez, porque
 *  lo importante es que sean estables y no que una app de pareja resuelva una
 *  discusión astronómica.
 *
 *  La fecha entra como texto ISO (AAAA-MM-DD) y se parte a mano en vez de usar
 *  `new Date`: construir una fecha desde una cadena la interpreta en UTC y
 *  luego el navegador la muestra en horario local, lo que en Chile puede
 *  restarle un día. Alguien nacido un 1 de enero acabaría siendo Sagitario.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface Signo {
  nombre: string;
  emoji: string;
  elemento: 'Fuego' | 'Tierra' | 'Aire' | 'Agua';
}

/** [mesInicio, díaInicio, signo]. Ordenados; el último tramo vuelve a Capricornio. */
const TRAMOS: readonly [number, number, Signo][] = [
  [1, 20, { nombre: 'Acuario', emoji: '♒', elemento: 'Aire' }],
  [2, 19, { nombre: 'Piscis', emoji: '♓', elemento: 'Agua' }],
  [3, 21, { nombre: 'Aries', emoji: '♈', elemento: 'Fuego' }],
  [4, 20, { nombre: 'Tauro', emoji: '♉', elemento: 'Tierra' }],
  [5, 21, { nombre: 'Géminis', emoji: '♊', elemento: 'Aire' }],
  [6, 21, { nombre: 'Cáncer', emoji: '♋', elemento: 'Agua' }],
  [7, 23, { nombre: 'Leo', emoji: '♌', elemento: 'Fuego' }],
  [8, 23, { nombre: 'Virgo', emoji: '♍', elemento: 'Tierra' }],
  [9, 23, { nombre: 'Libra', emoji: '♎', elemento: 'Aire' }],
  [10, 23, { nombre: 'Escorpio', emoji: '♏', elemento: 'Agua' }],
  [11, 22, { nombre: 'Sagitario', emoji: '♐', elemento: 'Fuego' }],
  [12, 22, { nombre: 'Capricornio', emoji: '♑', elemento: 'Tierra' }],
];

const CAPRICORNIO = TRAMOS[11]![2];

/**
 * Devuelve el signo de una fecha ISO, o null si la fecha no es válida.
 *
 * Antes del 20 de enero todavía es Capricornio, que empezó en diciembre: por
 * eso el valor por defecto y el último tramo son el mismo signo.
 */
export function signoDe(fechaISO: string | null | undefined): Signo | null {
  if (!fechaISO) return null;

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaISO.trim());
  if (!m) return null;

  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;

  let signo: Signo = CAPRICORNIO;
  for (const [mesInicio, diaInicio, s] of TRAMOS) {
    if (mes > mesInicio || (mes === mesInicio && dia >= diaInicio)) signo = s;
  }
  return signo;
}

/** "♌ Leo · Fuego", listo para pintar. */
export function signoLegible(fechaISO: string | null | undefined): string {
  const s = signoDe(fechaISO);
  return s ? `${s.emoji} ${s.nombre} · ${s.elemento}` : '';
}

/**
 * Edad en años cumplidos.
 *
 * Se compara por partes de la fecha, no restando milisegundos: dividir por la
 * duración de un año da resultados que bailan un día en los años bisiestos, y
 * el día del cumpleaños es justo cuando alguien lo mira.
 */
export function edadDe(fechaISO: string | null | undefined, hoyISO: string): number | null {
  if (!fechaISO) return null;
  const n = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaISO.trim());
  const h = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hoyISO.trim());
  if (!n || !h) return null;

  let edad = Number(h[1]) - Number(n[1]);
  const cumplioEsteAno =
    Number(h[2]) > Number(n[2]) ||
    (Number(h[2]) === Number(n[2]) && Number(h[3]) >= Number(n[3]));
  if (!cumplioEsteAno) edad--;

  return edad >= 0 && edad < 130 ? edad : null;
}
