import { atom } from 'nanostores';
import { signInAnonymously, onAuthStateChanged, type User } from 'firebase/auth';
import { ref, get as leerRtdb, set as escribirRtdb, serverTimestamp } from 'firebase/database';
import { obtenerAuth, PAREJA_ID } from '../../infra/firebase/cliente';
import { obtenerRtdb } from '../../infra/firebase/rtdb';
import { RTDB, FS } from '@shared/rutas-datos';
import { parsearCodigo } from '@shared/schemas/codigo';
import type { Persona } from '@shared/enums';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  IDENTIDAD SIN LOGIN  (ADR-012)
 *
 *  Cómo funciona, de arriba abajo:
 *
 *   1. Al abrir la app, Firebase Anonymous Auth crea un usuario real con su uid
 *      y lo guarda en el IndexedDB del navegador. Sobrevive a cerrar la pestaña,
 *      apagar el equipo y reiniciar: NO hay que volver a identificarse nunca.
 *
 *   2. Ese uid identifica un DISPOSITIVO, no una persona. La primera vez se
 *      vincula a una persona ('a' o 'b') escribiendo nombre + código.
 *
 *   3. El código lo verifica el SERVIDOR contra /asientos, un nodo que ningún
 *      cliente puede leer. Sin el código correcto, la escritura se rechaza.
 *
 *   4. Desde entonces el dispositivo queda vinculado. El celular repite el
 *      proceso con el mismo código y queda vinculado a la misma persona: dos
 *      dispositivos, una identidad.
 *
 *  Anonymous Auth NO es "sin autenticación": da un request.auth.uid real, que
 *  es de lo que dependen todas las Security Rules. Sin él habría que abrir la
 *  base de datos a internet entero.
 *
 *  Se pierde el vínculo si se borran los datos del sitio o se usa una ventana
 *  de incógnito. En ese caso basta con volver a escribir el código.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface Vinculo {
  persona: Persona;
  nombre: string;
  /** Se conserva para poder reparar el espejo en Firestore si quedó a medias. */
  codigo: string;
}

export type EstadoIdentidad =
  | { fase: 'cargando' }
  | { fase: 'sin-vincular'; uid: string }
  | { fase: 'vinculado'; uid: string; persona: Persona; nombre: string };

export const $identidad = atom<EstadoIdentidad>({ fase: 'cargando' });

let arrancado = false;

/** Lee el vínculo de ESTE dispositivo. Las reglas solo dejan leer el propio. */
async function leerVinculo(uid: string): Promise<Vinculo | null> {
  const snap = await leerRtdb(ref(obtenerRtdb(), RTDB.dispositivo(PAREJA_ID, uid)));
  if (!snap.exists()) return null;
  const v = snap.val() as Partial<Vinculo>;
  if (v.persona !== 'a' && v.persona !== 'b') return null;
  return { persona: v.persona, nombre: String(v.nombre ?? ''), codigo: String(v.codigo ?? '') };
}

/**
 * El SDK de Firestore pesa ~400 KB. Se carga bajo demanda, nunca en el arranque:
 * ni la pantalla de identificarse ni la de inicio lo necesitan para pintar.
 */
async function firestoreBajoDemanda() {
  const [{ obtenerFirestore }, fs] = await Promise.all([
    import('../../infra/firebase/firestore'),
    import('firebase/firestore'),
  ]);
  return { db: obtenerFirestore(), ...fs };
}

/** Marca local de "el espejo ya está puesto", para no comprobarlo en cada carga. */
const CLAVE_ESPEJO = 'nuestro-espacio:espejo-firestore';

function espejoYaConfirmado(uid: string): boolean {
  try {
    return localStorage.getItem(CLAVE_ESPEJO) === uid;
  } catch {
    return false;   // modo incógnito o almacenamiento bloqueado
  }
}

function confirmarEspejo(uid: string): void {
  try {
    localStorage.setItem(CLAVE_ESPEJO, uid);
  } catch {
    /* sin persistencia: se comprobará otra vez. No es grave. */
  }
}

/**
 * Firestore y RTDB no pueden leerse entre sí, así que el vínculo debe existir
 * en AMBAS para que las reglas de cada una funcionen. Si la vinculación se
 * cortó a medias (se fue el wifi entre una escritura y otra), esto lo repara
 * solo, reutilizando el código que ya está guardado en RTDB.
 *
 * Se ejecuta UNA vez por dispositivo: después, una marca en localStorage evita
 * volver a descargar el SDK de Firestore en cada visita.
 */
