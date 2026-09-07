/**
 * seed-contenido.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Carga el banco global de preguntas y dilemas (ADR-009).
 *
 * ⚠ El Admin SDK OMITE las Security Rules. Por eso este script revalida cada
 *   registro con el MISMO contrato Zod que usará el frontend: si las reglas no
 *   nos protegen aquí, el schema sí. Un seed no puede ser la puerta trasera
 *   por la que entren datos que la app jamás habría aceptado.
 *
 *   npm run seed -- --entorno=qa
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { normalizarNombre } from '../../shared/src/panoramas.js';
import { resolverEntorno } from '../src/lib/guardEntorno.js';
import { crearAdmin } from '../src/lib/adminApp.js';

const DATOS = resolve(dirname(fileURLToPath(import.meta.url)), '../data');

// Mismas invariantes que firestore.rules: longitudes, enums y prohibición de < >
const textoSeguro = (min: number, max: number) =>
  z.string().trim().min(min).max(max).refine((v) => !/[<>]/.test(v), {
    message: 'No se admiten los caracteres < o > (prevención de XSS)',
  });

const PreguntaSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{3,60}$/),
  texto: textoSeguro(8, 300),
  categoria: z.enum(['profundas', 'subidas_de_tono', 'supuestos']),
});

const PanoramaSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{3,60}$/),
  nombre: textoSeguro(2, 80),
});

const DilemaSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{3,60}$/),
    opcionA: textoSeguro(2, 120),
    opcionB: textoSeguro(2, 120),
    categoria: z.enum(['general', 'profundas', 'subidas_de_tono', 'absurdas']),
  })
  .refine((d) => d.opcionA !== d.opcionB, { message: 'Las dos opciones no pueden ser iguales' });

const ctx = await resolverEntorno();
const { db } = crearAdmin(ctx);

function cargar<T>(archivo: string, schema: z.ZodType<T>): T[] {
  const crudo = JSON.parse(readFileSync(resolve(DATOS, archivo), 'utf8')) as unknown[];
  const validos: T[] = [];
  let rechazados = 0;

  crudo.forEach((fila, i) => {
    const r = schema.safeParse(fila);
    if (r.success) validos.push(r.data);
    else {
      rechazados++;
      console.warn(`  ✖ ${archivo}[${i}] rechazado: ${r.error.issues[0].message}`);
    }
  });

  if (rechazados > 0) {
    console.error(`\n✖ ${rechazados} registro(s) inválido(s) en ${archivo}. Corrige y reintenta.\n`);
    process.exit(1);
  }
  return validos;
}

const preguntas = cargar('preguntas.seed.json', PreguntaSchema);
const dilemas = cargar('dilemas.seed.json', DilemaSchema);
const panoramas = cargar('panoramas.seed.json', PanoramaSchema);

// merge:true → idempotente. Reejecutar no duplica ni pisa ediciones del admin
// sobre el campo 'activa' (solo se refresca el contenido del banco base).
let lote = db.batch();
let n = 0;

for (const p of preguntas) {
  lote.set(
    db.collection('preguntas').doc(p.id),
    { texto: p.texto, categoria: p.categoria, activa: true,
      creadaEn: FieldValue.serverTimestamp(), creadaPor: 'a' },
    { merge: true },
  );
  if (++n % 400 === 0) { await lote.commit(); lote = db.batch(); }
}

for (const d of dilemas) {
  lote.set(
    db.collection('dilemas').doc(d.id),
    { opcionA: d.opcionA, opcionB: d.opcionB, categoria: d.categoria, activo: true,
      creadoEn: FieldValue.serverTimestamp(), creadoPor: 'a' },
    { merge: true },
  );
  if (++n % 400 === 0) { await lote.commit(); lote = db.batch(); }
}

await lote.commit();

/**
 * ── Panoramas ───────────────────────────────────────────────────────────────
 * A diferencia de preguntas y dilemas, los panoramas NO son un banco global:
 * cuelgan de la pareja y la app los edita. Por eso aquí no vale `merge:true`
 * ciego — sobrescribiría `vecesRealizado` y borraría el historial de "cuántas
 * veces lo hemos hecho".
 *
 * Se siembran solo los que faltan, comparando por `nombreNormalizado`, que es
 * la clave real de deduplicación: si alguien ya agregó "Picnic en el Parque"
 * desde la app, el seed lo respeta y no crea un gemelo.
 */
const PAREJA_ID = process.env.PAREJA_ID;
if (!PAREJA_ID) {
  console.error('\n✖ Falta PAREJA_ID en el .env del entorno.\n');
  process.exit(1);
}

const refPanoramas = db.collection(`parejas/${PAREJA_ID}/panoramas`);
const yaExisten = new Set(
  (await refPanoramas.get()).docs.map((d) => normalizarNombre(String(d.data().nombre ?? ''))),
);

const nuevos = panoramas.filter((p) => !yaExisten.has(normalizarNombre(p.nombre)));

let lotePanoramas = db.batch();
let m = 0;
for (const p of nuevos) {
  lotePanoramas.set(refPanoramas.doc(p.id), {
    nombre: p.nombre,
    nombreNormalizado: normalizarNombre(p.nombre),
    creadoPor: 'a',
    creadoEn: FieldValue.serverTimestamp(),
    activo: true,
    peso: 1,
    vecesRealizado: 0,
    ultimaVezEn: null,
  });
  if (++m % 400 === 0) { await lotePanoramas.commit(); lotePanoramas = db.batch(); }
}
if (m > 0) await lotePanoramas.commit();

console.log(
  `  panoramas: ${nuevos.length} creados, ${panoramas.length - nuevos.length} ya estaban.`,
);

console.log(`\n✔ ${preguntas.length} preguntas y ${dilemas.length} dilemas cargados en ${ctx.projectId}.\n`);
process.exit(0);
