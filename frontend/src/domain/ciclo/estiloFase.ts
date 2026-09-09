import type { Fase } from '@shared/ciclo';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  CÓMO SE PINTA CADA FASE
 *
 *  Una sola tabla para toda la app. La usan el calendario (celdas y leyenda) y
 *  el recuadro del inicio, así que el verde de la leyenda y el verde del día 12
 *  no pueden separarse: son la misma clase.
 *
 *  Las clases son utilidades definidas en global.css con su propio par
 *  fondo/texto. No se usan opacidades del tipo `bg-peligro/15` porque un tinte
 *  al 15% se ve lavado sobre el crema y desaparece sobre el fondo oscuro.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const CLASE_FASE: Record<Fase, string> = {
  menstruacion: 'fase-menstruacion',
  folicular: 'fase-folicular',
  ovulacion: 'fase-ovulacion',
  lutea: 'fase-lutea',
  desconocida: 'fase-desconocida',
};

export const EMOJI_FASE: Record<Fase, string> = {
  menstruacion: '🩸',
  folicular: '🌱',
  ovulacion: '🥚',
  lutea: '🌘',
  desconocida: '❔',
};
