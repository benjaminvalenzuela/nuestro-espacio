/**
 * seed-contenido.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Carga el banco global de preguntas y dilemas (ADR-009) y los panoramas de la
 * pareja.
 *
 * ⚠ El Admin SDK OMITE las Security Rules. Por eso este script revalida cada
 *   registro con el MISMO contrato Zod que aplicará el frontend: si las reglas
 *   no nos protegen aquí, el schema sí. Un seed no puede ser la puerta trasera
 *   por la que entren datos que la app jamás habría aceptado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  POR QUÉ ESTE SCRIPT NO PUEDE BORRAR NADA
 *
 *  El banco vive en `backend/data/banco/`, un archivo por bloque temático. La
 *  categoría y el nivel NO se repiten en cada línea del JSON: se deducen del
 *  nombre del archivo. Con dos mil registros, repetir `"categoria": "..."` dos
 *  mil veces es dos mil oportunidades de que uno quede mal escrito y acabe en
 *  la categoría equivocada sin que nadie lo note.
 *
 *  Todas las escrituras son `merge: true` sobre un id estable. Reejecutar el
 *  seed —cosa que pasa en cada despliegue de contenido nuevo— refresca el texto
 *  y NO toca `activa`, así que las preguntas que ustedes hayan retirado desde
 *  el panel siguen retiradas. Y nunca borra: no hay un solo `delete` aquí.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   npm run seed -- --entorno=qa
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { normalizarNombre } from '../../shared/src/panoramas.js';
import { resolverEntorno } from '../src/lib/guardEntorno.js';
import { crearAdmin } from '../src/lib/adminApp.js';

const DATOS = resolve(dirname(fileURLToPath(import.meta.url)), '../data');
const BANCO = resolve(DATOS, 'banco');

// Mismas invariantes que firestore.rules: longitudes, enums y prohibición de < >
const textoSeguro = (min: number, max: number) =>
  z.string().trim().min(min).max(max).refine((v) => !/[<>]/.test(v), {
    message: 'No se admiten los caracteres < o > (prevención de XSS)',
  });

const idSeguro = z.string().regex(/^[a-z0-9_-]{3,60}$/);
const nivel = z.union([z.literal(1), z.literal(2), z.literal(3)]).optional();

const PreguntaSchema = z.object({ id: idSeguro, texto: textoSeguro(8, 300), nivel });

const DilemaSchema = z
  .object({
    id: idSeguro,
    opcionA: textoSeguro(2, 120),
    opcionB: textoSeguro(2, 120),
    nivel,
  })
  .refine((d) => d.opcionA !== d.opcionB, { message: 'Las dos opciones no pueden ser iguales' });

const PanoramaSchema = z.object({ id: idSeguro, nombre: textoSeguro(2, 80) });

/**
 * Nombre de archivo → categoría y nivel por defecto.
 *
 * El nivel del archivo es solo el valor por defecto: si un registro trae su
 * propio `nivel`, ese manda. Así los dilemas de tono pueden mezclar
 * intensidades dentro de un mismo archivo sin partirlo en tres.
 */
const MAPA: Record<string, { categoria: string; nivel: number }> = {
  'profundas': { categoria: 'profundas', nivel: 1 },
  'supuestos': { categoria: 'supuestos', nivel: 1 },
  'tono-1': { categoria: 'subidas_de_tono', nivel: 1 },
  'tono-2': { categoria: 'subidas_de_tono', nivel: 2 },
  'tono-3': { categoria: 'subidas_de_tono', nivel: 3 },
  'dilemas-general': { categoria: 'general', nivel: 1 },
  'dilemas-profundas': { categoria: 'profundas', nivel: 1 },
  'dilemas-absurdas': { categoria: 'absurdas', nivel: 1 },
  'dilemas-tono': { categoria: 'subidas_de_tono', nivel: 2 },
};

/** Busca el prefijo más largo que case: 'tono-1' gana sobre 'tono'. */
function clasificar(archivo: string): { categoria: string; nivel: number } {
  const base = archivo.replace(/\.json$/, '');
  const claves = Object.keys(MAPA).sort((a, b) => b.length - a.length);
  const clave = claves.find((k) => base.startsWith(k));
  if (!clave) {
    console.error(`\n✖ No sé a qué categoría pertenece "${archivo}".`);
    console.error('  Agrega su prefijo al MAPA de seed-contenido.ts.\n');
    process.exit(1);
  }
  return MAPA[clave]!;
}

