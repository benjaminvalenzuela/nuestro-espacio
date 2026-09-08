import {
  ref, onValue, update, remove, get, runTransaction, serverTimestamp as tsRtdb,
  type Unsubscribe,
} from 'firebase/database';
import {
  doc, setDoc, addDoc, collection, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { obtenerRtdb } from '../../infra/firebase/rtdb';
import { obtenerFirestore } from '../../infra/firebase/firestore';
import { FS, RTDB } from '@shared/rutas-datos';
import {
  CATEGORIAS_POR_DEFECTO, MAX_CATEGORIAS, categoriaValida,
  letraDeSemilla, puntuarRonda, ganadorDe,
  type RespuestasPartida, type Ganador,
} from '@shared/bachillerato';
import { semillaNueva } from '../ruleta/animacionGiro';
import type { Persona } from '@shared/enums';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  BACHILLERATO · partida sincronizada
 *
 *  La partida vive en RTDB porque se escribe en cada tecla. Las categorías y el
 *  historial viven en Firestore, que es donde va lo que debe durar.
 *
 *  LA LETRA NO SE GUARDA. Se deriva de la semilla con `letraDeSemilla`, igual
 *  que el resultado de la ruleta de panoramas se deriva de la suya. Guardarla
 *  permitiría que una pantalla mostrara una letra y la otra, distinta, si una
 *  escritura llegara a medias; derivándola eso es imposible por construcción.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type EstadoPartida = 'esperando' | 'girando' | 'jugando' | 'revisando';

export interface Partida {
  estado: EstadoPartida;
  semilla: number;
  rondaId: string;
  iniciadoEn: number;
  stopPor: Persona | null;
  acumulado: Record<Persona, number>;
  respuestas: RespuestasPartida;
}

export const PARTIDA_VACIA: Partida = {
  estado: 'esperando',
  semilla: 0,
  rondaId: '',
  iniciadoEn: 0,
  stopPor: null,
  acumulado: { a: 0, b: 0 },
  respuestas: {},
};

export const DURACION_RULETA_MS = 3600;

export class ErrorBachillerato extends Error {}

// ── Categorías (Firestore) ──────────────────────────────────────────────────

export function observarCategorias(
  parejaId: string,
  alCambiar: (categorias: string[]) => void,
): Unsubscribe {
  return onSnapshot(
    doc(obtenerFirestore(), FS.bachilleratoConfig(parejaId)),
    (snap) => {
      const v = snap.data()?.categorias;
      const lista = Array.isArray(v) ? v.map(String).filter(categoriaValida) : [];
      alCambiar(lista.length > 0 ? lista : [...CATEGORIAS_POR_DEFECTO]);
    },
    () => alCambiar([...CATEGORIAS_POR_DEFECTO]),
  );
}

export async function guardarCategorias(parejaId: string, categorias: string[]): Promise<void> {
  const limpias = categorias.map((c) => c.trim()).filter(categoriaValida);

  if (limpias.length === 0) throw new ErrorBachillerato('Deja al menos una categoría.');
  if (limpias.length > MAX_CATEGORIAS) {
    throw new ErrorBachillerato(`Como mucho ${MAX_CATEGORIAS} categorías.`);
  }
  // Sin repetidas: dos columnas con el mismo nombre harían imposible saber a
  // cuál corresponde cada respuesta.
  const vistas = new Set<string>();
  for (const c of limpias) {
    const k = c.toLowerCase();
    if (vistas.has(k)) throw new ErrorBachillerato(`"${c}" está repetida.`);
    vistas.add(k);
  }

  await setDoc(doc(obtenerFirestore(), FS.bachilleratoConfig(parejaId)), {
    categorias: limpias,
    actualizadoEn: serverTimestamp(),
  });
}

// ── Partida (RTDB) ──────────────────────────────────────────────────────────

export function observarPartida(
  parejaId: string,
  alCambiar: (p: Partida) => void,
): Unsubscribe {
  const referencia = ref(obtenerRtdb(), RTDB.bachillerato(parejaId));

  const suscribir = () =>
    onValue(
      referencia,
      (snap) => {
        const raiz = (snap.val() ?? {}) as Record<string, unknown>;
        const c = (raiz.control ?? {}) as Record<string, unknown>;
        const acumulado = (c.acumulado ?? {}) as Record<string, unknown>;

        alCambiar({
          estado: ['esperando', 'girando', 'jugando', 'revisando'].includes(String(c.estado))
            ? (c.estado as EstadoPartida)
            : 'esperando',
          semilla: Number(c.semilla ?? 0),
          rondaId: String(c.rondaId ?? ''),
          iniciadoEn: Number(c.iniciadoEn ?? 0),
          stopPor: c.stopPor === 'a' || c.stopPor === 'b' ? c.stopPor : null,
          acumulado: { a: Number(acumulado.a ?? 0), b: Number(acumulado.b ?? 0) },
          respuestas: (raiz.respuestas ?? {}) as RespuestasPartida,
        });
      },
      (e) => {
        // RTDB cancela la suscripción ante un rechazo y no reintenta sola. Sin
        // este bucle, un permission-denied del arranque dejaría la partida
        // congelada hasta recargar la página.
        console.info('[bachillerato] resuscribiendo:', e.message);
        setTimeout(suscribir, 1200);
      },
    );

  return suscribir();
}

/**
 * Gira la ruleta de letras.
 *
 * Transacción: si los dos pulsan a la vez, uno gana y el otro ve el mismo
 * resultado. La letra sale de la semilla, así que ambas pantallas la calculan
 * igual sin intercambiar nada.
 */
export async function girarLetra(parejaId: string): Promise<boolean> {
  const referencia = ref(obtenerRtdb(), RTDB.bachilleratoControl(parejaId));

  const tx = await runTransaction(referencia, (actual: Record<string, unknown> | null) => {
    // No se interrumpe una ronda en curso.
    if (actual && (actual.estado === 'girando' || actual.estado === 'jugando')) return undefined;

    return {
      ...(actual ?? {}),
      estado: 'girando',
      semilla: semillaNueva(),
      rondaId: `r${Date.now().toString(36)}`,
      iniciadoEn: tsRtdb(),
      stopPor: null,
    };
  });

  // El tablero se limpia aparte: las respuestas viven en otro nodo, y cada uno
  // solo puede borrar las suyas.
  if (tx.committed) await limpiarMisRespuestas(parejaId).catch(() => {});

  return tx.committed;
}

/** Pasa de la animación al juego. La llama quien terminó de ver girar. */
export async function empezarRonda(parejaId: string): Promise<void> {
  await update(ref(obtenerRtdb(), RTDB.bachilleratoControl(parejaId)), { estado: 'jugando' });
}

/** Guarda una respuesta propia. Las reglas impiden escribir la fila del otro. */
export async function escribirRespuesta(
  parejaId: string,
  persona: Persona,
  categoria: string,
  valor: string,
): Promise<void> {
  const limpio = valor.slice(0, 40);
  if (/[<>]/.test(limpio)) throw new ErrorBachillerato('No se admiten los caracteres < ni >.');

  await update(ref(obtenerRtdb(), RTDB.bachilleratoRespuestas(parejaId, persona)), {
    [categoria.replace(/[.#$/[\]]/g, '_')]: limpio,
  });
}

/**
 * STOP. Cierra la ronda para los dos y suma los puntos al acumulado.
 *
 * La suma va dentro de una transacción sobre el nodo entero: si los dos pulsan
 * STOP en el mismo segundo, solo la primera cierra y la segunda se retira. Sin
 * eso, los puntos de la ronda se sumarían dos veces al marcador.
 */
export async function pararRonda(
  parejaId: string,
  persona: Persona,
  categorias: string[],
): Promise<{ cerro: boolean; puntajes: Record<Persona, number> }> {
  const control = ref(obtenerRtdb(), RTDB.bachilleratoControl(parejaId));
  const respuestas = await leerRespuestas(parejaId);
  let puntajes: Record<Persona, number> = { a: 0, b: 0 };

  const tx = await runTransaction(control, (actual: Record<string, unknown> | null) => {
    if (!actual || actual.estado !== 'jugando') return undefined;   // ya se cerró

    const letra = letraDeSemilla(Number(actual.semilla ?? 0));
    const resultado = puntuarRonda(categorias, respuestas, letra);
    puntajes = resultado.puntajes;

    const previo = (actual.acumulado ?? {}) as Record<string, unknown>;
    return {
      ...actual,
      estado: 'revisando',
      stopPor: persona,
      acumulado: {
        a: Number(previo.a ?? 0) + resultado.puntajes.a,
        b: Number(previo.b ?? 0) + resultado.puntajes.b,
      },
    };
  });

  return { cerro: tx.committed, puntajes };
}

/**
 * Reinicia la partida a cero.
 *
 * Devuelve el marcador que había ANTES de borrarlo, porque es justo lo que la
 * pantalla necesita para anunciar quién ganó: reiniciar sin decir el resultado
 * de lo que se acaba de borrar sería perder la partida sin más.
 */
export async function reiniciarPartida(
  parejaId: string,
  categorias: string[],
): Promise<{ puntajes: Record<Persona, number>; ganador: Ganador; hubo: boolean }> {
  const control = ref(obtenerRtdb(), RTDB.bachilleratoControl(parejaId));
  let puntajes: Record<Persona, number> = { a: 0, b: 0 };
  let letra = '';

  await runTransaction(control, (actual: Record<string, unknown> | null) => {
    const previo = (actual?.acumulado ?? {}) as Record<string, unknown>;
    puntajes = { a: Number(previo.a ?? 0), b: Number(previo.b ?? 0) };
    letra = actual ? letraDeSemilla(Number(actual.semilla ?? 0)) : '';

    return {
      estado: 'esperando',
      semilla: 0,
      rondaId: '',
      iniciadoEn: 0,
      stopPor: null,
      acumulado: { a: 0, b: 0 },
    };
  });

  await limpiarMisRespuestas(parejaId).catch(() => {});

  const hubo = puntajes.a > 0 || puntajes.b > 0;
  const ganador = ganadorDe(puntajes);

  // El historial solo guarda partidas que se jugaron: reiniciar un tablero
  // vacío no es una partida y ensuciaría el registro.
  if (hubo) {
    await addDoc(collection(obtenerFirestore(), FS.bachilleratoHistorial(parejaId)), {
      letra,
      puntajeA: puntajes.a,
      puntajeB: puntajes.b,
      ganador,
      rondas: categorias.length,
      jugadaEn: serverTimestamp(),
    }).catch((e) => console.warn('[bachillerato] no se pudo archivar:', e?.message));
  }

  return { puntajes, ganador, hubo };
}

/**
 * Borra las respuestas PROPIAS.
 *
 * Cada uno solo puede borrar su fila —lo imponen las reglas— así que al
 * empezar una ronda cada dispositivo limpia la suya. El del otro la limpia
 * cuando le llegue el cambio de ronda.
 */
export async function limpiarMisRespuestas(parejaId: string): Promise<void> {
  const persona = personaActual;
  if (!persona) return;
  await remove(ref(obtenerRtdb(), RTDB.bachilleratoRespuestas(parejaId, persona)));
}

/** Lectura puntual de las respuestas, para puntuar sin depender del snapshot. */
async function leerRespuestas(parejaId: string): Promise<RespuestasPartida> {
  const snap = await get(ref(obtenerRtdb(), `${RTDB.bachillerato(parejaId)}/respuestas`));
  return (snap.val() ?? {}) as RespuestasPartida;
}

/**
 * Quién es esta pantalla. Se fija al arrancar el juego.
 *
 * Hace falta porque limpiar el tablero es una operación por persona: no existe
 * un "borrar todo", justamente porque nadie puede tocar la fila del otro.
 */
let personaActual: Persona | null = null;
export function fijarPersona(p: Persona): void { personaActual = p; }

export { letraDeSemilla, puntuarRonda, ganadorDe };
