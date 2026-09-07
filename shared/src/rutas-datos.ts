/**
 * Constructores de rutas de Firestore y RTDB.
 *
 * Motivo de existir: las Security Rules están escritas contra rutas literales.
 * Un typo en una ruta del cliente no produce un error de compilación — produce
 * un permission_denied silencioso o, peor, un dato huérfano. Centralizarlas
 * elimina esa clase de bug de raíz.
 *
 * Convención de indexado (ADR-012): todo lo que pertenece a una PERSONA se
 * indexa por 'a'/'b'. Solo /dispositivos se indexa por uid, porque es
 * precisamente la tabla que traduce uid -> persona.
 */

import type { Ruleta, Persona } from './enums.js';

// ── Firestore ──────────────────────────────────────────────────────────────
export const FS = {
  configApp: 'config/app',

  pareja: (parejaId: string) => `parejas/${parejaId}`,

  /** Códigos de vinculación. Invisibles para el cliente; solo los lee el motor de reglas. */
  secretoAsientos: (parejaId: string) => `parejas/${parejaId}/secretos/asientos`,

  dispositivos: (parejaId: string) => `parejas/${parejaId}/dispositivos`,
  dispositivo: (parejaId: string, uid: string) => `parejas/${parejaId}/dispositivos/${uid}`,

  perfiles: (parejaId: string) => `parejas/${parejaId}/perfiles`,
  perfil: (parejaId: string, p: Persona) => `parejas/${parejaId}/perfiles/${p}`,

  perfilConjunto: (parejaId: string) => `parejas/${parejaId}/perfilConjunto/singleton`,

  panoramas: (parejaId: string) => `parejas/${parejaId}/panoramas`,
  panorama: (parejaId: string, id: string) => `parejas/${parejaId}/panoramas/${id}`,

  historialPanoramas: (parejaId: string) => `parejas/${parejaId}/historialPanoramas`,
  organizadores: (parejaId: string) => `parejas/${parejaId}/organizadores`,
  organizador: (parejaId: string, p: Persona) => `parejas/${parejaId}/organizadores/${p}`,
  historialOrganizacion: (parejaId: string) => `parejas/${parejaId}/historialOrganizacion`,

  partidasDilemas: (parejaId: string) => `parejas/${parejaId}/partidasDilemas`,
  preguntasServidas: (parejaId: string) => `parejas/${parejaId}/preguntasServidas`,

  /** Evento en curso: panorama sorteado + quién organiza + fecha. Documento único. */
  eventoActual: (parejaId: string) => `parejas/${parejaId}/eventos/actual`,
  configPareja: (parejaId: string) => `parejas/${parejaId}/config/app`,
  auditoria: (parejaId: string) => `parejas/${parejaId}/auditoria`,

  // Bancos globales (ADR-009)
  preguntas: 'preguntas',
  dilemas: 'dilemas',
} as const;

// ── Realtime Database ──────────────────────────────────────────────────────
export const RTDB = {
  sala: (parejaId: string) => `salas/${parejaId}`,

  /** Códigos. `.read: false` para todo el mundo; solo los compara el servidor. */
  asiento: (parejaId: string, p: Persona) => `salas/${parejaId}/asientos/${p}`,

  dispositivo: (parejaId: string, uid: string) => `salas/${parejaId}/dispositivos/${uid}`,

  personas: (parejaId: string) => `salas/${parejaId}/personas`,
  persona: (parejaId: string, p: Persona) => `salas/${parejaId}/personas/${p}`,

  presencia: (parejaId: string) => `salas/${parejaId}/presencia`,
  presenciaDe: (parejaId: string, p: Persona) => `salas/${parejaId}/presencia/${p}`,
  conexion: (parejaId: string, p: Persona, sesionId: string) =>
    `salas/${parejaId}/presencia/${p}/conexiones/${sesionId}`,

  giro: (parejaId: string, ruleta: Ruleta) => `salas/${parejaId}/giro/${ruleta}`,

  /** Una carta en curso POR CATEGORÍA: los filtros son independientes entre sí. */
  preguntaActiva: (parejaId: string, filtro: string) =>
    `salas/${parejaId}/preguntaActiva/${filtro}`,

  rondaDilema: (parejaId: string, rondaId: string) => `salas/${parejaId}/dilemas/${rondaId}`,
  metaRonda: (parejaId: string, rondaId: string) => `salas/${parejaId}/dilemas/${rondaId}/meta`,
  votosRonda: (parejaId: string, rondaId: string) => `salas/${parejaId}/dilemas/${rondaId}/votos`,
  votoDe: (parejaId: string, rondaId: string, p: Persona) =>
    `salas/${parejaId}/dilemas/${rondaId}/votos/${p}`,

  estadoSala: (parejaId: string) => `salas/${parejaId}/estado`,
} as const;
