import { ZONA_HORARIA, LOCALE } from '@shared/enums';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  FORMATO DE FECHAS
 *
 *  Los datos se guardan SIEMPRE en UTC (epoch ms puestos por el servidor) y se
 *  formatean aquí en America/Santiago. Nunca al revés.
 *
 *  Por qué importa en Chile: hay cambio de horario dos veces al año. Guardar
 *  la hora local haría que "última conexión: 22:15" se corriera una hora en
 *  septiembre y en abril, y que el contador de "llevamos X días juntos"
 *  pegara un salto. Con epoch UTC eso no puede pasar.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const hora = new Intl.DateTimeFormat(LOCALE, {
  timeZone: ZONA_HORARIA,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const diaMes = new Intl.DateTimeFormat(LOCALE, {
  timeZone: ZONA_HORARIA,
  day: 'numeric',
  month: 'long',
});

const completo = new Intl.DateTimeFormat(LOCALE, {
  timeZone: ZONA_HORARIA,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Día del calendario en Santiago, para comparar "hoy" y "ayer" sin errores de UTC. */
function diaCivil(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ms);
}

/**
 * Texto corto y exacto para la última conexión.
 * El requisito pide fecha y hora exactas, así que nunca se queda en
 * "hace un rato" sin más: siempre acompaña la hora concreta.
 */
export function formatearUltimaConexion(ms: number | null, ahora = Date.now()): string {
  if (!ms) return 'sin conexiones registradas';

  const diff = ahora - ms;
  const hoy = diaCivil(ahora);
  const dia = diaCivil(ms);

  const ayer = diaCivil(ahora - 86_400_000);

  if (diff < 60_000) return `hace un momento · ${hora.format(ms)}`;
  if (dia === hoy) return `hoy a las ${hora.format(ms)}`;
  if (dia === ayer) return `ayer a las ${hora.format(ms)}`;
  return `el ${diaMes.format(ms)} a las ${hora.format(ms)}`;
}

/** Versión larga para el atributo title: la fecha y hora sin ninguna ambigüedad. */
export function formatearCompleto(ms: number | null): string {
  return ms ? completo.format(ms) : 'sin registro';
}

/** Valor para <time datetime="...">, en ISO 8601 UTC. */
export function aISO(ms: number | null): string | undefined {
  return ms ? new Date(ms).toISOString() : undefined;
}
