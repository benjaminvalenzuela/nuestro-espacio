import { ref, onValue, runTransaction, serverTimestamp, type Unsubscribe } from 'firebase/database';
import { obtenerRtdb } from '../../infra/firebase/rtdb';
import { RTDB } from '@shared/rutas-datos';
import { parsearGiro, DURACION_GIRO_MS, type Giro } from '@shared/schemas/giro.schema';
import type { Persona, Ruleta } from '@shared/enums';
import { semillaNueva, crearRng, elegirIndice } from './animacionGiro';
import { ahoraServidor } from '../tiempo/relojServidor';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  SERVICIO DE RULETA — ADR-003
 *
 *  El problema real: los dos pulsan "Girar" en el mismo segundo. Sin defensa,
 *  cada pantalla sortearía su propio resultado y verían cosas distintas. La
 *  solución tiene DOS capas, y hacen falta las dos:
 *
 *   1. TRANSACCIÓN (aquí). RTDB serializa: uno escribe, el otro reintenta y ve
 *      que ya hay un giro en curso, así que se retira y se suma al del ganador.
 *
 *   2. REGLA DE SERVIDOR (database.rules.json). Aunque un cliente manipulado se
 *      saltara la transacción, el servidor rechaza escribir un giro nuevo
 *      mientras haya uno en curso. La transacción es cooperativa; la regla no.
 *
 *  El perdedor no ve un error: ve el giro del otro, con la misma semilla y el
 *  mismo resultado. Desde fuera, los dos pulsaron y giró una sola rueda.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Un giro atascado más de esto se considera abandonado (corte de red a mitad). */
const CADUCIDAD_GIRO_MS = 30_000;

export interface OpcionRuleta {
  id: string;
  etiqueta: string;
  /** 1–5. Más peso = más probabilidad, sin ocupar más espacio en la rueda. */
  peso?: number;
}

export type ResultadoReclamo =
  | { resultado: 'reclamado'; giro: Giro }
  | { resultado: 'ocupado' }
  | { resultado: 'sin-opciones' };

/**
 * Intenta reclamar el turno y dejar el giro fijado en el servidor.
 *
 * Devolver `undefined` desde el manejador aborta la transacción: es la forma
 * de decir "ya hay un giro en curso, no toco nada".
 */
export async function reclamarGiro(
  parejaId: string,
  ruleta: Ruleta,
  persona: Persona,
  opciones: OpcionRuleta[],
): Promise<ResultadoReclamo> {
  if (opciones.length === 0) return { resultado: 'sin-opciones' };

  const semilla = semillaNueva();
  const rng = crearRng(semilla);
  const indiceGanador = elegirIndice(
    rng,
    opciones.map((o) => o.peso ?? 1),
  );

  const propuesta = {
    id: crypto.randomUUID(),
    estado: 'girando' as const,
    iniciadoPor: persona,
    semilla,
    indiceGanador,
    opcionesSnapshot: opciones.map((o) => o.etiqueta),
    // Sentinela del servidor: se resuelve al confirmar la transacción, no aquí.
    // Por eso el reloj del dispositivo no puede falsear el inicio del giro.
    iniciadoEn: serverTimestamp(),
    duracionMs: DURACION_GIRO_MS,
    confirmadoEn: null,
  };

  const refGiro = ref(obtenerRtdb(), RTDB.giro(parejaId, ruleta));

  const tx = await runTransaction(refGiro, (actual: Giro | null) => {
    const enCurso = actual?.estado === 'girando';
    const abandonado =
      enCurso && ahoraServidor() - (actual?.iniciadoEn ?? 0) > CADUCIDAD_GIRO_MS;

    if (enCurso && !abandonado) return undefined; // abortar: gana el otro
    return propuesta;
  });

  if (!tx.committed) return { resultado: 'ocupado' };

  const giro = parsearGiro(tx.snapshot.val());
  return giro ? { resultado: 'reclamado', giro } : { resultado: 'ocupado' };
}

/** Escucha el giro en curso. Es la única fuente de verdad para ambas pantallas. */
export function observarGiro(
  parejaId: string,
  ruleta: Ruleta,
  alCambiar: (giro: Giro | null) => void,
): Unsubscribe {
  return onValue(
    ref(obtenerRtdb(), RTDB.giro(parejaId, ruleta)),
    (snap) => alCambiar(parsearGiro(snap.val())),
    () => alCambiar(null),
  );
}

/**
 * Cierra el giro al terminar la animación y dice si ESTE dispositivo es el
 * responsable de anotar el resultado en Firestore.
 *
 * ⚠ POR QUÉ UNA TRANSACCIÓN Y NO UN SIMPLE update()
 * La primera versión decidía con `giro.iniciadoPor === miPersona`. Al probarlo
 * con dos pestañas abiertas apareció el fallo: son la MISMA persona, así que
 * ambas se creían responsables y el contador subía +2 con un solo giro. No es
 * un caso raro — es exactamente el escenario "tengo el PC y el celular
 * abiertos" que el sistema soporta a propósito.
 *
 * Con la transacción, el cierre lo gana UN dispositivo y solo ese anota. Como
 * efecto secundario bueno: si a quien giró se le cae la red a mitad de la
 * animación, el otro cierra el giro y el resultado igual queda registrado.
 *
 * @returns true si a este dispositivo le toca persistir el resultado.
 */
export async function cerrarGiro(
  parejaId: string,
  ruleta: Ruleta,
  giroId: string,
): Promise<boolean> {
  const tx = await runTransaction(ref(obtenerRtdb(), RTDB.giro(parejaId, ruleta)), (actual: Giro | null) => {
    if (!actual || actual.id !== giroId) return undefined; // ya hay otro giro
    if (actual.estado === 'resuelto') return undefined;    // otro dispositivo se adelantó
    return { ...actual, estado: 'resuelto' as const, confirmadoEn: serverTimestamp() };
  });

  return tx.committed;
}

/** Etiqueta ganadora de un giro ya resuelto. */
export function ganadorDe(giro: Giro): string {
  return giro.opcionesSnapshot[giro.indiceGanador] ?? '—';
}
