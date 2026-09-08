/**
 * Compara los vínculos de dispositivo entre RTDB y Firestore.
 *
 * Existe porque las Security Rules de Firestore comprueban la pertenencia con
 * exists(parejas/{id}/dispositivos/{uid}) mientras que las de RTDB miran su
 * propio nodo. Son dos copias del mismo hecho, y si una se escribe y la otra
 * no, el aparato entra en media aplicación: la ruleta funciona y los perfiles
 * dan permission-denied, que es exactamente el tipo de fallo que cuesta horas
 * localizar sin una herramienta que los ponga lado a lado.
 */
import { resolverEntorno } from '../src/lib/guardEntorno.js';
import { crearAdmin } from '../src/lib/adminApp.js';

const ctx = await resolverEntorno();
const { db, rtdb } = crearAdmin(ctx);
const PAREJA_ID = process.env.PAREJA_ID ?? 'pareja_principal';

const enRtdb = Object.keys((await rtdb.ref(`salas/${PAREJA_ID}/dispositivos`).get()).val() ?? {});
const enFs = (await db.collection(`parejas/${PAREJA_ID}/dispositivos`).get()).docs.map((d) => d.id);

console.log(`\nVÍNCULOS · ${ctx.projectId}`);
console.log('─'.repeat(70));
console.log(`  en RTDB ....... ${enRtdb.length}`);
console.log(`  en Firestore .. ${enFs.length}\n`);

const soloRtdb = enRtdb.filter((u) => !enFs.includes(u));
const soloFs = enFs.filter((u) => !enRtdb.includes(u));

for (const u of enRtdb.filter((u) => enFs.includes(u))) console.log(`  ✔ ${u}  (en ambas)`);
for (const u of soloRtdb) console.log(`  ✖ ${u}  SOLO en RTDB — Firestore le negará todo`);
for (const u of soloFs) console.log(`  ✖ ${u}  SOLO en Firestore — RTDB le negará todo`);

console.log(
  soloRtdb.length + soloFs.length === 0
    ? '\n✔ Las dos copias coinciden.\n'
    : `\n✖ ${soloRtdb.length + soloFs.length} vínculo(s) descuadrado(s).\n`,
);
process.exit(0);
