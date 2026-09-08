import { doc, setDoc, onSnapshot, serverTimestamp, type Unsubscribe } from 'firebase/firestore';
import { obtenerFirestore } from '../../infra/firebase/firestore';
import { FS } from '@shared/rutas-datos';
import {
  PerfilSchema, PerfilConjuntoSchema, textoSeguro, CAMPOS_LISTA,
  type Perfil, type Hito, type CampoLista,
} from '@shared/schemas/perfil.schema';
import type { Persona } from '@shared/enums';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  PERFILES
 *
 *  Individual: cada quien escribe SOLO el suyo (las reglas lo imponen), pero
 *  los dos los leen. Es lo que permite que la app sepa que a uno le dan alergia
 *  los mariscos sin que el otro pueda cambiárselo.
 *
 *  Conjunto: lo editan los dos. Guarda las fechas memorables y los hitos.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type { Perfil, Hito };

export interface PerfilConjunto {
  fechaInicioSalidas: string | null;
  fechaNoviazgo: string | null;
  hitos: Hito[];
}

/**
 * Perfil en blanco con TODAS las listas presentes.
 *
 * Se construye recorriendo CAMPOS_LISTA en vez de escribir los veintitantos
 * campos a mano: así, agregar una sección nueva al esquema no obliga a acordarse
 * de tocar este objeto —y olvidarlo daría un `undefined.map` en la pantalla.
 */
export const PERFIL_VACIO: Perfil = {
  nombre: '',
  ...(Object.fromEntries(CAMPOS_LISTA.map((c) => [c, [] as string[]])) as unknown as Record<CampoLista, string[]>),
};

export const CONJUNTO_VACIO: PerfilConjunto = {
  fechaInicioSalidas: null, fechaNoviazgo: null, hitos: [],
};

export class ErrorPerfil extends Error {}

/**
 * Las secciones y sus campos viven en `shared/schemas/perfil.schema.ts`, junto
 * al esquema que los valida. Tenerlos en dos sitios garantizaba que un día
 * alguien agregara un campo al esquema y la pantalla no se enterase.
 */
export { SECCIONES_PERFIL, CAMPOS_LISTA } from '@shared/schemas/perfil.schema';
export type { CampoLista };

export function observarPerfil(
  parejaId: string,
  persona: Persona,
  alCambiar: (perfil: Perfil) => void,
): Unsubscribe {
  return onSnapshot(
    doc(obtenerFirestore(), FS.perfil(parejaId, persona)),
    (snap) => {
      const x = snap.data() ?? {};
      const listas = Object.fromEntries(
        CAMPOS_LISTA.map((c) => [c, Array.isArray(x[c]) ? (x[c] as unknown[]).map(String) : []]),
      ) as unknown as Record<CampoLista, string[]>;

      alCambiar({
        nombre: String(x.nombre ?? ''),
        fechaNacimiento: typeof x.fechaNacimiento === 'string' ? x.fechaNacimiento : undefined,
        ...listas,
      });
    },
    (e) => {
      // No se vacía el perfil ante un rechazo: durante el arranque puede llegar
      // uno antes de que el token esté listo, y borrar la pantalla haría creer
      // que los datos se perdieron.
      console.info('[perfiles] lectura reintentándose:', e.message);
    },
  );
}

/**
 * Guarda el perfil propio.
 *
 * Se valida con el MISMO schema Zod que replican las Security Rules: si algo no
 * pasa aquí, tampoco pasaría en el servidor — pero aquí el mensaje de error es
 * legible en vez de un permission_denied opaco.
 */
export async function guardarPerfil(
  parejaId: string,
  persona: Persona,
  datos: Perfil,
): Promise<void> {
  const r = PerfilSchema.safeParse(datos);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new ErrorPerfil(`${i?.path.join('.') ?? 'campo'}: ${i?.message ?? 'no válido'}`);
  }

  const limpio = r.data;
  await setDoc(
    doc(obtenerFirestore(), FS.perfil(parejaId, persona)),
    {
      nombre: limpio.nombre,
      // Se envía null cuando está vacía, en vez de omitir el campo. Con
      // merge:true, omitirlo conserva el valor anterior: una fecha de
      // nacimiento mal puesta sería imposible de borrar.
      fechaNacimiento: limpio.fechaNacimiento ?? null,
      ...Object.fromEntries(CAMPOS_LISTA.map((c) => [c, limpio[c]])),
      actualizadoEn: serverTimestamp(),
    },
    { merge: true },
  );
}

export function observarPerfilConjunto(
  parejaId: string,
  alCambiar: (conjunto: PerfilConjunto) => void,
): Unsubscribe {
  return onSnapshot(
    doc(obtenerFirestore(), FS.perfilConjunto(parejaId)),
    (snap) => {
      const x = snap.data() ?? {};
      alCambiar({
        fechaInicioSalidas: typeof x.fechaInicioSalidas === 'string' ? x.fechaInicioSalidas : null,
        fechaNoviazgo: typeof x.fechaNoviazgo === 'string' ? x.fechaNoviazgo : null,
        hitos: Array.isArray(x.hitos) ? (x.hitos as Hito[]) : [],
      });
    },
    () => alCambiar({ ...CONJUNTO_VACIO }),
  );
}

export async function guardarPerfilConjunto(
  parejaId: string,
  persona: Persona,
  datos: PerfilConjunto,
  interesesComunes: string[],
): Promise<void> {
  const r = PerfilConjuntoSchema.safeParse(datos);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new ErrorPerfil(`${i?.path.join('.') ?? 'campo'}: ${i?.message ?? 'no válido'}`);
  }

  await setDoc(
    doc(obtenerFirestore(), FS.perfilConjunto(parejaId)),
    {
      fechaInicioSalidas: r.data.fechaInicioSalidas,
      fechaNoviazgo: r.data.fechaNoviazgo,
      hitos: r.data.hitos,
      interesesComunes,
      actualizadoPor: persona,
      actualizadoEn: serverTimestamp(),
    },
    { merge: true },
  );
}

export function validarEntradaLista(valor: string): string {
  const r = textoSeguro(1, 60).safeParse(valor);
  if (!r.success) throw new ErrorPerfil(r.error.issues[0]?.message ?? 'Texto no válido');
  return r.data;
}

/**
 * Intereses en común: intersección de gustos y hobbies.
 *
 * Se compara normalizado (sin tildes ni mayúsculas) para que "Cine" y "cine"
 * cuenten como lo mismo, pero se muestra el texto tal como lo escribió cada uno.
 */
export function interesesComunes(a: Perfil, b: Perfil): string[] {
  const norm = (v: string) =>
    v.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  const deB = new Map<string, string>();
  for (const v of [...b.gustos, ...b.hobbies]) deB.set(norm(v), v);

  const vistos = new Set<string>();
  const comunes: string[] = [];
  for (const v of [...a.gustos, ...a.hobbies]) {
    const k = norm(v);
    if (deB.has(k) && !vistos.has(k)) {
      vistos.add(k);
      comunes.push(v);
    }
  }
  return comunes;
}
