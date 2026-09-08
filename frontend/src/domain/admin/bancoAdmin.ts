import {
  collection, doc, addDoc, updateDoc, setDoc, writeBatch, increment, serverTimestamp,
} from 'firebase/firestore';
import { obtenerFirestore } from '../../infra/firebase/firestore';
import { FS } from '@shared/rutas-datos';
import { textoSeguro } from '@shared/schemas/perfil.schema';
import { cargarPreguntas, cargarDilemas, invalidarCache } from '../banco/cacheBanco';
import { olvidar, type Juego } from '../progreso/progresoService';
import { estaDescartada, type EntradaProgreso } from '@shared/schemas/progreso.schema';
import type { CategoriaPregunta, CategoriaDilema, Nivel, Persona } from '@shared/enums';
import { ErrorAdmin, auditar } from './adminService';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  BANCO DESDE EL PANEL
 *
 *  Vive aparte de adminService por una razón de escala: el panel original
 *  escuchaba la colección entera con onSnapshot. Con veinte preguntas era
 *  gratis; con dos mil son dos mil lecturas cada vez que se abre el panel, más
 *  otras dos mil cada vez que alguien cambia una coma. El plan Spark da
 *  cincuenta mil al día — abrir el panel cinco veces lo agotaba.
 *
 *  Ahora se lee de la misma caché que usa el juego y se filtra en memoria. A
 *  cambio hay que INVALIDARLA a mano en cada escritura, que es justo lo que
 *  hacen las funciones de abajo. Olvidar ese paso significa que el otro
 *  teléfono no vería la pregunta nueva hasta que su caché caducara sola.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const TextoPregunta = textoSeguro(8, 300);
const TextoOpcion = textoSeguro(2, 120);

function exigir<T>(r: { success: boolean; data?: T; error?: { issues: { message: string }[] } }): T {
  if (!r.success) throw new ErrorAdmin(r.error?.issues[0]?.message ?? 'Valor no válido');
  return r.data as T;
}

export interface FilaBanco {
  id: string;
  /** Texto de la pregunta, o "A · B" en un dilema. Es lo que se busca y se lista. */
  titulo: string;
  categoria: string;
  nivel: Nivel;
  hecha: boolean;
  descartada: boolean;
  pases: number;
}

/**
 * Sube la versión del banco para que las demás pantallas y dispositivos sepan
 * que su copia caducó, y tira la copia local para que el cambio se vea aquí
 * mismo sin recargar.
 */
async function marcarBancoTocado(): Promise<void> {
  invalidarCache();
  await setDoc(
    doc(obtenerFirestore(), FS.configApp),
    { versionBanco: increment(1), actualizadoEn: serverTimestamp() },
    { merge: true },
  ).catch((e) => console.warn('[admin] no se pudo subir versionBanco:', e?.message));
}

/** Une banco y progreso en una sola lista, que es lo que el panel necesita pintar. */
export async function cargarFilas(
  juego: Juego,
  progreso: Record<string, EntradaProgreso>,
): Promise<FilaBanco[]> {
  const cartas =
    juego === 'preguntas'
      ? (await cargarPreguntas()).map((p) => ({
          id: p.id, titulo: p.texto, categoria: p.categoria, nivel: p.nivel,
        }))
      : (await cargarDilemas()).map((d) => ({
          id: d.id, titulo: `${d.opcionA} · ${d.opcionB}`, categoria: d.categoria, nivel: d.nivel,
        }));

  return cartas.map((c) => {
    const e = progreso[c.id];
    return {
      ...c,
      hecha: Boolean(e?.h),
      descartada: Boolean(e && estaDescartada(e)),
      pases: e?.p ?? 0,
    };
  });
}

/** Filtro en memoria: sin tildes ni mayúsculas, para que buscar sea tolerante. */
export function filtrar(filas: FilaBanco[], texto: string, categoria: string): FilaBanco[] {
  const aguja = texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  return filas.filter((f) => {
    if (categoria !== 'todas' && f.categoria !== categoria) return false;
    if (!aguja) return true;
    const pajar = f.titulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return pajar.includes(aguja);
  });
}

