import {
  doc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, type Unsubscribe,
} from 'firebase/firestore';
import { obtenerFirestore } from '../../infra/firebase/firestore';
import { FS } from '@shared/rutas-datos';
import { fechaISO } from '@shared/schemas/perfil.schema';
import type { Persona } from '@shared/enums';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  EVENTO EN CURSO
 *
 *  El resultado del flujo de la ruleta: qué panorama salió, a quién le toca
 *  organizarlo y —cuando lo decidan— qué día es. Es un documento ÚNICO: solo
 *  hay un panorama pendiente a la vez. Girar otra vez lo reemplaza.
 *
 *  Las reglas solo dejan cambiar `fecha` en un update: ni el panorama ni el
 *  organizador se pueden reescribir desde el banner. Para cambiarlos hay que
 *  volver a girar — que es justo lo que hace justo al sorteo.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface Evento {
  panoramaId: string;
  nombre: string;
  organizador: Persona;
  /** AAAA-MM-DD, o null mientras no le pongan fecha. */
  fecha: string | null;
  giroId: string;
  creadoEn: number | null;
}

export class ErrorEvento extends Error {}

export function observarEvento(
  parejaId: string,
  alCambiar: (evento: Evento | null) => void,
): Unsubscribe {
  return onSnapshot(
    doc(obtenerFirestore(), FS.eventoActual(parejaId)),
    (snap) => {
      const x = snap.data();
      if (!snap.exists() || !x) {
        alCambiar(null);
        return;
      }
      alCambiar({
        panoramaId: String(x.panoramaId ?? ''),
        nombre: String(x.nombre ?? ''),
        organizador: x.organizador === 'b' ? 'b' : 'a',
        fecha: typeof x.fecha === 'string' ? x.fecha : null,
        giroId: String(x.giroId ?? ''),
        creadoEn: x.creadoEn?.toMillis?.() ?? null,
      });
    },
    (e) => {
      console.warn('[eventos] lectura rechazada:', e.message);
      alCambiar(null);
    },
  );
}

/** Crea o reemplaza el evento. Lo llama el flujo de la ruleta al terminar. */
export async function crearEvento(
  parejaId: string,
  datos: { panoramaId: string; nombre: string; organizador: Persona; giroId: string },
): Promise<void> {
  await setDoc(doc(obtenerFirestore(), FS.eventoActual(parejaId)), {
    panoramaId: datos.panoramaId,
    nombre: datos.nombre.trim(),
    organizador: datos.organizador,
    fecha: null,
    giroId: datos.giroId,
    creadoEn: serverTimestamp(),
    actualizadoEn: serverTimestamp(),
  });
}

/** Pone o quita la fecha desde el banner del inicio. */
export async function fijarFecha(parejaId: string, fecha: string | null): Promise<void> {
  if (fecha !== null && !fechaISO.safeParse(fecha).success) {
    throw new ErrorEvento('Fecha no válida.');
  }
  await updateDoc(doc(obtenerFirestore(), FS.eventoActual(parejaId)), {
    fecha,
    actualizadoEn: serverTimestamp(),
  });
}

/** Cierra el evento (lo hicieron, o lo descartan). */
export async function cerrarEvento(parejaId: string): Promise<void> {
  await deleteDoc(doc(obtenerFirestore(), FS.eventoActual(parejaId)));
}
