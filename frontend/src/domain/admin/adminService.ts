import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, onSnapshot, setDoc,
  query, orderBy, limit, serverTimestamp, writeBatch, type Unsubscribe,
} from 'firebase/firestore';
import { obtenerFirestore } from '../../infra/firebase/firestore';
import { FS } from '@shared/rutas-datos';
import type { CategoriaPregunta, CategoriaDilema, Persona } from '@shared/enums';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  PANEL DE ADMINISTRACIÓN
 *
 *  Gestiona el sistema sin tocar el código: banco de preguntas y dilemas,
 *  limpieza de historiales y configuración.
 *
 *  Dos principios que se aplican aquí y no son negociables:
 *
 *   · BORRADO LÓGICO (ADR-010). "Eliminar" una pregunta la marca inactiva; el
 *     documento sobrevive para que el historial no quede huérfano. Las reglas
 *     directamente prohíben el delete en /preguntas y /dilemas.
 *
 *   · AUDITORÍA. Toda acción destructiva deja rastro en /auditoria, que es
 *     append-only e inmutable incluso para quien la escribió. Si un historial
 *     desaparece, se sabe quién y cuándo.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export class ErrorAdmin extends Error {}

export interface ItemPregunta {
  id: string;
  texto: string;
  categoria: CategoriaPregunta;
  activa: boolean;
}

export interface ItemDilema {
  id: string;
  opcionA: string;
  opcionB: string;
  categoria: CategoriaDilema;
  activo: boolean;
}



/**
 * Deja constancia de una acción. Se llama ANTES de la operación destructiva:
 * si la auditoría falla, no se destruye nada.
 *
 * ⚠ Riesgo residual conocido: las Security Rules no pueden exigir que un
 * borrado venga acompañado de su entrada de auditoría (no hay transacciones
 * entre documentos en las reglas). El orden lo garantiza el cliente.
 */
export async function auditar(
  parejaId: string,
  actor: Persona,
  accion: string,
  recurso: string,
): Promise<void> {
  await addDoc(collection(obtenerFirestore(), FS.auditoria(parejaId)), {
    actor, accion, recurso, ocurridoEn: serverTimestamp(), origen: 'admin',
  });
}

/**
 * El alta y la baja del banco viven en `bancoAdmin.ts`.
 *
 * Estaban aquí, con `onSnapshot` sobre la colección entera. Con veinte
 * preguntas era gratis; con dos mil son dos mil lecturas cada vez que se abre
 * el panel y otras dos mil por cada cambio. Se movieron a un módulo que lee de
 * la caché compartida con el juego y filtra en memoria.
 */

// ── Limpiezas ──────────────────────────────────────────────────────────────

/**
 * ═════════════════════════════════════════════════════════════════════════
 *  LO ÚNICO QUE EL PANEL PUEDE BORRAR
 *
 *  Esta lista es una lista BLANCA, y es la única forma de llegar a un delete
 *  masivo desde la aplicación. Todo lo que no esté aquí es inalcanzable para
 *  el botón de limpieza, por construcción y no por cuidado:
 *
 *      NUNCA se puede limpiar desde aquí
 *      ├── perfiles ................ lo que escribieron el uno del otro
 *      ├── panoramas ............... con su contador de veces realizadas
 *      ├── preguntas y dilemas ..... el banco; las reglas prohíben el delete
 *      ├── progreso ................ qué cartas están hechas
 *      ├── ciclo ................... menstruaciones, síntomas, relaciones
 *      ├── perfilConjunto .......... fechas memorables e hitos
 *      └── auditoría ............... append-only incluso para quien la escribe
 *
 *  Son los tres historiales y nada más. Añadir una entrada a este objeto es
 *  darle al botón acceso a borrar algo nuevo: piénsalo dos veces.
 * ═════════════════════════════════════════════════════════════════════════
 */
export type Coleccion = 'historialPanoramas' | 'historialOrganizacion' | 'partidasDilemas';

export const RUTA_LIMPIABLE: Record<Coleccion, (p: string) => string> = {
  historialPanoramas: FS.historialPanoramas,
  historialOrganizacion: FS.historialOrganizacion,
  partidasDilemas: FS.partidasDilemas,
};

