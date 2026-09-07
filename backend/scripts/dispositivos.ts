/**
 * dispositivos.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Inventario y revocación de dispositivos vinculados.
 *
 *   npm run dispositivos -- --entorno=prod
 *   npm run dispositivos -- --entorno=prod --revocar=<uid>
 *
 * ES EL BOTÓN DE EMERGENCIA del nuevo modelo de identidad, y es mejor que el
 * anterior: en vez de degradar el rol de una persona, se corta UN aparato
 * concreto. Pierdes el celular → lo revocas → tu computador sigue entrando y
 * no se pierde ningún dato.
 *
 * La revocación borra el vínculo en AMBAS bases: sin él, ese uid deja de pasar
 * cualquier regla, en Firestore y en RTDB, de inmediato.
 */

import { resolverEntorno } from '../src/lib/guardEntorno.js';
import { crearAdmin } from '../src/lib/adminApp.js';

const ctx = await resolverEntorno();
const { db, rtdb } = crearAdmin(ctx);

const PAREJA_ID = process.env.PAREJA_ID ?? 'pareja_principal';
const aRevocar = process.argv
  .find((a) => a.startsWith('--revocar='))
  ?.slice('--revocar='.length);

const fecha = (ms?: number) =>
  ms ? new Date(ms).toLocaleString('es-CL', { timeZone: 'America/Santiago' }) : '—';

if (aRevocar) {
  const refRtdb = rtdb.ref(`salas/${PAREJA_ID}/dispositivos/${aRevocar}`);
  const snap = await refRtdb.get();

  if (!snap.exists()) {
    console.error(`\n✖ No existe el dispositivo ${aRevocar} en ${ctx.projectId}.\n`);
    process.exit(1);
  }

  const d = snap.val() as { persona: string; nombre: string };
  await refRtdb.remove();
  await db.doc(`parejas/${PAREJA_ID}/dispositivos/${aRevocar}`).delete();

  console.log(`\n✔ Revocado: ${d.nombre} (persona ${d.persona}) · uid ${aRevocar}`);
  console.log('  Ese aparato ya no pasa ninguna regla. El efecto es inmediato.');
  console.log('  Para volver a usarlo, basta con escribir el código otra vez.\n');
  process.exit(0);
}

// ── Inventario ──────────────────────────────────────────────────────────────
const snap = await rtdb.ref(`salas/${PAREJA_ID}/dispositivos`).get();
const dispositivos = (snap.val() ?? {}) as Record<
  string,
  { persona: string; nombre: string; vinculadoEn?: number }
>;

const entradas = Object.entries(dispositivos);
console.log(`\nDISPOSITIVOS VINCULADOS · ${ctx.projectId} · espacio ${PAREJA_ID}`);
console.log('─'.repeat(74));

if (entradas.length === 0) {
  console.log('(ninguno todavía)\n');
} else {
  for (const [uid, d] of entradas.sort((x, y) => x[1].persona.localeCompare(y[1].persona))) {
    console.log(`  persona ${d.persona}  ·  ${String(d.nombre).padEnd(20)}`);
    console.log(`     uid ......... ${uid}`);
    console.log(`     vinculado ... ${fecha(d.vinculadoEn)}`);
    console.log(`     revocar ..... npm run dispositivos -- --entorno=${ctx.entorno} --revocar=${uid}\n`);
  }
}

console.log(`Total: ${entradas.length}\n`);
process.exit(0);
