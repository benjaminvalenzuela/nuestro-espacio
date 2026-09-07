import type { Giro } from '@shared/schemas/giro.schema';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  MATEMÁTICA DEL GIRO — funciones puras, sin Firebase ni DOM.
 *
 *  Todo lo de aquí es determinista: mismas entradas, mismo resultado, en
 *  cualquier dispositivo. Es lo que permite que dos pantallas muestren la misma
 *  animación sin hablar entre ellas durante el giro.
 *
 *  Al ser puro, además, se testea sin red ni navegador (Paso 4).
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * PRNG mulberry32. Se usa un generador propio en vez de Math.random porque
 * necesitamos que sea REPRODUCIBLE: ambos dispositivos parten de la misma
 * semilla y deben obtener exactamente las mismas vueltas.
 */
export function crearRng(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semilla nueva para un giro. Solo la genera quien reclama el turno. */
export function semillaNueva(): number {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0]! >>> 1; // positivo y holgado para las reglas
}

/**
 * Índice ganador. Admite pesos: un panorama con peso 3 entra tres veces en el
 * bombo sin ocupar tres porciones en la rueda.
 */
export function elegirIndice(rng: () => number, pesos: number[]): number {
  const total = pesos.reduce((s, p) => s + Math.max(1, p), 0);
  let objetivo = rng() * total;
  for (let i = 0; i < pesos.length; i++) {
    objetivo -= Math.max(1, pesos[i]!);
    if (objetivo <= 0) return i;
  }
  return pesos.length - 1;
}

const VUELTAS_MIN = 5;
const VUELTAS_EXTRA = 4;

/**
 * Ángulo total, en grados, que recorre la rueda hasta detenerse.
 *
 * Convención: el puntero está arriba (las 12) y la rueda gira en sentido
 * horario. La porción `k` está centrada en `k*paso + paso/2` medido desde las
 * 12. Para dejarla bajo el puntero hay que girar el complementario.
 */
export function anguloFinal(giro: Pick<Giro, 'semilla' | 'indiceGanador' | 'opcionesSnapshot'>): number {
  const n = Math.max(1, giro.opcionesSnapshot.length);
  const paso = 360 / n;
  const rng = crearRng(giro.semilla);
  const vueltas = VUELTAS_MIN + Math.floor(rng() * VUELTAS_EXTRA);

  const centro = giro.indiceGanador * paso + paso / 2;
  const alineacion = (360 - (centro % 360)) % 360;

  return vueltas * 360 + alineacion;
}

/** Desaceleración natural: rápido al principio, se posa al final. */
export function suavizado(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export interface EstadoAnimacion {
  /** Grados de rotación aplicados a la rueda en este instante. */
  angulo: number;
  /** 0 → 1 */
  progreso: number;
  terminado: boolean;
}

/**
 * Estado de la animación en un instante dado.
 *
 * `ahoraServidor` debe venir del reloj corregido (ver relojServidor.ts). Usar
 * Date.now() a secas desincronizaría las pantallas tanto como esté desviado el
 * reloj del dispositivo — que en móviles puede ser de varios segundos.
 */
export function estadoEn(giro: Giro, ahoraServidor: number): EstadoAnimacion {
  const transcurrido = ahoraServidor - giro.iniciadoEn;
  const progreso = Math.min(1, Math.max(0, transcurrido / giro.duracionMs));
  return {
    angulo: suavizado(progreso) * anguloFinal(giro),
    progreso,
    terminado: progreso >= 1,
  };
}

/** ¿La animación debe omitirse? Accesibilidad: respeta la preferencia del sistema. */
export function prefiereMenosMovimiento(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