export const ETIQUETA_COLECCION: Record<Coleccion, string> = {
  historialPanoramas: 'Historial de panoramas',
  historialOrganizacion: 'Historial de organización',
  partidasDilemas: 'Partidas de "Qué prefieres"',
};

export async function contar(parejaId: string, cual: Coleccion): Promise<number> {
  const snap = await getDocs(collection(obtenerFirestore(), RUTA_LIMPIABLE[cual](parejaId)));
  return snap.size;
}

/**
 * Borra una colección en lotes de 400 (el máximo de Firestore es 500).
 * Deja auditoría ANTES de tocar nada.
 */
export async function limpiarColeccion(
  parejaId: string, actor: Persona, cual: Coleccion,
): Promise<number> {
  const db = obtenerFirestore();
  await auditar(parejaId, actor, 'limpiar', `parejas/${parejaId}/${cual}`);

  let borrados = 0;
  for (;;) {
    const snap = await getDocs(query(collection(db, RUTA_LIMPIABLE[cual](parejaId)), limit(400)));
    if (snap.empty) break;
    const lote = writeBatch(db);
    for (const d of snap.docs) lote.delete(d.ref);
    await lote.commit();
    borrados += snap.size;
    if (snap.size < 400) break;
  }
  return borrados;
}

/**
 * Reinicia el marcador de organización a cero.
 * Las reglas solo admiten poner exactamente 0: no se puede "ajustar" a mano.
 */
export async function reiniciarMarcador(parejaId: string, actor: Persona): Promise<void> {
  const db = obtenerFirestore();
  await auditar(parejaId, actor, 'reiniciar-marcador', `parejas/${parejaId}/organizadores`);
  for (const p of ['a', 'b'] as const) {
    await updateDoc(doc(db, FS.organizador(parejaId, p)), { vecesOrganizado: 0 });
  }
}

// ── Configuración ──────────────────────────────────────────────────────────

export function observarConfig(
  parejaId: string, alCambiar: (ventana: number) => void,
): Unsubscribe {
  return onSnapshot(
    doc(obtenerFirestore(), FS.configPareja(parejaId)),
    (snap) => {
      const v = snap.data()?.ventanaAntiRepeticion;
      alCambiar(typeof v === 'number' ? v : 25);
    },
    () => alCambiar(25),
  );
}

export async function guardarVentana(parejaId: string, ventana: number): Promise<void> {
  if (!Number.isInteger(ventana) || ventana < 0 || ventana > 500) {
    throw new ErrorAdmin('La ventana debe ser un número entero entre 0 y 500.');
  }
  await setDoc(
    doc(obtenerFirestore(), FS.configPareja(parejaId)),
    { ventanaAntiRepeticion: ventana, actualizadoEn: serverTimestamp() },
    { merge: true },
  );
}

// ── Auditoría ──────────────────────────────────────────────────────────────

export interface EventoAuditoria {
  id: string;
  actor: Persona;
  accion: string;
  recurso: string;
  ocurridoEn: number | null;
}

export function observarAuditoria(
  parejaId: string, alCambiar: (eventos: EventoAuditoria[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(obtenerFirestore(), FS.auditoria(parejaId)), orderBy('ocurridoEn', 'desc'), limit(30)),
    (snap) => {
      alCambiar(snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          actor: x.actor === 'b' ? 'b' : 'a',
          accion: String(x.accion ?? ''),
          recurso: String(x.recurso ?? ''),
          ocurridoEn: x.ocurridoEn?.toMillis?.() ?? null,
        };
      }));
    },
    (e) => { console.warn('[admin] auditoria:', e.message); alCambiar([]); },
  );
}

/** Elimina un panorama del catálogo de forma lógica. */
export async function archivarTodoPanorama(parejaId: string, actor: Persona, id: string, nombre: string): Promise<void> {
  await auditar(parejaId, actor, 'archivar-panorama', nombre);
  await updateDoc(doc(obtenerFirestore(), FS.panorama(parejaId, id)), { activo: false });
}

/** Reexportado por comodidad para la página. */
export { deleteDoc };
