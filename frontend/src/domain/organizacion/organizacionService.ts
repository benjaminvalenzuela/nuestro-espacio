import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
  increment,
  type Unsubscribe,
} from 'firebase/firestore';
import { obtenerFirestore } from '../../infra/firebase/firestore';
import { FS } from '@shared/rutas-datos';
import { PERSONAS, type Persona } from '@shared/enums';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  MARCADOR DE ORGANIZACIÓN
 *
 *  El requisito era "transparencia y equidad": un marcador histórico visible
 *  de quién ha organizado más citas. Por eso el contador vive en Firestore con
 *  reglas que solo admiten +1 — no es un número que la app dibuje, es un dato
 *  que ninguno de los dos puede inflar.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface Marcador {
  a: { veces: number; ultimaVezEn: number | null };
  b: { veces: number; ultimaVezEn: number | null };
}

const MARCADOR_VACIO: Marcador = {
  a: { veces: 0, ultimaVezEn: null },
  b: { veces: 0, ultimaVezEn: null },
};

export function observarMarcador(
  parejaId: string,
  alCambiar: (marcador: Marcador) => void,
): Unsubscribe {
  return onSnapshot(
    collection(obtenerFirestore(), FS.organizadores(parejaId)),
    (snap) => {
      const m: Marcador = structuredClone(MARCADOR_VACIO);
      for (const d of snap.docs) {
        if (d.id !== 'a' && d.id !== 'b') continue;
        const x = d.data();
        m[d.id] = {
          veces: Number(x.vecesOrganizado ?? 0),
          ultimaVezEn: x.ultimaVezEn?.toMillis?.() ?? null,
        };
      }
      alCambiar(m);
    },
    (e) => {
      console.warn('[organizacion] lectura rechazada:', e.message);
      alCambiar(structuredClone(MARCADOR_VACIO));
    },
  );
}

/**
 * Anota que a esta persona le tocó organizar.
 *
 * increment(1) es atómico en el servidor y las reglas solo aceptan +1 exacto:
 * el marcador de equidad no se puede manipular ni por accidente ni a propósito.
 */
export async function registrarOrganizador(
  parejaId: string,
  persona: Persona,
  giroId: string,
): Promise<void> {
  const db = obtenerFirestore();

  await updateDoc(doc(db, FS.organizador(parejaId, persona)), {
    vecesOrganizado: increment(1),
    ultimaVezEn: serverTimestamp(),
  });

  await addDoc(collection(db, FS.historialOrganizacion(parejaId)), {
    personaElegida: persona,
    giroId,
    ocurridoEn: serverTimestamp(),
  });
}

/**
 * Crea los documentos del marcador si faltan. Las reglas exigen que nazcan en
 * 0, así que no hay forma de "empezar con ventaja".
 */
export async function asegurarMarcador(parejaId: string): Promise<void> {
  const db = obtenerFirestore();
  await Promise.all(
    PERSONAS.map((p) =>
      setDoc(
        doc(db, FS.organizador(parejaId, p)),
        { vecesOrganizado: 0, ultimaVezEn: null },
        { merge: true },
      ).catch(() => {
        /* ya existía, o lo creó la otra persona a la vez */
      }),
    ),
  );
}
