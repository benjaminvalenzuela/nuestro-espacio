import { z } from 'zod';
import { PERSONAS } from '../enums.js';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  PROGRESO DEL BANCO
 *
 *  Qué cartas están hechas y cuántas veces se han pasado. Vive en UN documento
 *  por pareja con un mapa `items`, por la razón de cuota explicada en
 *  rutas-datos.ts.
 *
 *  Las claves del mapa son deliberadamente cortas: con 1.000 entradas, escribir
 *  "hecha"/"pases"/"actualizadoEn" en cada una costaría ~25 KB extra de nombres
 *  de campo repetidos. No es microoptimización gratuita — es la diferencia entre
 *  un documento holgado y uno acercándose al límite.
 *
 *      h · hecha (bool)          p · pases (int)
 *      t · epoch ms de la última vez que salió
 *      q · quién la marcó hecha ('a' | 'b')
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A los 3 pases la carta se retira sola: el desinterés se expresa pasando. */
export const PASES_PARA_DESCARTAR = 3;

export const EntradaProgresoSchema = z.object({
  h: z.boolean().default(false),
  p: z.number().int().min(0).max(99).default(0),
  t: z.number().int().nonnegative().default(0),
  q: z.enum(PERSONAS).nullish(),
});
export type EntradaProgreso = z.infer<typeof EntradaProgresoSchema>;

export const ProgresoSchema = z.object({
  items: z.record(z.string(), EntradaProgresoSchema).default({}),
});
export type Progreso = z.infer<typeof ProgresoSchema>;

export const ENTRADA_VACIA: EntradaProgreso = { h: false, p: 0, t: 0, q: null };

/** Lee una entrada tolerando documentos viejos o corruptos. */
export function entradaDe(items: Record<string, unknown>, id: string): EntradaProgreso {
  const r = EntradaProgresoSchema.safeParse(items[id]);
  return r.success ? r.data : ENTRADA_VACIA;
}

/**
 * Una carta queda fuera de la rotación cuando la pasaron demasiadas veces.
 *
 * Las HECHAS no se retiran: siguen apareciendo, pero marcadas. Es lo pedido —
 * "si me vuelve a aparecer, que me muestre que ya se hizo"— y además es lo
 * correcto con un banco de mil: si desaparecieran, no habría forma de recordar
 * una conversación buena, y el catálogo se vaciaría sin dejar rastro.
 */
export function estaDescartada(e: EntradaProgreso): boolean {
  return e.p >= PASES_PARA_DESCARTAR;
}
