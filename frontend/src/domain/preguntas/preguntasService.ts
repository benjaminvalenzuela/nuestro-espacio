import { doc, getDoc, setDoc, updateDoc, type Unsubscribe } from 'firebase/firestore';
import { ref, onValue, runTransaction, serverTimestamp as tsRtdb } from 'firebase/database';
import { obtenerFirestore } from '../../infra/firebase/firestore';
import { obtenerRtdb } from '../../infra/firebase/rtdb';
import { FS, RTDB } from '@shared/rutas-datos';
import { CATEGORIAS_PREGUNTA, type CategoriaPregunta, type Nivel, type Persona } from '@shared/enums';
import { ahoraServidor } from '../tiempo/relojServidor';
import { cargarPreguntas as cargarBanco } from '../banco/cacheBanco';
import { elegirCarta, contarPendientes } from '../banco/seleccion';
import type { EntradaProgreso } from '@shared/schemas/progreso.schema';

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
  nivel: Nivel;
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

/**
 * Trae las preguntas de una categoría desde la caché local.
 *
 * Antes esto consultaba Firestore en cada llamada. Con veinte preguntas era
 * gratis; con mil son mil lecturas por visita y el plan gratuito da cincuenta
 * mil al día. Ahora el catálogo se descarga una vez por dispositivo y el filtro
 * por categoría se hace en memoria, que además es instantáneo al cambiar de
 * pestaña.
 */
export async function cargarPreguntas(filtro: FiltroCategoria): Promise<Pregunta[]> {
  const todas = await cargarBanco();

  return todas
    .filter((p) => filtro === 'mix' || p.categoria === filtro)
    .map((p) => ({
      id: p.id,
      texto: p.texto,
      categoria: (CATEGORIAS_PREGUNTA as readonly string[]).includes(p.categoria)
        ? (p.categoria as CategoriaPregunta)
        : 'profundas',
      nivel: p.nivel,
    }));
}

/**
 * Elige la siguiente pregunta: descarta las pasadas tres veces, prioriza las
 * que nunca han salido y pondera por nivel. La lógica vive en banco/seleccion
 * porque el juego de dilemas necesita exactamente la misma.
 */
export function elegirSiguiente(
  candidatas: Pregunta[],
  progreso: Record<string, EntradaProgreso>,
  recientes: Set<string>,
  excluir?: string | null,
): Pregunta | null {
  return elegirCarta({ candidatas, progreso, recientes, excluir });
}

export { contarPendientes };

/** Mapa preguntaId -> última vez que salió (epoch ms). */
/**
 * Ids servidos hace poco, para no repetir la misma carta dos veces seguidas.
 *
 * Sale del propio progreso: cada carta guarda `t`, la última vez que apareció.
 * Antes esto vivía en una colección aparte, `preguntasServidas`, con un
 * documento por pregunta — el mismo problema de cuota que el resto: con mil
 * preguntas servidas, mil lecturas por apertura. Ahora es un cálculo en memoria
 * sobre datos que ya estaban cargados.
 */
export function recientesDe(
  progreso: Record<string, { t?: number }>,
  cuantas: number,
): Set<string> {
  return new Set(
    Object.entries(progreso)
      .filter(([, e]) => (e.t ?? 0) > 0)
      .sort((x, y) => (y[1].t ?? 0) - (x[1].t ?? 0))
      .slice(0, Math.max(0, cuantas))
      .map(([id]) => id),
  );
}

/** Ventana anti-repetición configurable desde el panel. */
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

/**
 * Anota que la pregunta salió. Alimenta la ventana anti-repetición.
 *
 * Escribe una sola ruta de campo para que el servidor fusione: si los dos
 * dispositivos anotan cartas distintas a la vez, ninguna pisa a la otra.
 */
export async function registrarServida(parejaId: string, preguntaId: string): Promise<void> {
  const referencia = doc(obtenerFirestore(), FS.progresoPreguntas(parejaId));
  const campo = { [`items.${preguntaId}.t`]: Date.now() };
  try {
    await updateDoc(referencia, campo);
  } catch {
    await setDoc(referencia, { items: {} }, { merge: true });
    await updateDoc(referencia, campo).catch(() => {});
  }
}
