import {
  collection, getDocs, addDoc, query, where, serverTimestamp, type Unsubscribe,
} from 'firebase/firestore';
import {
  ref, onValue, set, update, runTransaction, serverTimestamp as tsRtdb,
} from 'firebase/database';
import { obtenerFirestore } from '../../infra/firebase/firestore';
import { obtenerRtdb } from '../../infra/firebase/rtdb';
import { FS, RTDB } from '@shared/rutas-datos';
import type { Persona } from '@shared/enums';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  "QUÉ PREFIERES" · VOTACIÓN CIEGA CON REVELACIÓN SIMULTÁNEA
 *
 *  La parte delicada del proyecto. El requisito es que ninguno pueda ver la
 *  respuesta del otro antes de haber votado — y eso NO puede depender de que
 *  el cliente se porte bien, porque el cliente es código público que cualquiera
 *  puede abrir en DevTools.
 *
 *  Quien lo garantiza es el servidor. La regla de /votos dice:
 *
 *      ".read": "... && data.child('a').exists() && data.child('b').exists()"
 *
 *  Mientras falte un voto, LEER ese nodo devuelve permission_denied. No es que
 *  la app oculte el dato: es que no se lo entregan.
 *
 *  Consecuencia de diseño: como el listener queda denegado, la UI necesita otra
 *  señal para saber cuándo reintentar. Esa señal es /meta/votosEmitidos, un
 *  contador PÚBLICO y sin valor de seguridad: aunque alguien lo falsee, la
 *  lectura de los votos sigue cerrada.
 *
 *  Cada ronda es un nodo nuevo, así que los votos son de escritura única para
 *  siempre y nunca hay que borrarlos para empezar otra.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface Dilema {
  id: string;
  opcionA: string;
  opcionB: string;
  categoria: string;
}

export interface MetaRonda {
  dilemaId: string;
  abiertoEn: number;
  votosEmitidos: number;
}

export type Opcion = 'A' | 'B';
export type Votos = Partial<Record<Persona, { opcion: Opcion; emitidoEn: number }>>;

export async function cargarDilemas(): Promise<Dilema[]> {
  const snap = await getDocs(
    query(collection(obtenerFirestore(), FS.dilemas), where('activo', '==', true)),
  );
  return snap.docs
    .map((d) => {
      const x = d.data();
      return {
        id: d.id,
        opcionA: String(x.opcionA ?? ''),
        opcionB: String(x.opcionB ?? ''),
        categoria: String(x.categoria ?? 'general'),
      };
    })
    .filter((d) => d.opcionA && d.opcionB);
}

/** Puntero a la ronda en curso: lo que sincroniza a las dos pantallas. */
export function observarRondaActual(
  parejaId: string,
  alCambiar: (rondaId: string | null) => void,
): Unsubscribe {
  return onValue(
    ref(obtenerRtdb(), `${RTDB.estadoSala(parejaId)}/rondaDilemaActual`),
    (snap) => alCambiar(typeof snap.val() === 'string' ? snap.val() : null),
    () => alCambiar(null),
  );
}

/**
 * Abre una ronda nueva. Devuelve su id.
 *
 * El id lo genera quien abre; si los dos abren a la vez, el puntero acaba
 * apuntando a una de las dos rondas y ambos convergen ahí — la otra queda
 * huérfana y sin votos, lo cual es inofensivo.
 */
export async function abrirRonda(parejaId: string, dilemaId: string): Promise<string> {
  const rondaId = crypto.randomUUID();

  await set(ref(obtenerRtdb(), RTDB.metaRonda(parejaId, rondaId)), {
    dilemaId,
    abiertoEn: tsRtdb(),
    votosEmitidos: 0,
  });

  await update(ref(obtenerRtdb(), RTDB.estadoSala(parejaId)), {
    rondaDilemaActual: rondaId,
  });

  return rondaId;
}

export function observarMeta(
  parejaId: string,
  rondaId: string,
  alCambiar: (meta: MetaRonda | null) => void,
): Unsubscribe {
  return onValue(
    ref(obtenerRtdb(), RTDB.metaRonda(parejaId, rondaId)),
    (snap) => {
      const v = snap.val();
      alCambiar(
        v && typeof v.dilemaId === 'string'
          ? {
              dilemaId: v.dilemaId,
              abiertoEn: Number(v.abiertoEn ?? 0),
              votosEmitidos: Number(v.votosEmitidos ?? 0),
            }
          : null,
      );
    },
    () => alCambiar(null),
  );
}

