import { ZONA_HORARIA, LOCALE } from '@shared/enums';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  CONTADOR DE TIEMPO JUNTOS
 *
 *  Se calcula en AÑOS, MESES y DÍAS de calendario, no dividiendo milisegundos.
 *  Dividir por 365 daría "2 años y 11 meses" el día del aniversario, porque los
 *  años bisiestos y los meses de distinta duración no cuadran. La gente cuenta
 *  el tiempo por el calendario, y el aniversario tiene que caer exacto.
 *
 *  Las fechas se guardan como AAAA-MM-DD (sin hora) y se comparan contra el día
 *  civil en Santiago, así que el cambio de horario no mueve el contador.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface TiempoJuntos {
  anios: number;
  meses: number;
  dias: number;
  /** Días totales, para el detalle secundario. */
  totalDias: number;
  /** Texto listo para pintar. */
  texto: string;
  /** Días que faltan para el próximo aniversario (0 = es hoy). */
  paraAniversario: number;
}

/** Día civil actual en Santiago, como AAAA-MM-DD. */
export function hoyEnSantiago(ahora = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ahora);
}

function partes(iso: string): [number, number, number] {
  const [a, m, d] = iso.split('-').map(Number);
  return [a ?? 0, m ?? 1, d ?? 1];
}

/** Días del mes, contando bisiestos. */
function diasDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

function aDiasAbsolutos(iso: string): number {
  const [a, m, d] = partes(iso);
  return Math.floor(Date.UTC(a, m - 1, d) / 86_400_000);
}

const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

export function calcularTiempoJuntos(desdeISO: string, ahora = Date.now()): TiempoJuntos | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desdeISO)) return null;

  const hoyISO = hoyEnSantiago(ahora);
  const [ad, md, dd] = partes(desdeISO);
  const [ah, mh, dh] = partes(hoyISO);

  let anios = ah - ad;
  let meses = mh - md;
  let dias = dh - dd;

  if (dias < 0) {
    meses -= 1;
    // Se toma la duración del mes ANTERIOR al actual: es el que se acaba de
    // completar, y es lo que hace que "31 de enero + 1 mes" no se desmadre.
    const mesPrevio = mh - 1 === 0 ? 12 : mh - 1;
    const anioPrevio = mh - 1 === 0 ? ah - 1 : ah;
    dias += diasDelMes(anioPrevio, mesPrevio);
  }
  if (meses < 0) {
    anios -= 1;
    meses += 12;
  }

  if (anios < 0) return null; // fecha futura: no hay nada que contar todavía

  const totalDias = aDiasAbsolutos(hoyISO) - aDiasAbsolutos(desdeISO);

  const trozos: string[] = [];
  if (anios > 0) trozos.push(plural(anios, 'año', 'años'));
  if (meses > 0) trozos.push(plural(meses, 'mes', 'meses'));
  if (dias > 0 || trozos.length === 0) trozos.push(plural(dias, 'día', 'días'));

  const texto =
    trozos.length === 1 ? trozos[0]!
    : `${trozos.slice(0, -1).join(', ')} y ${trozos.at(-1)}`;

  // Próximo aniversario: mismo día y mes, este año o el que viene.
  let anioAniv = ah;
  const diaMesYaPaso = mh > md || (mh === md && dh > dd);
  if (diaMesYaPaso) anioAniv += 1;
  const diaAniv = Math.min(dd, diasDelMes(anioAniv, md));
  const paraAniversario =
    Math.floor(Date.UTC(anioAniv, md - 1, diaAniv) / 86_400_000) - aDiasAbsolutos(hoyISO);

  return { anios, meses, dias, totalDias, texto, paraAniversario };
}

/** Fecha larga y legible en Santiago, para mostrar la fecha memorable. */
export function fechaLarga(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: ZONA_HORARIA, day: 'numeric', month: 'long', year: 'numeric',
  }).format(Date.parse(`${iso}T12:00:00Z`));
}
