/**
 * PERSONAS — el eje de identidad del sistema (ADR-012).
 *
 * Hay exactamente dos asientos, fijos y eternos: 'a' y 'b'. Un DISPOSITIVO
 * (uid anónimo de Firebase) se vincula a una persona presentando un código.
 * Tu computador y tu celular son dos dispositivos de la MISMA persona, y por
 * eso perfiles, marcadores, presencia y votos se indexan por persona — no por
 * uid. Cambiar de teléfono no rompe nada.
 */
export const PERSONAS = ['a', 'b'] as const;
export type Persona = (typeof PERSONAS)[number];

/** La otra persona. Con dos asientos fijos, esto es todo lo que hace falta. */
export const otraPersona = (p: Persona): Persona => (p === 'a' ? 'b' : 'a');

/** Roles del sistema. Ambos miembros son admin (decisión del Paso 1). */
export const ROLES = ['admin', 'miembro'] as const;
export type Rol = (typeof ROLES)[number];

/** Categorías del banco de preguntas. 'mix' es solo un filtro de UI, no se persiste. */
export const CATEGORIAS_PREGUNTA = ['profundas', 'subidas_de_tono', 'supuestos'] as const;
export type CategoriaPregunta = (typeof CATEGORIAS_PREGUNTA)[number];

export const CATEGORIAS_DILEMA = ['general', 'profundas', 'subidas_de_tono', 'absurdas'] as const;
export type CategoriaDilema = (typeof CATEGORIAS_DILEMA)[number];

/** Etiquetas legibles. Un solo lugar donde traducir los enums a castellano. */
export const ETIQUETA_CATEGORIA: Record<CategoriaPregunta | CategoriaDilema, string> = {
  profundas: 'Profundas',
  subidas_de_tono: 'Subidas de tono',
  supuestos: 'Supuestos',
  general: 'General',
  absurdas: 'Absurdas',
};

export const ESTADOS_GIRO = ['idle', 'girando', 'resuelto'] as const;
export type EstadoGiro = (typeof ESTADOS_GIRO)[number];

export const RULETAS = ['panoramas', 'organizacion'] as const;
export type Ruleta = (typeof RULETAS)[number];

/** Zona horaria única del sistema. Los datos se guardan en UTC; esto es solo formato. */
export const ZONA_HORARIA = 'America/Santiago';
export const LOCALE = 'es-CL';
