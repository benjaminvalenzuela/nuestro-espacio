import {
  doc, getDoc, setDoc, updateDoc, deleteField, onSnapshot, type Unsubscribe,
} from 'firebase/firestore';
import { obtenerFirestore } from '../../infra/firebase/firestore';
import { FS } from '@shared/rutas-datos';
import { IDS_SINTOMAS, REGLA_POR_DEFECTO, iniciosDesdeDias } from '@shared/ciclo';
import type { Persona } from '@shared/enums';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  CICLO · lectura y escritura
 *
 *  Un documento por mes con un mapa de días, más un `resumen` con todos los
 *  días marcados como menstruación. El resumen parece redundante y no lo es:
 *  las fases se calculan desde el último inicio de regla, que casi siempre cae
 *  en el mes ANTERIOR al que se está mirando. Sin él, abrir septiembre
 *  obligaría a leer agosto, y julio si agosto estuviera vacío.
 *
 *  Las escrituras son quirúrgicas —`dias.2026-09-03.m`— por la misma razón que
 *  en el progreso: los dos pueden anotar el mismo día desde teléfonos
 *  distintos y mandar el mapa entero haría que el último borrara lo del otro.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface RegistroDia {
  /** Menstruación ese día. */
  m: boolean;
  /** Síntomas: ids de la lista predefinida. */
  s: string[];
  /** Relaciones: una entrada por vez, `p` = con preservativo. */
  r: { p: boolean }[];
  /** Nota libre, corta. */
  n?: string;
}

export const DIA_VACIO: RegistroDia = { m: false, s: [], r: [] };

export interface ConfigCiclo {
  titular: Persona;
  duracionRegla: number;
}

export const CONFIG_POR_DEFECTO: ConfigCiclo = {
  titular: 'b',
  duracionRegla: REGLA_POR_DEFECTO,
};

export class ErrorCiclo extends Error {}

const mesDe = (fecha: string) => fecha.slice(0, 7);

/** Descarta lo que no reconocemos: un documento viejo no puede romper la pantalla. */
function normalizar(crudo: unknown): RegistroDia {
  const x = (crudo ?? {}) as Record<string, unknown>;
  const sintomas = Array.isArray(x.s)
    ? x.s.map(String).filter((s) => IDS_SINTOMAS.includes(s))
    : [];
  const relaciones = Array.isArray(x.r)
    ? x.r.slice(0, 20).map((r) => ({ p: Boolean((r as { p?: unknown })?.p) }))
    : [];
  const nota = typeof x.n === 'string' ? x.n.slice(0, 200) : undefined;

  return { m: x.m === true, s: sintomas, r: relaciones, ...(nota ? { n: nota } : {}) };
}

export function observarMes(
  parejaId: string,
  mes: string,
  alCambiar: (dias: Record<string, RegistroDia>) => void,
): Unsubscribe {
  return onSnapshot(
    doc(obtenerFirestore(), FS.cicloMes(parejaId, mes)),
    (snap) => {
      const crudo = (snap.data()?.dias ?? {}) as Record<string, unknown>;
      const salida: Record<string, RegistroDia> = {};
      for (const [fecha, v] of Object.entries(crudo)) salida[fecha] = normalizar(v);
      alCambiar(salida);
    },
    (e) => {
      // Igual que en el progreso: no se vacía la pantalla ante un rechazo del
      // arranque, porque Firestore reintenta y los datos llegan un instante
      // después. Borrarlos aquí haría creer que el mes se perdió.
      console.info('[ciclo] lectura reintentándose:', e.message);
    },
  );
}

/**
 * Todos los días marcados como menstruación, de cualquier mes.
 *
 * De aquí salen los inicios de ciclo, y de los inicios salen las fases. Es la
 * única lectura que necesita el calendario para predecir.
 */
export function observarResumen(
  parejaId: string,
  alCambiar: (menstruaciones: string[]) => void,
): Unsubscribe {
  return onSnapshot(
    doc(obtenerFirestore(), FS.cicloResumen(parejaId)),
    (snap) => {
      const v = snap.data()?.menstruaciones;
      alCambiar(Array.isArray(v) ? v.map(String).sort() : []);
    },
    (e) => console.info('[ciclo] resumen reintentándose:', e.message),
  );
}

export function observarConfig(
  parejaId: string,
  alCambiar: (c: ConfigCiclo) => void,
): Unsubscribe {
  return onSnapshot(
    doc(obtenerFirestore(), FS.cicloConfig(parejaId)),
    (snap) => {
      const x = snap.data() ?? {};
      alCambiar({
        titular: x.titular === 'a' ? 'a' : 'b',
        duracionRegla:
          typeof x.duracionRegla === 'number' && x.duracionRegla >= 1 && x.duracionRegla <= 15
            ? x.duracionRegla
            : REGLA_POR_DEFECTO,
      });
    },
    () => alCambiar({ ...CONFIG_POR_DEFECTO }),
  );
}

export async function guardarConfig(parejaId: string, c: ConfigCiclo): Promise<void> {
  await setDoc(doc(obtenerFirestore(), FS.cicloConfig(parejaId)), {
    titular: c.titular,
    duracionRegla: Math.min(15, Math.max(1, Math.round(c.duracionRegla))),
  });
}