// ── Alta ────────────────────────────────────────────────────────────────────

export async function crearPregunta(
  actor: Persona, texto: string, categoria: CategoriaPregunta, nivel: Nivel = 1,
): Promise<void> {
  const limpio = exigir(TextoPregunta.safeParse(texto));
  await addDoc(collection(obtenerFirestore(), FS.preguntas), {
    texto: limpio, categoria, nivel, activa: true,
    creadaEn: serverTimestamp(), creadaPor: actor,
  });
  await marcarBancoTocado();
}

export async function crearDilema(
  actor: Persona, opcionA: string, opcionB: string,
  categoria: CategoriaDilema, nivel: Nivel = 1,
): Promise<void> {
  const a = exigir(TextoOpcion.safeParse(opcionA));
  const b = exigir(TextoOpcion.safeParse(opcionB));
  if (a === b) throw new ErrorAdmin('Las dos opciones no pueden ser iguales.');

  await addDoc(collection(obtenerFirestore(), FS.dilemas), {
    opcionA: a, opcionB: b, categoria, nivel, activo: true,
    creadoEn: serverTimestamp(), creadoPor: actor,
  });
  await marcarBancoTocado();
}

// ── Baja ────────────────────────────────────────────────────────────────────

/**
 * Retira cartas del banco: no vuelven a salir nunca más.
 *
 * Es lo que el panel llama "eliminar", y hace exactamente eso de cara al juego.
 * Por dentro marca `activa: false` en vez de borrar el documento, porque las
 * reglas prohíben el delete en los bancos (ADR-010) y porque conviene: el
 * historial de partidas y los contadores apuntan a estos ids, y borrarlos de
 * verdad dejaría registros huérfanos imposibles de mostrar.
 *
 * La entrada del progreso SÍ se borra, para que el contador de hechas no siga
 * contando cartas que ya nadie puede ver.
 */
export async function retirarDelBanco(
  parejaId: string, actor: Persona, juego: Juego, ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;

  await auditar(parejaId, actor, 'retirar_del_banco', `${juego}:${ids.length}`);

  const db = obtenerFirestore();
  const ruta = juego === 'preguntas' ? FS.preguntas : FS.dilemas;
  const campo = juego === 'preguntas' ? 'activa' : 'activo';

  // Lotes de 400: el límite duro de Firestore son 500 operaciones por lote.
  for (let i = 0; i < ids.length; i += 400) {
    const lote = writeBatch(db);
    for (const id of ids.slice(i, i + 400)) {
      lote.update(doc(db, `${ruta}/${id}`), { [campo]: false });
    }
    await lote.commit();
  }

  await olvidar(parejaId, juego, ids);
  await marcarBancoTocado();
  return ids.length;
}

/** Devuelve a la rotación una carta que se había pasado tres veces. */
export async function editarCarta(
  juego: Juego, id: string, cambios: Record<string, unknown>,
): Promise<void> {
  const ruta = juego === 'preguntas' ? FS.preguntas : FS.dilemas;
  await updateDoc(doc(obtenerFirestore(), `${ruta}/${id}`), cambios);
  await marcarBancoTocado();
}

// ── Métricas ────────────────────────────────────────────────────────────────

export interface Metricas {
  total: number;
  hechas: number;
  descartadas: number;
  pendientes: number;
  porcentaje: number;
}

export function calcularMetricas(filas: FilaBanco[]): Metricas {
  const hechas = filas.filter((f) => f.hecha && !f.descartada).length;
  const descartadas = filas.filter((f) => f.descartada).length;
  const total = filas.length;
  return {
    total,
    hechas,
    descartadas,
    pendientes: total - hechas - descartadas,
    porcentaje: total === 0 ? 0 : Math.round((hechas / total) * 100),
  };
}
