/**
 * provisionar-espacio.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Deja un entorno listo para usarse. Idempotente.
 *
 *   npm run provisionar -- --entorno=desa
 *   npm run provisionar -- --entorno=qa   --regenerar
 *
 * Qué hace:
 *   1. Genera (o conserva) los dos CÓDIGOS DE VINCULACIÓN, uno por persona.
 *   2. Los guarda en RTDB y en Firestore, en nodos que NINGÚN cliente puede
 *      leer. Solo el motor de reglas los consulta para comparar.
 *   3. Crea la estructura base: pareja, perfiles, marcadores, configuración.
 *
 * ⚠ Los códigos se imprimen UNA VEZ en pantalla. No se guardan en ningún
 *   archivo ni se envían a ninguna parte: si los pierdes, se regeneran con
 *   --regenerar (lo que invalida los dispositivos ya vinculados).
 */

import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { resolverEntorno } from '../src/lib/guardEntorno.js';
import { crearAdmin } from '../src/lib/adminApp.js';
import { PERSONAS, type Persona } from '../../shared/src/enums.js';
import { generarCuerpo, formatearCodigo } from '../../shared/src/schemas/codigo.js';

const ctx = await resolverEntorno();
const { db, rtdb } = crearAdmin(ctx);

const PAREJA_ID = process.env.PAREJA_ID ?? 'pareja_principal';
const REGENERAR = process.argv.includes('--regenerar');

// ── 1 · Códigos ─────────────────────────────────────────────────────────────
// randomBytes es el CSPRNG del sistema. generarCuerpo aplica muestreo por
// rechazo para que la distribución sobre el alfabeto de 30 sea uniforme.
function nuevoCodigo(persona: Persona): string {
  let reserva = randomBytes(64);
  let i = 0;
  const siguienteByte = () => {
    if (i >= reserva.length) { reserva = randomBytes(64); i = 0; }
    return reserva[i++]!;
  };
  return formatearCodigo(persona, generarCuerpo(siguienteByte));
}

const refAsientosRtdb = rtdb.ref(`salas/${PAREJA_ID}/asientos`);
const refAsientosFs = db.doc(`parejas/${PAREJA_ID}/secretos/asientos`);

const existentes = (await refAsientosRtdb.get()).val() as Record<string, { codigo: string }> | null;
const yaHabia = Boolean(existentes?.a?.codigo && existentes?.b?.codigo);

let codigos: Record<Persona, string>;

if (yaHabia && !REGENERAR) {
  codigos = { a: existentes!.a!.codigo, b: existentes!.b!.codigo };
  console.log('ℹ  Ya existían códigos. Se conservan (usa --regenerar para cambiarlos).\n');
} else {
  codigos = { a: nuevoCodigo('a'), b: nuevoCodigo('b') };
  if (yaHabia) {
    console.log('⚠  Códigos REGENERADOS. Los dispositivos vinculados con los antiguos');
    console.log('   dejan de funcionar y habrá que volver a vincularlos.\n');
  }
}

// RTDB: lo lee el motor de reglas para validar la vinculación.
await refAsientosRtdb.set({
  a: { codigo: codigos.a },
  b: { codigo: codigos.b },
});

// Firestore no puede leer RTDB, así que necesita su propia copia. Este
// documento tiene `allow read, write: if false`: solo lo alcanza get() desde
// las reglas y el Admin SDK.
await refAsientosFs.set({ a: codigos.a, b: codigos.b });

// ── 2 · Estructura base ─────────────────────────────────────────────────────
// /config/app es el ancla que permite autorizar los bancos globales de
// preguntas y dilemas sin saber de antemano el parejaId.
await db.doc('config/app').set(
  { parejaId: PAREJA_ID, versionSchema: 1, actualizadoEn: FieldValue.serverTimestamp() },
  { merge: true },
);

const refPareja = db.doc(`parejas/${PAREJA_ID}`);
await refPareja.set(
  {
    nombre: 'Nuestro Espacio',
    personas: [...PERSONAS],
    zonaHoraria: 'America/Santiago',
    creadoEn: FieldValue.serverTimestamp(),
  },
  { merge: true },
);

for (const p of PERSONAS) {
  const perfil = refPareja.collection('perfiles').doc(p);
  if (!(await perfil.get()).exists) {
    await perfil.set({
      nombre: p === 'a' ? 'Persona A' : 'Persona B',
      gustos: [], hobbies: [], disgustos: [], alimentosPreferidos: [], alergias: [],
      actualizadoEn: FieldValue.serverTimestamp(),
    });
  }
  const marcador = refPareja.collection('organizadores').doc(p);
  if (!(await marcador.get()).exists) {
    await marcador.set({ vecesOrganizado: 0, ultimaVezEn: null });
  }
}

const conjunto = refPareja.collection('perfilConjunto').doc('singleton');
if (!(await conjunto.get()).exists) {
  await conjunto.set({
    fechaInicioSalidas: null, fechaNoviazgo: null, hitos: [], interesesComunes: [],
    actualizadoPor: 'a', actualizadoEn: FieldValue.serverTimestamp(),
  });
}

await refPareja.collection('config').doc('app').set(
  { versionSchema: 1, ventanaAntiRepeticion: 25, flags: { ruletasHabilitadas: true },
    actualizadoEn: FieldValue.serverTimestamp() },
  { merge: true },
);

// ── 3 · Salida ──────────────────────────────────────────────────────────────
const marco = '─'.repeat(46);
console.log(`✔ Espacio "${PAREJA_ID}" provisionado en ${ctx.projectId}.\n`);
console.log(`┌${marco}┐`);
console.log(`│  CÓDIGOS DE VINCULACIÓN${' '.repeat(22)}│`);
console.log(`├${marco}┤`);
console.log(`│  Persona A   ${codigos.a.padEnd(31)}│`);
console.log(`│  Persona B   ${codigos.b.padEnd(31)}│`);
console.log(`└${marco}┘`);
console.log(`
   Cada persona escribe su código UNA VEZ en cada dispositivo.
   Después, abrir la app basta: el vínculo queda guardado en el
   navegador y no caduca.

   ⚠ No los guardes en el repositorio: es público.
`);

process.exit(0);
