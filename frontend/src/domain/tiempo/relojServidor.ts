import { ref, onValue } from 'firebase/database';
import { obtenerRtdb } from '../../infra/firebase/rtdb';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  RELOJ DEL SERVIDOR
 *
 *  El problema: la animación se calcula como (ahora − iniciadoEn). `iniciadoEn`
 *  lo pone el servidor; `ahora` lo pone el dispositivo. Si el celular va tres
 *  segundos adelantado respecto al portátil, las dos ruedas girarían desfasadas
 *  — y una de ellas empezaría ya avanzada, o se quedaría corta.
 *
 *  La solución la regala Firebase: `/.info/serverTimeOffset` es un nodo
 *  sintético con la diferencia estimada entre el reloj local y el del servidor.
 *  Se mantiene solo, no cuesta cuota y se recalibra en cada reconexión.
 * ─────────────────────────────────────────────────────────────────────────────
 */

let desfase = 0;
let vigilando = false;

export function iniciarRelojServidor(): void {
  if (vigilando) return;
  vigilando = true;

  onValue(ref(obtenerRtdb(), '.info/serverTimeOffset'), (snap) => {
    const v = snap.val();
    if (typeof v === 'number' && Number.isFinite(v)) desfase = v;
  });
}

/** Hora actual según el servidor, en milisegundos epoch. */
export function ahoraServidor(): number {
  return Date.now() + desfase;
}

/** Desfase detectado, en ms. Útil para diagnóstico. */
export function desfaseReloj(): number {
  return desfase;
}
