import {
  doc, getDoc, setDoc, updateDoc, onSnapshot, deleteField, serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { obtenerFirestore } from '../../infra/firebase/firestore';
import { FS } from '@shared/rutas-datos';
import {
  entradaDe, estaDescartada, ENTRADA_VACIA,
  PASES_PARA_DESCARTAR, type EntradaProgreso,
} from '@shared/schemas/progreso.schema';
import type { Persona } from '@shared/enums';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  PROGRESO · qué cartas están hechas y cuáles se pasaron
 *
 *  Un documento por juego con un mapa `items`. La razón es la cuota y está
 *  explicada en rutas-datos.ts: con mil cartas, una colección de documentos
 *  sueltos costaría mil lecturas por apertura y el plan gratuito da cincuenta
 *  mil al día.
 *
 *  ESCRITURAS QUIRÚRGICAS. Nunca se envía el mapa completo. Se escribe con
 *  rutas de campo — `items.prof-042.h` — para que Firestore fusione en el
 *  servidor. Si los dos marcan cartas distintas en el mismo segundo, ambas
 *  sobreviven; mandando el objeto entero, el último en llegar borraría lo del
 *  otro. Es exactamente la clase de pérdida de datos silenciosa que hay que
 *  evitar en una app que usan dos personas a la vez.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type Juego = 'preguntas' | 'dilemas';

export interface Progreso {
  items: Record<string, EntradaProgreso>;
  hechas: number;
  descartadas: number;
}

const VACIO: Progreso = { items: {}, hechas: 0, descartadas: 0 };

const rutaDoc = (parejaId: string, juego: Juego) =>
  juego === 'preguntas' ? FS.progresoPreguntas(parejaId) : FS.progresoDilemas(parejaId);

function resumir(items: Record<string, unknown>): Progreso {
  const limpio: Record<string, EntradaProgreso> = {};
  let hechas = 0;
  let descartadas = 0;

  for (const id of Object.keys(items ?? {})) {
    const e = entradaDe(items, id);
    limpio[id] = e;
    if (e.h) hechas++;
    if (estaDescartada(e)) descartadas++;
  }
  return { items: limpio, hechas, descartadas };
}

/**
 * Escucha el progreso en tiempo real: lo que uno marca aparece en la otra
 * pantalla.
 *
 * El callback de error NO vacía el estado, y la razón es una carrera real que
 * se vio en producción: al cargar la página, el SDK puede emitir la primera
 * lectura antes de que el token de autenticación esté disponible. El servidor
 * la evalúa sin sesión, `esMiembro` da falso y llega un permission-denied que
 * no significa nada — un instante después, con el token puesto, la misma
 * suscripción entrega los datos correctos.
 *
 * Vaciando el estado ahí, el contador parpadeaba a cero y volvía. Peor: si el
 * usuario pulsaba "pasar" en ese instante, el contador de pases se calculaba
 * sobre un progreso vacío y volvía a empezar desde uno.
 */
export function observarProgreso(
  parejaId: string,
  juego: Juego,
  alCambiar: (p: Progreso) => void,
): Unsubscribe {
  return onSnapshot(
    doc(obtenerFirestore(), rutaDoc(parejaId, juego)),
    (snap) => alCambiar(snap.exists() ? resumir(snap.data()?.items ?? {}) : VACIO),
    (e) => {
      // Se informa y se conserva lo último bueno: Firestore reintenta solo.
      console.info('[progreso] lectura reintentándose:', e.message);
    },
  );
}

export async function leerProgreso(parejaId: string, juego: Juego): Promise<Progreso> {
  try {
    const snap = await getDoc(doc(obtenerFirestore(), rutaDoc(parejaId, juego)));
    return snap.exists() ? resumir(snap.data()?.items ?? {}) : VACIO;
  } catch {
    return VACIO;
  }
}

/**
 * Escribe campos sueltos dentro de `items`, creando el documento si hace falta.
 *
 * updateDoc con rutas de campo es la operación que fusiona en el servidor, pero
 * falla si el documento no existe todavía. El primer marcado de la vida del
 * espacio cae en ese caso: se crea con setDoc y merge, y a partir de ahí todas
 * las escrituras son quirúrgicas.
 */
async function escribirCampos(
  parejaId: string,
  juego: Juego,
  campos: Record<string, unknown>,
): Promise<void> {
  const referencia = doc(obtenerFirestore(), rutaDoc(parejaId, juego));
  try {
    await updateDoc(referencia, campos);
    return;
  } catch {
    // Sigue: casi siempre es que el documento aún no existe.
  }

  // Segundo intento creando el documento. Si esto también falla, el error se
  // propaga con un mensaje que se entiende — antes quedaba como una promesa
  // sin capturar y la consola solo mostraba "permission-denied" sin contexto.
  try {
    await setDoc(referencia, { items: {} }, { merge: true });
    await updateDoc(referencia, campos);
  } catch (e) {
    throw new Error(`No se pudo guardar el progreso de ${juego}: ${(e as Error).message}`);
  }
}

/**
 * Marca una carta como hecha.
 *
 * No la retira de la rotación: puede volver a salir, y entonces la pantalla
 * muestra el sello con la fecha. Es lo pedido, y con un banco de mil es lo
 * correcto: si las hechas desaparecieran, no habría forma de reencontrar una
 * conversación que valió la pena.
 */
export async function marcarHecha(
  parejaId: string,
  juego: Juego,
  id: string,
  persona: Persona,
): Promise<void> {
  await escribirCampos(parejaId, juego, {
    [`items.${id}.h`]: true,
    [`items.${id}.q`]: persona,
    [`items.${id}.t`]: Date.now(),
  });
}

export async function desmarcarHecha(parejaId: string, juego: Juego, id: string): Promise<void> {
  await escribirCampos(parejaId, juego, {
    [`items.${id}.h`]: false,
    [`items.${id}.q`]: null,
  });
}

/**
 * Suma un pase. A los tres, la carta sale de la rotación para siempre.
 *
 * El contador se calcula en el cliente en vez de usar increment() porque hace
 * falta saber si este pase fue el que la descartó, para poder avisarlo en
 * pantalla. Con dos personas, el riesgo de que dos pases se pisen es teórico —
 * y el peor caso es que una carta necesite un pase más.
 */
export async function pasar(
  parejaId: string,
  juego: Juego,
  id: string,
  progresoActual: Progreso,
): Promise<{ pases: number; descartada: boolean }> {
  const previa = progresoActual.items[id] ?? ENTRADA_VACIA;
  const pases = Math.min(previa.p + 1, 99);

  await escribirCampos(parejaId, juego, {
    [`items.${id}.p`]: pases,
    [`items.${id}.t`]: Date.now(),
  });

  return { pases, descartada: pases >= PASES_PARA_DESCARTAR };
}

/** Devuelve una carta descartada a la rotación poniendo sus pases a cero. */
export async function reactivar(parejaId: string, juego: Juego, id: string): Promise<void> {
  await escribirCampos(parejaId, juego, { [`items.${id}.p`]: 0 });
}

/**
 * Borra la entrada de una carta del progreso.
 *
 * Se usa al retirar una carta del banco desde el panel: sin esto, el contador
 * de "hechas" seguiría contando preguntas que ya no existen y la cifra dejaría
 * de cuadrar con lo que se ve en la lista.
 */
export async function olvidar(parejaId: string, juego: Juego, ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  // Firestore admite como mucho 500 operaciones por escritura; con rutas de
  // campo el límite práctico es el tamaño del payload, así que se trocea.
  for (let i = 0; i < ids.length; i += 200) {
    const campos: Record<string, unknown> = {};
    for (const id of ids.slice(i, i + 200)) campos[`items.${id}`] = deleteField();
    await escribirCampos(parejaId, juego, campos);
  }
}

/**
 * Reinicia el progreso entero de un juego.
 *
 * Es destructivo y no se puede deshacer: por eso el panel lo pide dos veces y
 * deja constancia en la auditoría. Aquí solo se ejecuta.
 */
export async function reiniciarProgreso(parejaId: string, juego: Juego): Promise<void> {
  await setDoc(doc(obtenerFirestore(), rutaDoc(parejaId, juego)), { items: {} });
}

export { PASES_PARA_DESCARTAR, estaDescartada };

/** Fecha legible de cuándo se marcó una carta, para el sello de la tarjeta. */
export function selloDe(e: EntradaProgreso | undefined): string | null {
  if (!e?.h || !e.t) return null;
  return new Date(e.t).toLocaleDateString('es-CL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Santiago',
  });
}

export const marcaDeTiempo = serverTimestamp;
