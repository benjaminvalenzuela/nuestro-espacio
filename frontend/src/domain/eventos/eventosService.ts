import {
  doc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, type Unsubscribe,
} from 'firebase/firestore';
import { obtenerFirestore } from '../../infra/firebase/firestore';
import { FS } from '@shared/rutas-datos';
import { fechaISO } from '@shared/schemas/perfil.schema';
import { registrarRealizado } from '../panoramas/panoramasService';
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

/**
 * Cierra el evento sin más: lo descartan.
 *
 * No queda registro, y es deliberado. Un plan que se cancela porque llovió no
 * es parte del historial de "lo que hemos hecho juntos", y meterlo ahí
 * ensuciaría la única lista que se mira para decidir qué repetir.
 */
export async function cancelarEvento(parejaId: string): Promise<void> {
  await deleteDoc(doc(obtenerFirestore(), FS.eventoActual(parejaId)));
}

/**
 * Lo hicieron de verdad. Cuenta.
 *
 * Antes esto se anotaba en el momento del sorteo, y por eso el "Realizado 3
 * veces" de la ruleta contaba SORTEOS, no salidas: si giraban tres veces un
 * viernes por indecisión, el panorama sumaba tres sin que hubieran salido de
 * casa. Ahora suma cuando lo confirman aquí, que es cuando de verdad ocurrió.
 *
 * El orden importa. Primero se archiva en el historial, después se borra el
 * evento: si se cortara la conexión en medio, lo peor que puede pasar es que
 * el banner siga en pantalla y haya que pulsar otra vez. Al revés se perdería
 * el registro de una salida que sí ocurrió, y eso no se puede recuperar.
 *
 * El contador del panorama va aparte y tolera fallar: si lo archivaron desde
 * el panel, ya no existe el documento que incrementar, y eso no puede impedir
 * que se cierre el evento.
 */
export async function confirmarEvento(parejaId: string, evento: Evento): Promise<void> {
  // El documento del panorama lo escribe quien lo gobierna. Que este módulo
  // fuera a tocarlo por su cuenta sería la forma de que un día las dos partes
  // discrepen sobre qué campos lleva.
  await registrarRealizado(
    parejaId,
    { id: evento.panoramaId, nombre: evento.nombre },
    evento.giroId,
    evento.organizador,
  );

  await deleteDoc(doc(obtenerFirestore(), FS.eventoActual(parejaId)));
}

/** @deprecated Usa `cancelarEvento` o `confirmarEvento`, que sí se distinguen. */
export const cerrarEvento = cancelarEvento;
