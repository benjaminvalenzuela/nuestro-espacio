import { doc, setDoc, onSnapshot, serverTimestamp, type Unsubscribe } from 'firebase/firestore';
import { obtenerFirestore } from '../../infra/firebase/firestore';
import { FS } from '@shared/rutas-datos';
import { PerfilSchema, PerfilConjuntoSchema, textoSeguro, type Perfil, type Hito } from '@shared/schemas/perfil.schema';
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

export const PERFIL_VACIO: Perfil = {
  nombre: '',
  gustos: [], hobbies: [], disgustos: [], alimentosPreferidos: [], alergias: [],
};

export const CONJUNTO_VACIO: PerfilConjunto = {
  fechaInicioSalidas: null, fechaNoviazgo: null, hitos: [],
};

export class ErrorPerfil extends Error {}

/** Campos de lista que la UI edita como "chips". */
export const LISTAS = [
  { clave: 'gustos', etiqueta: 'Gustos', ayuda: 'Lo que te encanta' },
  { clave: 'hobbies', etiqueta: 'Hobbies', ayuda: 'A qué dedicas tu tiempo' },
  { clave: 'disgustos', etiqueta: 'Disgustos', ayuda: 'Lo que no soportas' },
  { clave: 'alimentosPreferidos', etiqueta: 'Comidas favoritas', ayuda: '' },
  { clave: 'alergias', etiqueta: 'Alergias', ayuda: 'Importante: lo ve tu pareja' },
] as const;

export type ClaveLista = (typeof LISTAS)[number]['clave'];

export function observarPerfil(
  parejaId: string,
  persona: Persona,
  alCambiar: (perfil: Perfil) => void,
): Unsubscribe {
  return onSnapshot(
    doc(obtenerFirestore(), FS.perfil(parejaId, persona)),
    (snap) => {
      const x = snap.data() ?? {};
      alCambiar({
        nombre: String(x.nombre ?? ''),
        fechaNacimiento: typeof x.fechaNacimiento === 'string' ? x.fechaNacimiento : undefined,
        gustos: Array.isArray(x.gustos) ? x.gustos.map(String) : [],
        hobbies: Array.isArray(x.hobbies) ? x.hobbies.map(String) : [],
        disgustos: Array.isArray(x.disgustos) ? x.disgustos.map(String) : [],
        alimentosPreferidos: Array.isArray(x.alimentosPreferidos) ? x.alimentosPreferidos.map(String) : [],
        alergias: Array.isArray(x.alergias) ? x.alergias.map(String) : [],
      });
    },
    (e) => {
      console.warn('[perfiles] lectura rechazada:', e.message);
      alCambiar({ ...PERFIL_VACIO });
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
      ...(limpio.fechaNacimiento ? { fechaNacimiento: limpio.fechaNacimiento } : {}),
      gustos: limpio.gustos,
      hobbies: limpio.hobbies,
      disgustos: limpio.disgustos,
      alimentosPreferidos: limpio.alimentosPreferidos,
      alergias: limpio.alergias,
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
