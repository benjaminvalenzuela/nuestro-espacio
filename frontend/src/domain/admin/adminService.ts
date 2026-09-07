import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, onSnapshot, setDoc,
  query, orderBy, limit, serverTimestamp, writeBatch, type Unsubscribe,
} from 'firebase/firestore';
import { obtenerFirestore } from '../../infra/firebase/firestore';
import { FS } from '@shared/rutas-datos';
import { textoSeguro } from '@shared/schemas/perfil.schema';
import { CATEGORIAS_PREGUNTA, CATEGORIAS_DILEMA, type CategoriaPregunta, type CategoriaDilema, type Persona } from '@shared/enums';

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

const TextoPregunta = textoSeguro(8, 300);
const TextoOpcion = textoSeguro(2, 120);

function exigir<T>(r: { success: boolean; data?: T; error?: { issues: { message: string }[] } }): T {
  if (!r.success) throw new ErrorAdmin(r.error?.issues[0]?.message ?? 'Valor no válido');
  return r.data as T;
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

// ── Preguntas ──────────────────────────────────────────────────────────────

export function observarPreguntasAdmin(alCambiar: (items: ItemPregunta[]) => void): Unsubscribe {
  return onSnapshot(
    collection(obtenerFirestore(), FS.preguntas),
    (snap) => {
      alCambiar(
        snap.docs
          .map((d) => {
            const x = d.data();
            return {
              id: d.id,
              texto: String(x.texto ?? ''),
              categoria: (CATEGORIAS_PREGUNTA as readonly string[]).includes(x.categoria)
                ? (x.categoria as CategoriaPregunta) : 'profundas',
              activa: x.activa !== false,
            };
          })
          .sort((a, b) => a.categoria.localeCompare(b.categoria) || a.texto.localeCompare(b.texto)),
      );
    },
    (e) => { console.warn('[admin] preguntas:', e.message); alCambiar([]); },
  );
}

export async function crearPregunta(
  actor: Persona, texto: string, categoria: CategoriaPregunta,
): Promise<void> {
  const limpio = exigir(TextoPregunta.safeParse(texto));
  await addDoc(collection(obtenerFirestore(), FS.preguntas), {
    texto: limpio, categoria, activa: true,
    creadaEn: serverTimestamp(), creadaPor: actor,
  });
}

export async function editarPregunta(
  id: string, cambios: Partial<Pick<ItemPregunta, 'texto' | 'categoria' | 'activa'>>,
): Promise<void> {
  const datos: Record<string, unknown> = {};
  if (cambios.texto !== undefined) datos.texto = exigir(TextoPregunta.safeParse(cambios.texto));
  if (cambios.categoria !== undefined) datos.categoria = cambios.categoria;
  if (cambios.activa !== undefined) datos.activa = cambios.activa;
  await updateDoc(doc(obtenerFirestore(), `${FS.preguntas}/${id}`), datos);
}

// ── Dilemas ────────────────────────────────────────────────────────────────

export function observarDilemasAdmin(alCambiar: (items: ItemDilema[]) => void): Unsubscribe {
  return onSnapshot(
    collection(obtenerFirestore(), FS.dilemas),
    (snap) => {
      alCambiar(
        snap.docs
          .map((d) => {
            const x = d.data();
            return {
              id: d.id,
              opcionA: String(x.opcionA ?? ''),
              opcionB: String(x.opcionB ?? ''),
              categoria: (CATEGORIAS_DILEMA as readonly string[]).includes(x.categoria)
                ? (x.categoria as CategoriaDilema) : 'general',
              activo: x.activo !== false,
            };
          })
          .sort((a, b) => a.categoria.localeCompare(b.categoria) || a.opcionA.localeCompare(b.opcionA)),
      );
    },
    (e) => { console.warn('[admin] dilemas:', e.message); alCambiar([]); },
  );
}

export async function crearDilema(
  actor: Persona, opcionA: string, opcionB: string, categoria: CategoriaDilema,
): Promise<void> {
  const a = exigir(TextoOpcion.safeParse(opcionA));
  const b = exigir(TextoOpcion.safeParse(opcionB));
  if (a === b) throw new ErrorAdmin('Las dos opciones no pueden ser iguales.');

  await addDoc(collection(obtenerFirestore(), FS.dilemas), {
    opcionA: a, opcionB: b, categoria, activo: true,
    creadoEn: serverTimestamp(), creadoPor: actor,
  });
}

export async function editarDilema(
  id: string, cambios: Partial<Pick<ItemDilema, 'opcionA' | 'opcionB' | 'categoria' | 'activo'>>,
): Promise<void> {
  const datos: Record<string, unknown> = {};
  if (cambios.opcionA !== undefined) datos.opcionA = exigir(TextoOpcion.safeParse(cambios.opcionA));
  if (cambios.opcionB !== undefined) datos.opcionB = exigir(TextoOpcion.safeParse(cambios.opcionB));
  if (cambios.categoria !== undefined) datos.categoria = cambios.categoria;
  if (cambios.activo !== undefined) datos.activo = cambios.activo;
  await updateDoc(doc(obtenerFirestore(), `${FS.dilemas}/${id}`), datos);
}

// ── Limpiezas ──────────────────────────────────────────────────────────────

export type Coleccion = 'historialPanoramas' | 'historialOrganizacion' | 'preguntasServidas' | 'partidasDilemas';

const RUTA: Record<Coleccion, (p: string) => string> = {
  historialPanoramas: FS.historialPanoramas,
  historialOrganizacion: FS.historialOrganizacion,
  preguntasServidas: FS.preguntasServidas,
  partidasDilemas: FS.partidasDilemas,
};

export const ETIQUETA_COLECCION: Record<Coleccion, string> = {
  historialPanoramas: 'Historial de panoramas',
  historialOrganizacion: 'Historial de organización',
  preguntasServidas: 'Preguntas ya vistas',
  partidasDilemas: 'Partidas de "Qué prefieres"',
};

export async function contar(parejaId: string, cual: Coleccion): Promise<number> {
  const snap = await getDocs(collection(obtenerFirestore(), RUTA[cual](parejaId)));
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
    const snap = await getDocs(query(collection(db, RUTA[cual](parejaId)), limit(400)));
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
