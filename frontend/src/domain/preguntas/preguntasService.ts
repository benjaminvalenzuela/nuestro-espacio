import {
  collection, doc, getDocs, getDoc, setDoc, updateDoc, onSnapshot,
  query, where, serverTimestamp, increment, type Unsubscribe,
} from 'firebase/firestore';
import { ref, onValue, runTransaction, serverTimestamp as tsRtdb } from 'firebase/database';
import { obtenerFirestore } from '../../infra/firebase/firestore';
import { obtenerRtdb } from '../../infra/firebase/rtdb';
import { FS, RTDB } from '@shared/rutas-datos';
import { CATEGORIAS_PREGUNTA, type CategoriaPregunta, type Persona } from '@shared/enums';
import { ahoraServidor } from '../tiempo/relojServidor';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  JUEGO DE PREGUNTAS
 *
 *  Dos requisitos que se resuelven aquí:
 *
 *   · "Ambos ven la misma carta": la pregunta activa vive en RTDB, no en el
 *     estado local. Quien pulsa "Siguiente" la publica y a la otra pantalla le
 *     llega sola.
 *
 *   · "Evitar repeticiones recientes": /preguntasServidas guarda cuándo salió
 *     cada una. Al elegir se descartan las N últimas — no es aleatorio puro,
 *     es aleatorio dentro de lo que hace tiempo que no sale.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type FiltroCategoria = CategoriaPregunta | 'mix';

export interface Pregunta {
  id: string;
  texto: string;
  categoria: CategoriaPregunta;
}

export interface PreguntaActiva {
  preguntaId: string;
  mostradaEn: number;
  servidaPor: Persona;
}

/** Ventana anti-repetición por defecto si /config/app no dice otra cosa. */
const VENTANA_POR_DEFECTO = 25;

/** Si dos pulsan "Siguiente" casi a la vez, el segundo se retira. */
const ANTIRREBOTE_MS = 1500;

export async function cargarPreguntas(filtro: FiltroCategoria): Promise<Pregunta[]> {
  const col = collection(obtenerFirestore(), FS.preguntas);
  const consulta =
    filtro === 'mix'
      ? query(col, where('activa', '==', true))
      : query(col, where('activa', '==', true), where('categoria', '==', filtro));

  const snap = await getDocs(consulta);
  return snap.docs
    .map((d) => {
      const x = d.data();
      return {
        id: d.id,
        texto: String(x.texto ?? ''),
        categoria: (CATEGORIAS_PREGUNTA as readonly string[]).includes(x.categoria)
          ? (x.categoria as CategoriaPregunta)
          : 'profundas',
      };
    })
    .filter((p) => p.texto.length > 0);
}

/** Mapa preguntaId -> última vez que salió (epoch ms). */
export function observarServidas(
  parejaId: string,
  alCambiar: (servidas: Map<string, number>) => void,
): Unsubscribe {
  return onSnapshot(
    collection(obtenerFirestore(), FS.preguntasServidas(parejaId)),
    (snap) => {
      const m = new Map<string, number>();
      for (const d of snap.docs) m.set(d.id, d.data().ultimaVezEn?.toMillis?.() ?? 0);
      alCambiar(m);
    },
    () => alCambiar(new Map()),
  );
}

export async function leerVentana(parejaId: string): Promise<number> {
  try {
    const d = await getDoc(doc(obtenerFirestore(), FS.configPareja(parejaId)));
    const v = d.data()?.ventanaAntiRepeticion;
    return typeof v === 'number' && v >= 0 ? v : VENTANA_POR_DEFECTO;
  } catch {
    return VENTANA_POR_DEFECTO;
  }
}

/**
 * Elige la siguiente pregunta descartando las más recientes.
 *
 * La ventana se recorta al 70 % del catálogo: con pocas preguntas cargadas, una
 * ventana de 25 dejaría cero candidatas y el juego se quedaría en blanco. Si
 * aun así no queda ninguna, se admite todo el catálogo — mejor repetir que no
 * dar nada.
 */
export function elegirPregunta(
  candidatas: Pregunta[],
  servidas: Map<string, number>,
  ventana: number,
  excluir?: string | null,
): Pregunta | null {
  if (candidatas.length === 0) return null;

  const tope = Math.min(ventana, Math.floor(candidatas.length * 0.7));
  const recientes = new Set(
    [...servidas.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, tope)
      .map(([id]) => id),
  );

  let elegibles = candidatas.filter((p) => !recientes.has(p.id) && p.id !== excluir);
  if (elegibles.length === 0) elegibles = candidatas.filter((p) => p.id !== excluir);
  if (elegibles.length === 0) elegibles = candidatas;

  return elegibles[Math.floor(Math.random() * elegibles.length)] ?? null;
}

/**
 * Escucha la carta en curso DE UNA CATEGORÍA.
 *
 * Cada filtro tiene su propio nodo. Antes había uno solo, compartido, y producía
 * el efecto que se reportó: sacabas una pregunta en "Mix", cambiabas a
 * "Profundas" y seguía en pantalla la misma aunque no perteneciera a esa
 * categoría. Las categorías son independientes; ahora los datos también.
 */
export function observarPreguntaActiva(
  parejaId: string,
  filtro: FiltroCategoria,
  alCambiar: (activa: PreguntaActiva | null) => void,
): Unsubscribe {
  return onValue(
    ref(obtenerRtdb(), RTDB.preguntaActiva(parejaId, filtro)),
    (snap) => {
      const v = snap.val();
      alCambiar(
        v && typeof v.preguntaId === 'string'
          ? {
              preguntaId: v.preguntaId,
              mostradaEn: Number(v.mostradaEn ?? 0),
              servidaPor: v.servidaPor === 'b' ? 'b' : 'a',
            }
          : null,
      );
    },
    () => alCambiar(null),
  );
}

/**
 * Publica una pregunta para los dos.
 *
 * La transacción con antirrebote evita el caso "los dos pulsan Siguiente a la
 * vez": el segundo se retira y ambos se quedan con la misma carta, en vez de
 * verla cambiar dos veces en medio segundo.
 *
 * @returns true si esta pantalla fue la que sirvió (y por tanto la que anota).
 */
export async function servirPregunta(
  parejaId: string,
  persona: Persona,
  pregunta: Pregunta,
  filtro: FiltroCategoria,
): Promise<boolean> {
  const tx = await runTransaction(
    ref(obtenerRtdb(), RTDB.preguntaActiva(parejaId, filtro)),
    (actual: { mostradaEn?: number } | null) => {
      if (actual && ahoraServidor() - Number(actual.mostradaEn ?? 0) < ANTIRREBOTE_MS) {
        return undefined; // la otra pantalla acaba de servir en esta categoría
      }
      return {
        preguntaId: pregunta.id,
        mostradaEn: tsRtdb(),
        servidaPor: persona,
      };
    },
  );

  return tx.committed;
}

/** Anota que la pregunta salió, para la ventana anti-repetición. */
export async function registrarServida(parejaId: string, preguntaId: string): Promise<void> {
  const referencia = doc(obtenerFirestore(), `${FS.preguntasServidas(parejaId)}/${preguntaId}`);
  try {
    // Las reglas exigen veces===1 al crear y +1 al actualizar, así que no vale
    // un set() genérico: hay que saber si el documento ya existía.
    await updateDoc(referencia, { veces: increment(1), ultimaVezEn: serverTimestamp() });
  } catch {
    await setDoc(referencia, { veces: 1, ultimaVezEn: serverTimestamp() }).catch(() => {});
  }
}