const ctx = await resolverEntorno();
const { db } = crearAdmin(ctx);

interface Fila {
  id: string;
  categoria: string;
  nivel: number;
  texto?: string;
  opcionA?: string;
  opcionB?: string;
}

function cargarBanco(): { preguntas: Fila[]; dilemas: Fila[] } {
  const preguntas: Fila[] = [];
  const dilemas: Fila[] = [];
  const vistos = new Set<string>();
  let rechazados = 0;

  for (const archivo of readdirSync(BANCO).filter((f) => f.endsWith('.json')).sort()) {
    const { categoria, nivel: nivelArchivo } = clasificar(archivo);
    const esDilema = archivo.startsWith('dilemas');
    const crudo = JSON.parse(readFileSync(resolve(BANCO, archivo), 'utf8')) as unknown[];

    crudo.forEach((fila, i) => {
      const r = esDilema ? DilemaSchema.safeParse(fila) : PreguntaSchema.safeParse(fila);
      if (!r.success) {
        rechazados++;
        console.warn(`  ✖ ${archivo}[${i}]: ${r.error.issues[0]!.message}`);
        return;
      }
      const d = r.data;
      // Un id repetido entre archivos sobrescribiría silenciosamente al otro.
      if (vistos.has(d.id)) {
        rechazados++;
        console.warn(`  ✖ ${archivo}: id duplicado "${d.id}"`);
        return;
      }
      vistos.add(d.id);
      (esDilema ? dilemas : preguntas).push({
        ...d,
        categoria,
        nivel: d.nivel ?? nivelArchivo,
      } as Fila);
    });
  }

  if (rechazados > 0) {
    console.error(`\n✖ ${rechazados} registro(s) inválido(s). Corrige y reintenta.\n`);
    process.exit(1);
  }
  return { preguntas, dilemas };
}

const { preguntas, dilemas } = cargarBanco();

// ── Bancos globales ─────────────────────────────────────────────────────────
// merge:true → idempotente. Reejecutar no duplica ni pisa las que el panel haya
// retirado (campo 'activa'): solo refresca el contenido base.
let lote = db.batch();
let n = 0;
const commitSiTocaB = async () => {
  if (++n % 400 === 0) { await lote.commit(); lote = db.batch(); }
};

for (const p of preguntas) {
  lote.set(
    db.collection('preguntas').doc(p.id),
    { texto: p.texto, categoria: p.categoria, nivel: p.nivel, activa: true,
      creadaEn: FieldValue.serverTimestamp(), creadaPor: 'a' },
    { merge: true },
  );
  await commitSiTocaB();
}

for (const d of dilemas) {
  lote.set(
    db.collection('dilemas').doc(d.id),
    { opcionA: d.opcionA, opcionB: d.opcionB, categoria: d.categoria, nivel: d.nivel,
      activo: true, creadoEn: FieldValue.serverTimestamp(), creadoPor: 'a' },
    { merge: true },
  );
  await commitSiTocaB();
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

const panoramas = (JSON.parse(readFileSync(resolve(DATOS, 'panoramas.seed.json'), 'utf8')) as unknown[])
  .map((x) => PanoramaSchema.parse(x));

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

/**
 * Marca de versión del banco. El cliente cachea el catálogo en el navegador
 * —con mil preguntas, releerlo en cada visita se comería la cuota diaria de
 * lecturas del plan gratuito— y usa este número para saber cuándo su copia
 * quedó vieja. Sin esto, cargar contenido nuevo no llegaría a nadie hasta que
 * el navegador decidiera olvidar por su cuenta.
 */
await db.doc('config/app').set(
  {
    versionBanco: FieldValue.increment(1),
    totalPreguntas: preguntas.length,
    totalDilemas: dilemas.length,
    actualizadoEn: FieldValue.serverTimestamp(),
  },
  { merge: true },
);

console.log(`\n  preguntas ... ${preguntas.length}`);
console.log(`  dilemas ..... ${dilemas.length}`);
console.log(`  panoramas ... ${nuevos.length} creados, ${panoramas.length - nuevos.length} ya estaban`);
console.log(`\n✔ Banco cargado en ${ctx.projectId}. Nada fue borrado.\n`);
process.exit(0);