export class ErrorVoto extends Error {}

/**
 * Emite el voto. Escritura ÚNICA: las reglas rechazan un segundo intento, así
 * que no se puede votar, ver el del otro y cambiar el propio.
 */
export async function votar(
  parejaId: string,
  rondaId: string,
  persona: Persona,
  opcion: Opcion,
): Promise<void> {
  try {
    await set(ref(obtenerRtdb(), RTDB.votoDe(parejaId, rondaId, persona)), {
      opcion,
      emitidoEn: tsRtdb(),
    });
  } catch {
    throw new ErrorVoto('Ya votaste en esta ronda.');
  }

  // Señal para la UI, no control de seguridad (ver cabecera del archivo).
  await runTransaction(
    ref(obtenerRtdb(), `${RTDB.metaRonda(parejaId, rondaId)}/votosEmitidos`),
    (n: number | null) => Math.min(2, (n ?? 0) + 1),
  ).catch(() => {});
}

/** Espera entre reintentos tras una lectura denegada. */
const REINTENTO_VOTOS_MS = 1200;

/**
 * Intenta leer los votos, reintentando mientras el servidor deniegue.
 *
 * `alDenegar` NO es un error: es el estado normal mientras falte un voto. El
 * servidor está haciendo exactamente su trabajo.
 *
 * ⚠ POR QUÉ HAY QUE REINTENTAR A MANO
 * Cuando RTDB deniega una lectura, CANCELA la suscripción — no la reintenta
 * nunca. Se descubrió probando: al forzar una lectura con un solo voto, el
 * listener murió, y cuando después llegó el segundo voto ya no había nadie
 * escuchando: la revelación se quedaba colgada para siempre. Sin este bucle,
 * cualquier denegación pasajera (una renovación de token, por ejemplo) rompería
 * la ronda de forma irrecuperable.
 */
export function observarVotos(
  parejaId: string,
  rondaId: string,
  alCambiar: (votos: Votos) => void,
  alDenegar: () => void,
): Unsubscribe {
  const referencia = ref(obtenerRtdb(), RTDB.votosRonda(parejaId, rondaId));
  let cancelar: Unsubscribe | undefined;
  let temporizador = 0;
  let vivo = true;

  const suscribir = () => {
    if (!vivo) return;
    cancelar = onValue(
      referencia,
      (snap) => alCambiar((snap.val() ?? {}) as Votos),
      () => {
        alDenegar();
        temporizador = window.setTimeout(suscribir, REINTENTO_VOTOS_MS);
      },
    );
  };

  suscribir();

  return () => {
    vivo = false;
    window.clearTimeout(temporizador);
    cancelar?.();
  };
}

/**
 * Archiva la partida revelada.
 *
 * Se disputa con una transacción sobre `meta/archivada`, igual que el cierre de
 * la ruleta: si las dos pantallas intentan archivar, solo una escribe en
 * Firestore. Sin esto quedarían dos registros de la misma ronda.
 *
 * La regla del campo solo admite pasar de ausente a true, así que tampoco se
 * puede "desarchivar" para duplicar la partida.
 */
export async function archivarPartida(
  parejaId: string,
  rondaId: string,
  dilemaId: string,
  votos: Required<Votos>,
): Promise<void> {
  const tx = await runTransaction(
    ref(obtenerRtdb(), `${RTDB.metaRonda(parejaId, rondaId)}/archivada`),
    (ya: boolean | null) => (ya ? undefined : true),
  );
  if (!tx.committed) return;

  await addDoc(collection(obtenerFirestore(), FS.partidasDilemas(parejaId)), {
    dilemaId,
    iniciadaEn: serverTimestamp(),
    cerradaEn: serverTimestamp(),
    votos: { a: votos.a.opcion, b: votos.b.opcion },
    coincidieron: votos.a.opcion === votos.b.opcion,
  }).catch((e) => console.warn('[dilemas] no se pudo archivar:', e?.message));
}
