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

export const PerfilSchema = z.object({
  nombre: textoSeguro(1, 40),
  fechaNacimiento: fechaISO.optional(),
  gustos: z.array(textoSeguro(1, 60)).max(30).default([]),
  hobbies: z.array(textoSeguro(1, 60)).max(30).default([]),
  disgustos: z.array(textoSeguro(1, 60)).max(30).default([]),
  alimentosPreferidos: z.array(textoSeguro(1, 60)).max(30).default([]),
  alergias: z.array(textoSeguro(1, 60)).max(20).default([]),
  colorTema: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
export type Perfil = z.infer<typeof PerfilSchema>;

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
