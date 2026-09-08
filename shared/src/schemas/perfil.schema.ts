import { z } from 'zod';

/**
 * Saneamiento de texto libre — primera de las tres capas anti-XSS.
 *
 *   1. AQUÍ: se rechaza < y > antes de que el dato salga del navegador.
 *   2. Security Rules: la misma comprobación en el servidor, por si alguien
 *      se salta el cliente (que puede, y hay que asumir que lo hará).
 *   3. Render: siempre con textContent, nunca con innerHTML.
 *
 * Ninguna capa sobra: la 1 da buenos mensajes de error, la 2 es la que
 * realmente protege, la 3 hace inofensivo cualquier dato antiguo o migrado.
 */
export const textoSeguro = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, `Mínimo ${min} caracteres`)
    .max(max, `Máximo ${max} caracteres`)
    .refine((v) => !/[<>]/.test(v), 'No se admiten los caracteres < ni >');

/** Fecha civil en formato ISO corto. Nunca guardamos horas locales. */
export const fechaISO = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: AAAA-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Fecha inexistente');

/** Lista de gustos: textos cortos, sin duplicados y con techo. */
const lista = (max = 30) => z.array(textoSeguro(1, 60)).max(max).default([]);

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  PERFIL INDIVIDUAL
 *
 *  Las secciones son la unidad de organización de la pantalla: agrupar veinte
 *  campos sueltos en un formulario plano lo vuelve inservible en un teléfono.
 *
 *  El SIGNO ZODIACAL no está aquí a propósito. Se calcula desde
 *  `fechaNacimiento` en `shared/zodiaco.ts`: guardarlo sería duplicar un dato
 *  que ya existe y arriesgarse a que los dos se contradigan.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const PerfilSchema = z.object({
  nombre: textoSeguro(1, 40),
  fechaNacimiento: fechaISO.optional(),
  colorTema: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),

  // ── Gustos ───────────────────────────────────────────────────────────
  peliculasFavoritas: lista(),
  seriesFavoritas: lista(),
  cancionesFavoritas: lista(),
  librosFavoritos: lista(),
  coloresFavoritos: lista(10),

  // ── Comida ───────────────────────────────────────────────────────────
  comidasFavoritas: lista(),
  comidasQueNoGustan: lista(),
  dulcesFavoritos: lista(),
  frutasFavoritas: lista(),
  alergias: lista(20),

  // ── Tiempo libre ─────────────────────────────────────────────────────
  deportesFavoritos: lista(),
  hobbies: lista(),
  lugaresFavoritos: lista(),

  // ── Naturaleza ───────────────────────────────────────────────────────
  floresFavoritas: lista(10),
  animalesFavoritos: lista(),
  nombresMascotas: lista(10),

  // ── Lo demás ─────────────────────────────────────────────────────────
  miedos: lista(),
  disgustos: lista(),
  suenos: lista(),

  // ── Familia ──────────────────────────────────────────────────────────
  nombresPapas: lista(6),
  nombresHermanos: lista(15),
  nombresSobrinos: lista(20),

  // Campos de la versión anterior. Se conservan porque los perfiles ya
  // guardados los tienen, y borrarlos del esquema borraría datos reales.
  gustos: lista(),
});
export type Perfil = z.infer<typeof PerfilSchema>;

/** Campos que son listas, para poder recorrerlos sin escribirlos a mano. */
export const CAMPOS_LISTA = [
  'peliculasFavoritas', 'seriesFavoritas', 'cancionesFavoritas', 'librosFavoritos',
  'coloresFavoritos', 'comidasFavoritas', 'comidasQueNoGustan', 'dulcesFavoritos',
  'frutasFavoritas', 'alergias', 'deportesFavoritos', 'hobbies', 'lugaresFavoritos',
  'floresFavoritas', 'animalesFavoritos', 'nombresMascotas', 'miedos', 'disgustos',
  'suenos', 'nombresPapas', 'nombresHermanos', 'nombresSobrinos', 'gustos',
] as const;
export type CampoLista = (typeof CAMPOS_LISTA)[number];

export interface SeccionPerfil {
  id: string;
  titulo: string;
  emoji: string;
  campos: { campo: CampoLista; etiqueta: string; ejemplo: string }[];
}