async function asegurarEspejoFirestore(uid: string, v: Vinculo): Promise<void> {
  if (espejoYaConfirmado(uid)) return;

  const { db, doc, getDoc, setDoc, serverTimestamp: tsFirestore } = await firestoreBajoDemanda();
  const referencia = doc(db, FS.dispositivo(PAREJA_ID, uid));

  if (!(await getDoc(referencia)).exists()) {
    await setDoc(referencia, {
      persona: v.persona,
      nombre: v.nombre,
      codigo: v.codigo,
      vinculadoEn: tsFirestore(),
    });
  }

  confirmarEspejo(uid);
}

async function resolver(usuario: User): Promise<void> {
  const vinculo = await leerVinculo(usuario.uid);

  if (!vinculo) {
    $identidad.set({ fase: 'sin-vincular', uid: usuario.uid });
    return;
  }

  await asegurarEspejoFirestore(usuario.uid, vinculo).catch((e) => {
    console.warn('[identidad] no se pudo reparar el espejo en Firestore:', e?.message);
  });

  $identidad.set({
    fase: 'vinculado',
    uid: usuario.uid,
    persona: vinculo.persona,
    nombre: vinculo.nombre,
  });
}

/** Arranca la identidad. Idempotente: varias islas pueden llamarlo. */
export function iniciarIdentidad(): void {
  if (arrancado) return;
  arrancado = true;

  const auth = obtenerAuth();

  onAuthStateChanged(auth, (usuario) => {
    if (usuario) {
      void resolver(usuario);
    } else {
      // Sin sesión anónima todavía: se crea una. Solo ocurre la primera vez
      // en cada dispositivo (o si se borraron los datos del sitio).
      void signInAnonymously(auth).catch((e) => {
        console.error('[identidad] no se pudo crear la sesión anónima:', e);
        $identidad.set({ fase: 'sin-vincular', uid: '' });
      });
    }
  });
}

export class ErrorVinculacion extends Error {}

/**
 * Vincula ESTE dispositivo a una persona.
 *
 * Escribe primero en RTDB (donde vive el código) y después en Firestore. Si la
 * primera falla, el código era incorrecto y no se toca nada más.
 */
export async function vincularDispositivo(nombre: string, codigoEscrito: string): Promise<void> {
  const estado = $identidad.get();
  if (estado.fase === 'cargando' || !('uid' in estado) || !estado.uid) {
    throw new ErrorVinculacion('Todavía se está preparando la sesión. Espera un segundo.');
  }

  const limpio = nombre.trim();
  if (limpio.length < 1 || limpio.length > 40) {
    throw new ErrorVinculacion('El nombre debe tener entre 1 y 40 caracteres.');
  }
  if (/[<>]/.test(limpio)) {
    throw new ErrorVinculacion('El nombre no puede contener los caracteres < ni >.');
  }

  const codigo = parsearCodigo(codigoEscrito);
  if (!codigo) {
    throw new ErrorVinculacion('El código no tiene el formato correcto. Ejemplo: A-K3F9-2XQ7-M8T4');
  }

  const { uid } = estado;

  try {
    await escribirRtdb(ref(obtenerRtdb(), RTDB.dispositivo(PAREJA_ID, uid)), {
      persona: codigo.persona,
      nombre: limpio,
      codigo: codigo.canonico,
      vinculadoEn: serverTimestamp(),
    });
  } catch {
    // El servidor rechazó la escritura. La causa abrumadoramente probable es
    // que el código no coincide; no se distingue más para no dar pistas.
    throw new ErrorVinculacion('Código incorrecto. Revisa que lo hayas copiado completo.');
  }

  const { db, doc, setDoc, serverTimestamp: tsFirestore } = await firestoreBajoDemanda();
  await setDoc(doc(db, FS.dispositivo(PAREJA_ID, uid)), {
    persona: codigo.persona,
    nombre: limpio,
    codigo: codigo.canonico,
    vinculadoEn: tsFirestore(),
  });
  confirmarEspejo(uid);

  // Se publica el nombre visible para la otra persona.
  await escribirRtdb(ref(obtenerRtdb(), RTDB.persona(PAREJA_ID, codigo.persona)), {
    nombre: limpio,
    actualizadoEn: serverTimestamp(),
  }).catch(() => {});

  $identidad.set({ fase: 'vinculado', uid, persona: codigo.persona, nombre: limpio });
}

/** Nombre visible de una persona, en tiempo real. */
export async function leerNombre(persona: Persona): Promise<string | null> {
  const snap = await leerRtdb(ref(obtenerRtdb(), `${RTDB.persona(PAREJA_ID, persona)}/nombre`));
  return snap.exists() ? String(snap.val()) : null;
}