/** Escritura quirúrgica sobre el mes, creando el documento la primera vez. */
async function escribirDia(
  parejaId: string,
  fecha: string,
  campos: Record<string, unknown>,
): Promise<void> {
  const referencia = doc(obtenerFirestore(), FS.cicloMes(parejaId, mesDe(fecha)));
  try {
    await updateDoc(referencia, campos);
    return;
  } catch {
    // El mes aún no existe.
  }
  try {
    await setDoc(referencia, { dias: {} }, { merge: true });
    await updateDoc(referencia, campos);
  } catch (e) {
    throw new ErrorCiclo(`No se pudo guardar el día ${fecha}: ${(e as Error).message}`);
  }
}

/**
 * Mantiene el resumen alineado con lo que hay en los meses.
 *
 * Se pasa la lista completa en vez de añadir o quitar una fecha suelta porque
 * el resumen es un derivado: reconstruirlo entero desde la verdad evita que se
 * desincronice si una escritura falla a medias.
 */
async function guardarResumen(parejaId: string, menstruaciones: string[]): Promise<void> {
  await setDoc(doc(obtenerFirestore(), FS.cicloResumen(parejaId)), {
    menstruaciones: [...new Set(menstruaciones)].sort().slice(-2000),
  });
}

export async function marcarMenstruacion(
  parejaId: string,
  fecha: string,
  activa: boolean,
  resumenActual: string[],
): Promise<string[]> {
  await escribirDia(parejaId, fecha, { [`dias.${fecha}.m`]: activa });

  const nuevo = activa
    ? [...resumenActual, fecha]
    : resumenActual.filter((f) => f !== fecha);

  await guardarResumen(parejaId, nuevo);
  return [...new Set(nuevo)].sort();
}

export async function alternarSintoma(
  parejaId: string,
  fecha: string,
  sintoma: string,
  actuales: string[],
): Promise<string[]> {
  if (!IDS_SINTOMAS.includes(sintoma)) throw new ErrorCiclo('Síntoma desconocido.');

  const nuevos = actuales.includes(sintoma)
    ? actuales.filter((s) => s !== sintoma)
    : [...actuales, sintoma];

  await escribirDia(parejaId, fecha, { [`dias.${fecha}.s`]: nuevos });
  return nuevos;
}

/**
 * Registra una relación. `conPreservativo` se guarda tal cual, sin
 * interpretaciones: la app no opina sobre la decisión, solo la anota.
 */
export async function registrarRelacion(
  parejaId: string,
  fecha: string,
  conPreservativo: boolean,
  actuales: { p: boolean }[],
): Promise<{ p: boolean }[]> {
  const nuevas = [...actuales, { p: conPreservativo }].slice(0, 20);
  await escribirDia(parejaId, fecha, { [`dias.${fecha}.r`]: nuevas });
  return nuevas;
}

export async function quitarRelacion(
  parejaId: string,
  fecha: string,
  indice: number,
  actuales: { p: boolean }[],
): Promise<{ p: boolean }[]> {
  const nuevas = actuales.filter((_, i) => i !== indice);
  await escribirDia(parejaId, fecha, { [`dias.${fecha}.r`]: nuevas });
  return nuevas;
}

export async function guardarNota(
  parejaId: string,
  fecha: string,
  nota: string,
): Promise<void> {
  const limpia = nota.trim().slice(0, 200);
  if (/[<>]/.test(limpia)) throw new ErrorCiclo('No se admiten los caracteres < ni >.');
  await escribirDia(parejaId, fecha, {
    [`dias.${fecha}.n`]: limpia.length > 0 ? limpia : deleteField(),
  });
}

/** Borra todo lo anotado un día concreto. */
export async function borrarDia(
  parejaId: string,
  fecha: string,
  resumenActual: string[],
): Promise<string[]> {
  await escribirDia(parejaId, fecha, { [`dias.${fecha}`]: deleteField() });
  const nuevo = resumenActual.filter((f) => f !== fecha);
  await guardarResumen(parejaId, nuevo);
  return nuevo;
}

/**
 * Reconstruye el resumen leyendo los meses uno a uno.
 *
 * Es la red de seguridad por si el resumen y los meses se separan —una escritura
 * que falló a mitad, dos teléfonos escribiendo a la vez—. Se le pasa el rango
 * de meses a revisar porque leerlos todos no tiene fin.
 */
export async function reconstruirResumen(
  parejaId: string,
  meses: string[],
): Promise<string[]> {
  const encontrados: string[] = [];

  for (const mes of meses) {
    const snap = await getDoc(doc(obtenerFirestore(), FS.cicloMes(parejaId, mes)));
    const dias = (snap.data()?.dias ?? {}) as Record<string, { m?: unknown }>;
    for (const [fecha, v] of Object.entries(dias)) {
      if (v?.m === true) encontrados.push(fecha);
    }
  }

  await guardarResumen(parejaId, encontrados);
  return [...new Set(encontrados)].sort();
}

export { iniciosDesdeDias };
