import { z } from 'zod';
import { PERSONAS } from '../enums.js';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  GIRO · el contrato del sorteo sincronizado (ADR-003)
 *
 *  El cliente NO decide el resultado en su pantalla. El primero que pulsa
 *  "Girar" reclama el turno con una TRANSACCIÓN y deja fijado en el servidor
 *  todo lo necesario para reproducir el giro:
 *
 *      semilla        → cuántas vueltas dará la rueda
 *      indiceGanador  → dónde se detiene
 *      iniciadoEn     → hora del SERVIDOR en que empezó
 *      duracionMs     → cuánto dura
 *
 *  Con esos cuatro datos, cualquier dispositivo calcula el ángulo exacto en
 *  cualquier instante. Por eso la sincronización no depende de que ambos
 *  empiecen a la vez: quien llega tarde o recarga la página entra en el punto
 *  correcto de la animación, como quien sintoniza una transmisión en directo.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const DURACION_GIRO_MS = 5200;

/** Debe caber en el rango que validan las reglas: 3000–12000 ms. */
export const GiroSchema = z.object({
  id: z.string().min(8).max(40),
  estado: z.enum(['idle', 'girando', 'resuelto']),
  iniciadoPor: z.enum(PERSONAS),
  semilla: z.number().int().nonnegative(),
  indiceGanador: z.number().int().nonnegative().max(199),
  /** Copia de las opciones en el momento del giro: el resultado no se
   *  desdibuja si después alguien edita o archiva un panorama. */
  opcionesSnapshot: z.array(z.string().min(1).max(80)).min(1).max(200),
  iniciadoEn: z.number().int().positive(),
  duracionMs: z.number().int().min(3000).max(12000),
  confirmadoEn: z.number().int().positive().nullish(),
});

export type Giro = z.infer<typeof GiroSchema>;

/** Lee un giro crudo de RTDB devolviendo null en vez de reventar. */
export function parsearGiro(crudo: unknown): Giro | null {
  const r = GiroSchema.safeParse(crudo);
  return r.success ? r.data : null;
}
