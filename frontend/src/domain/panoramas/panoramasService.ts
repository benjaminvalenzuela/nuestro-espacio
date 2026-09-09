import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  increment,
  type Unsubscribe,
} from 'firebase/firestore';
import { obtenerFirestore } from '../../infra/firebase/firestore';
import { FS } from '@shared/rutas-datos';
import { textoSeguro } from '@shared/schemas/perfil.schema';
import { normalizarNombre } from '@shared/panoramas';
import type { Persona } from '@shared/enums';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  PANORAMAS — la lista que alimenta la ruleta.
 *
 *  Aquí vive el "contador histórico para saber cuántas veces se ha hecho un
 *  plan y decidir si se repite": `vecesRealizado`, que solo puede subir de uno
 *  en uno y solo cuando un giro lo elige.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface Panorama {
  id: string;
  nombre: string;
  creadoPor: Persona;
  vecesRealizado: number;
  ultimaVezEn: number | null;
  peso: number;
  activo: boolean;
}

const NombrePanorama = textoSeguro(2, 80);

// La normalización vive en `shared` para que el seed del backend aplique la
// misma regla; se reexporta porque es parte de la API pública de este servicio.
export { normalizarNombre };

export class ErrorPanorama extends Error {}

/** Escucha la lista activa en tiempo real: lo que uno agrega aparece en la otra pantalla. */
export function observarPanoramas(
  parejaId: string,
  alCambiar: (panoramas: Panorama[]) => void,
): Unsubscribe {
  const consulta = query(
    collection(obtenerFirestore(), FS.panoramas(parejaId)),
    where('activo', '==', true),
    orderBy('nombreNormalizado'),
  );

  return onSnapshot(
    consulta,
    (snap) => {
      alCambiar(
        snap.docs.map((d) => {
          const x = d.data();
          return {
            id: d.id,
            nombre: String(x.nombre ?? ''),
            creadoPor: (x.creadoPor === 'b' ? 'b' : 'a') as Persona,
            vecesRealizado: Number(x.vecesRealizado ?? 0),
            ultimaVezEn: x.ultimaVezEn?.toMillis?.() ?? null,
            peso: Number(x.peso ?? 1),
            activo: x.activo !== false,
          };
        }),
      );
    },
    (e) => {
      console.warn('[panoramas] lectura rechazada:', e.message);
      alCambiar([]);
    },
  );
}

export async function agregarPanorama(
  parejaId: string,
  persona: Persona,
  nombreCrudo: string,
  existentes: Panorama[],
): Promise<void> {
  // Capa 1 de 3 contra XSS: el mismo contrato que aplican las Security Rules.
  const validado = NombrePanorama.safeParse(nombreCrudo);
  if (!validado.success) {
    throw new ErrorPanorama(validado.error.issues[0]?.message ?? 'Nombre no válido');
  }

  const nombre = validado.data;
  const nombreNormalizado = normalizarNombre(nombre);

  if (existentes.some((p) => normalizarNombre(p.nombre) === nombreNormalizado)) {
    throw new ErrorPanorama('Ese panorama ya está en la lista.');
  }

  await addDoc(collection(obtenerFirestore(), FS.panoramas(parejaId)), {
    nombre,
    nombreNormalizado,
    creadoPor: persona,
    creadoEn: serverTimestamp(),
    activo: true,
    peso: 1,
    vecesRealizado: 0,
    ultimaVezEn: null,
  });
}

/**
 * Borrado lógico (ADR-010). El documento sobrevive para que el historial no
 * quede huérfano: "fuimos al cerro 3 veces" sigue teniendo sentido aunque el
 * plan ya no esté en la rueda.
 */
export async function archivarPanorama(parejaId: string, panoramaId: string): Promise<void> {
  await updateDoc(doc(obtenerFirestore(), FS.panorama(parejaId, panoramaId)), {
    activo: false,
  });
}

/**
 * Registra que un panorama SE HIZO. Lo llama la confirmación del banner, no la
 * ruleta: que el sorteo pare en un plan no significa que hayan salido de casa.
 *
 * El orden importa. Primero el historial, después el contador: si se corta la
 * conexión en medio, queda constancia de la salida aunque el número no suba.
 * Al revés se perdería el registro, que es lo único irrecuperable.
 *
 * increment(1) es una operación ATÓMICA del servidor, no un leer-modificar-
 * escribir: aunque llegaran dos escrituras a la vez, ninguna pisa a la otra.
 * Y las reglas solo aceptan exactamente +1, así que el marcador no se puede
 * inflar ni desde un cliente manipulado.
 *
 * El contador tolera fallar. Si el panorama se archivó desde el panel, su
 * documento ya no acepta la escritura, y eso no puede impedir que se cierre un
 * evento que ocurrió de verdad.
 */
export async function registrarRealizado(
  parejaId: string,
  panorama: { id: string; nombre: string },
  giroId: string,
  organizador: Persona | null,
): Promise<void> {
  const db = obtenerFirestore();

  await addDoc(collection(db, FS.historialPanoramas(parejaId)), {
    panoramaId: panorama.id,
    nombreSnapshot: panorama.nombre,
    giroId,
    confirmado: true,
    ocurridoEn: serverTimestamp(),
    ...(organizador ? { organizador } : {}),
  });

  await updateDoc(doc(db, FS.panorama(parejaId, panorama.id)), {
    vecesRealizado: increment(1),
    ultimaVezEn: serverTimestamp(),
  }).catch((e) => console.warn('[panoramas] contador no actualizado:', e?.message));
}
