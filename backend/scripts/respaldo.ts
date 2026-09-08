/**
 * respaldo.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Copia COMPLETA de todo lo que ustedes han escrito, a un archivo local.
 *
 * Por qué existe: la promesa de que "un despliegue no borra datos" es cierta
 * —los datos viven en Firebase y el despliegue solo cambia la página— pero una
 * promesa no es una garantía. Esto sí lo es: un archivo en el disco que se
 * puede abrir, leer y restaurar aunque el proyecto entero desaparezca.
 *
 * Qué se lleva:
 *   · perfiles, perfil conjunto y hitos
 *   · panoramas con su contador de veces realizadas
 *   · el evento en curso y los historiales
 *   · el marcador de organización
 *   · el progreso de preguntas y dilemas (hechas y pasadas)
 *   · las partidas de "qué prefieres" jugadas
 *   · el banco global de preguntas y dilemas
 *   · los dispositivos vinculados y la configuración
 *
 * Qué NO se lleva, a propósito:
 *   · /secretos — son los códigos de vinculación. Un respaldo se copia, se
 *     manda por correo y se olvida en la carpeta de Descargas; los códigos no
 *     pueden acabar ahí. Se regeneran con `provisionar` si hace falta.
 *
 *   npm run respaldo -- --entorno=qa
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Firestore } from 'firebase-admin/firestore';
import { resolverEntorno } from '../src/lib/guardEntorno.js';
import { crearAdmin } from '../src/lib/adminApp.js';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ctx = await resolverEntorno();
const { db, rtdb } = crearAdmin(ctx);
const PAREJA_ID = process.env.PAREJA_ID ?? 'pareja_principal';

/** Convierte Timestamps a texto ISO para que el JSON se pueda leer a ojo. */
function serializable(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'object') {
    const o = v as { toDate?: () => Date };
    if (typeof o.toDate === 'function') return o.toDate().toISOString();
    if (Array.isArray(v)) return v.map(serializable);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, serializable(x)]));
  }
  return v;
}

async function coleccion(db: Firestore, ruta: string): Promise<Record<string, unknown>> {
  const snap = await db.collection(ruta).get();
  const salida: Record<string, unknown> = {};
  for (const d of snap.docs) salida[d.id] = serializable(d.data());
  return salida;
}

async function documento(db: Firestore, ruta: string): Promise<unknown> {
  const snap = await db.doc(ruta).get();
  return snap.exists ? serializable(snap.data()) : null;
}

const p = (sub: string) => `parejas/${PAREJA_ID}/${sub}`;

console.log('\nLeyendo…');

const datos = {
  meta: {
    proyecto: ctx.projectId,
    entorno: ctx.entorno,
    parejaId: PAREJA_ID,
    generadoEn: new Date().toISOString(),
    nota: 'No incluye los códigos de vinculación, a propósito.',
  },

  // ── Lo que ustedes escriben ────────────────────────────────────────────
  perfiles: await coleccion(db, p('perfiles')),
  perfilConjunto: await documento(db, p('perfilConjunto/singleton')),
  panoramas: await coleccion(db, p('panoramas')),
  eventoActual: await documento(db, p('eventos/actual')),
  organizadores: await coleccion(db, p('organizadores')),
  progresoPreguntas: await documento(db, p('progreso/preguntas')),
  progresoDilemas: await documento(db, p('progreso/dilemas')),

  // ── Historiales ────────────────────────────────────────────────────────
  historialPanoramas: await coleccion(db, p('historialPanoramas')),
  historialOrganizacion: await coleccion(db, p('historialOrganizacion')),
  partidasDilemas: await coleccion(db, p('partidasDilemas')),
  auditoria: await coleccion(db, p('auditoria')),

  // ── Banco global ───────────────────────────────────────────────────────
  preguntas: await coleccion(db, 'preguntas'),
  dilemas: await coleccion(db, 'dilemas'),

  // ── Identidad y configuración (sin secretos) ───────────────────────────
  dispositivos: await coleccion(db, p('dispositivos')),
  configApp: await documento(db, 'config/app'),
  configPareja: await documento(db, p('config/app')),

  // ── Realtime Database ──────────────────────────────────────────────────
  rtdb: {
    dispositivos: (await rtdb.ref(`salas/${PAREJA_ID}/dispositivos`).get()).val(),
    personas: (await rtdb.ref(`salas/${PAREJA_ID}/personas`).get()).val(),
    presencia: (await rtdb.ref(`salas/${PAREJA_ID}/presencia`).get()).val(),
  },
};

const sello = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const carpeta = resolve(RAIZ, 'respaldos');
mkdirSync(carpeta, { recursive: true });

const archivo = resolve(carpeta, `${ctx.entorno}-${sello}.json`);
writeFileSync(archivo, JSON.stringify(datos, null, 2), 'utf8');

const cuenta = (o: unknown) => (o && typeof o === 'object' ? Object.keys(o).length : 0);

console.log(`\nRESPALDO · ${ctx.projectId}`);
console.log('─'.repeat(70));
console.log(`  perfiles .............. ${cuenta(datos.perfiles)}`);
console.log(`  panoramas ............. ${cuenta(datos.panoramas)}`);
console.log(`  preguntas ............. ${cuenta(datos.preguntas)}`);
console.log(`  dilemas ............... ${cuenta(datos.dilemas)}`);
console.log(`  partidas jugadas ...... ${cuenta(datos.partidasDilemas)}`);
console.log(`  historial panoramas ... ${cuenta(datos.historialPanoramas)}`);
console.log(`  dispositivos .......... ${cuenta(datos.dispositivos)}`);
console.log(`\n✔ Guardado en backend/respaldos/${ctx.entorno}-${sello}.json`);
console.log('  Esa carpeta está fuera de git: el repositorio es público.\n');

process.exit(0);
