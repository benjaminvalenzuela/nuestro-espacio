import { PESO_NIVEL, type Nivel } from '@shared/enums';
import { estaDescartada, type EntradaProgreso } from '@shared/schemas/progreso.schema';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  ELECCIÓN DE CARTA
 *
 *  Tres reglas, en este orden de prioridad:
 *
 *   1. Las DESCARTADAS no salen. Tres pases significan "esta no nos gusta".
 *   2. Las NO HECHAS van primero. Con dos mil cartas, repetir mientras quedan
 *      cientos sin estrenar sería absurdo.
 *   3. Dentro de lo elegible, el NIVEL inclina la moneda: los niveles 1 y 2 se
 *      reparten el 55 % de las apariciones y el 3 se queda con el 45 %.
 *
 *  El peso es relativo por carta, no una cuota. Si una noche solo quedan cartas
 *  de nivel 3 sin hacer, saldrán igualmente: es preferible una carta fuerte a
 *  ninguna carta. Y si se acaban las no hechas, se vuelve a las hechas — con su
 *  sello, para que se vea que ya pasaron por ahí.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface Elegible {
  id: string;
  nivel: Nivel;
}

export interface OpcionesEleccion<T extends Elegible> {
  candidatas: T[];
  progreso: Record<string, EntradaProgreso>;
  /** Ids servidos hace poco, para no repetir dos veces seguidas. */
  recientes?: Set<string>;
  excluir?: string | null;
  /** Inyectable para que los tests no dependan del azar. */
  azar?: () => number;
}

/**
 * Escoge un elemento con probabilidad proporcional a su peso.
 *
 * Ruleta clásica: se suman los pesos, se saca un punto al azar dentro de esa
 * suma y se recorre restando hasta cruzarlo. Una carta de nivel 3 ocupa más
 * tramo de la cuerda que una de nivel 1, así que cae más veces.
 */
function elegirPonderado<T extends Elegible>(items: T[], azar: () => number): T | null {
  if (items.length === 0) return null;

  const total = items.reduce((suma, x) => suma + (PESO_NIVEL[x.nivel] ?? 1), 0);
  if (total <= 0) return items[Math.floor(azar() * items.length)] ?? null;

  let punto = azar() * total;
  for (const item of items) {
    punto -= PESO_NIVEL[item.nivel] ?? 1;
    if (punto <= 0) return item;
  }
  // Redondeo en coma flotante: el último es la respuesta correcta.
  return items[items.length - 1] ?? null;
}

export function elegirCarta<T extends Elegible>(op: OpcionesEleccion<T>): T | null {
  const azar = op.azar ?? Math.random;
  const recientes = op.recientes ?? new Set<string>();

  const vivas = op.candidatas.filter((c) => {
    const e = op.progreso[c.id];
    return !(e && estaDescartada(e));
  });
  if (vivas.length === 0) return null;

  const sinExcluida = vivas.filter((c) => c.id !== op.excluir);
  const base = sinExcluida.length > 0 ? sinExcluida : vivas;

  // 1º intento: no hechas y no recientes.
  const frescas = base.filter((c) => !op.progreso[c.id]?.h && !recientes.has(c.id));
  if (frescas.length > 0) return elegirPonderado(frescas, azar);

  // 2º: no hechas aunque sean recientes.
  const noHechas = base.filter((c) => !op.progreso[c.id]?.h);
  if (noHechas.length > 0) return elegirPonderado(noHechas, azar);

  // 3º: se acabaron las nuevas; se repiten las hechas evitando las recientes.
  const hechasViejas = base.filter((c) => !recientes.has(c.id));
  if (hechasViejas.length > 0) return elegirPonderado(hechasViejas, azar);

  return elegirPonderado(base, azar);
}

/** Cuántas cartas quedan sin estrenar. Alimenta el contador de la pantalla. */
export function contarPendientes<T extends Elegible>(
  candidatas: T[],
  progreso: Record<string, EntradaProgreso>,
): { pendientes: number; hechas: number; descartadas: number; total: number } {
  let hechas = 0;
  let descartadas = 0;

  for (const c of candidatas) {
    const e = progreso[c.id];
    if (!e) continue;
    if (estaDescartada(e)) descartadas++;
    else if (e.h) hechas++;
  }

  return {
    total: candidatas.length,
    hechas,
    descartadas,
    pendientes: candidatas.length - hechas - descartadas,
  };
}
