/**
 * dispositivos.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Inventario y revocación de dispositivos vinculados.
 *
 *   npm run dispositivos -- --entorno=prod
 *   npm run dispositivos -- --entorno=prod --revocar=<uid>
 *   npm run dispositivos -- --entorno=qa --huerfanos [--purgar]
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
const { db, rtdb, auth } = crearAdmin(ctx);

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

/**
 * ── Cuentas anónimas huérfanas ─────────────────────────────────────────────
 *
 * Cada vez que alguien abre la app se crea una cuenta anónima ANTES de saber
 * si escribirá un código válido. Los intentos fallidos, las pruebas y los
 * navegadores que se cerraron a medias dejan cuentas sin vincular a ningún
 * dispositivo: no pueden leer ni escribir nada —las reglas exigen que el
 * vínculo exista—, pero se acumulan en Authentication.
 *
 * NO se activa la "limpieza automática" de Firebase para esto: esa opción
 * borra por antigüedad sin mirar el vínculo, y se llevaría por delante los
 * dispositivos legítimos, que están pensados justamente para durar años.
 *
 * Guarda deliberada: solo se purgan cuentas de más de 24 horas. Una recién
 * creada puede ser la de alguien que está tecleando su código ahora mismo.
 */
const HORAS_DE_GRACIA = 24;

if (process.argv.includes('--huerfanos')) {
  const purgar = process.argv.includes('--purgar');
  const vinculados = new Set(
    Object.keys((await rtdb.ref(`salas/${PAREJA_ID}/dispositivos`).get()).val() ?? {}),
  );

  const limite = Date.now() - HORAS_DE_GRACIA * 60 * 60 * 1000;
  const huerfanas: { uid: string; creada: number }[] = [];
  let total = 0;
  let recientes = 0;

  let pagina = await auth.listUsers(1000);
  for (;;) {
    for (const u of pagina.users) {
      total++;
      if (vinculados.has(u.uid)) continue;
      const creada = Date.parse(u.metadata.creationTime);
      if (creada > limite) { recientes++; continue; }
      huerfanas.push({ uid: u.uid, creada });
    }
    if (!pagina.pageToken) break;
    pagina = await auth.listUsers(1000, pagina.pageToken);
  }

  console.log(`\nCUENTAS EN AUTHENTICATION · ${ctx.projectId}`);
  console.log('─'.repeat(74));
  console.log(`  total ................. ${total}`);
  console.log(`  vinculadas ............ ${vinculados.size}`);
  console.log(`  huérfanas recientes ... ${recientes}  (menos de ${HORAS_DE_GRACIA} h, intactas)`);
  console.log(`  huérfanas purgables ... ${huerfanas.length}\n`);

  for (const h of huerfanas) console.log(`  ${h.uid}  creada ${fecha(h.creada)}`);

  if (!purgar) {
    console.log(
      huerfanas.length
        ? `\nPara borrarlas: añade --purgar al comando.\n`
        : '\nNada que limpiar.\n',
    );
    process.exit(0);
  }

  if (huerfanas.length === 0) { console.log('Nada que borrar.\n'); process.exit(0); }

  // deleteUsers acepta hasta 1000 uid por llamada.
  const r = await auth.deleteUsers(huerfanas.map((h) => h.uid));
  console.log(`\n✔ Borradas ${r.successCount}, fallidas ${r.failureCount}.`);
  for (const e of r.errors) console.log(`  ✖ índice ${e.index}: ${e.error.message}`);
  console.log('  Ningún dispositivo vinculado fue tocado.\n');
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