/** El orden de esta lista ES el orden de la pantalla. */
export const SECCIONES_PERFIL: SeccionPerfil[] = [
  {
    id: 'gustos', titulo: 'Gustos', emoji: '🎬',
    campos: [
      { campo: 'peliculasFavoritas', etiqueta: 'Películas favoritas', ejemplo: 'Amélie' },
      { campo: 'seriesFavoritas', etiqueta: 'Series favoritas', ejemplo: 'The Office' },
      { campo: 'cancionesFavoritas', etiqueta: 'Canciones favoritas', ejemplo: 'Nada personal' },
      { campo: 'librosFavoritos', etiqueta: 'Libros favoritos', ejemplo: 'Rayuela' },
      { campo: 'coloresFavoritos', etiqueta: 'Colores favoritos', ejemplo: 'Verde agua' },
    ],
  },
  {
    id: 'comida', titulo: 'Comida', emoji: '🍽️',
    campos: [
      { campo: 'comidasFavoritas', etiqueta: 'Comidas favoritas', ejemplo: 'Lasaña' },
      { campo: 'comidasQueNoGustan', etiqueta: 'Comidas que no te gustan', ejemplo: 'Betarraga' },
      { campo: 'dulcesFavoritos', etiqueta: 'Dulces, chocolates y helados', ejemplo: 'Helado de pistacho' },
      { campo: 'frutasFavoritas', etiqueta: 'Frutas favoritas', ejemplo: 'Frutilla' },
      { campo: 'alergias', etiqueta: 'Alergias', ejemplo: 'Maní' },
    ],
  },
  {
    id: 'tiempo', titulo: 'Tiempo libre', emoji: '⚽',
    campos: [
      { campo: 'deportesFavoritos', etiqueta: 'Deportes favoritos', ejemplo: 'Tenis' },
      { campo: 'hobbies', etiqueta: 'Hobbies', ejemplo: 'Cerámica' },
      { campo: 'lugaresFavoritos', etiqueta: 'Lugares favoritos', ejemplo: 'Cerro San Cristóbal' },
    ],
  },
  {
    id: 'naturaleza', titulo: 'Naturaleza', emoji: '🌷',
    campos: [
      { campo: 'floresFavoritas', etiqueta: 'Flores favoritas', ejemplo: 'Girasol' },
      { campo: 'animalesFavoritos', etiqueta: 'Animales favoritos', ejemplo: 'Nutria' },
      { campo: 'nombresMascotas', etiqueta: 'Nombres de tus mascotas', ejemplo: 'Pelusa' },
    ],
  },
  {
    id: 'interior', titulo: 'Lo que llevas dentro', emoji: '💭',
    campos: [
      { campo: 'miedos', etiqueta: 'Miedos', ejemplo: 'Las alturas' },
      { campo: 'disgustos', etiqueta: 'Cosas que no te gustan', ejemplo: 'Los ruidos fuertes' },
      { campo: 'suenos', etiqueta: 'Sueños y metas', ejemplo: 'Vivir junto al mar' },
    ],
  },
  {
    id: 'familia', titulo: 'Familia', emoji: '👨‍👩‍👧',
    campos: [
      { campo: 'nombresPapas', etiqueta: 'Papás', ejemplo: 'María' },
      { campo: 'nombresHermanos', etiqueta: 'Hermanos y hermanas', ejemplo: 'Tomás' },
      { campo: 'nombresSobrinos', etiqueta: 'Sobrinos y sobrinas', ejemplo: 'Emilia' },
    ],
  },
];

export const HitoSchema = z.object({
  id: z.string().min(1).max(40),
  titulo: textoSeguro(1, 60),
  fecha: fechaISO,
  nota: textoSeguro(0, 200).optional(),
});
export type Hito = z.infer<typeof HitoSchema>;

export const PerfilConjuntoSchema = z.object({
  fechaInicioSalidas: fechaISO.nullable().default(null),
  fechaNoviazgo: fechaISO.nullable().default(null),
  hitos: z.array(HitoSchema).max(100).default([]),
});
export type PerfilConjunto = z.infer<typeof PerfilConjuntoSchema>;
