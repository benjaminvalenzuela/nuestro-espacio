/**
 * inspeccionar-presencia.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Herramienta de diagnóstico: muestra el nodo de presencia tal cual está en la
 * base de datos, sin pasar por la UI.
 *
 * Sirve para comprobar lo que no se puede ver desde el navegador: qué queda
 * grabado cuando el ÚLTIMO dispositivo de alguien se desconecta. Si el cliente
 * mintiera sobre la hora, aquí se vería.
 *
 *   npm --workspace backend run presencia -- --entorno=desa
 */

import { resolverEntorno } from '../src/lib/guardEntorno.js';
import { crearAdmin } from '../src/lib/adminApp.js';

const ctx = await resolverEntorno();
const { rtdb } = crearAdmin(ctx);

const PAREJA_ID = process.env.PAREJA_ID ?? 'pareja_principal';

const fmt = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago',
  dateStyle: 'full',
  timeStyle: 'medium',
});

const snap = await rtdb.ref(`salas/${PAREJA_ID}/presencia`).get();
const presencia = (snap.val() ?? {}) as Record<
  string,
  { estado?: string; ultimaConexion?: number; conexiones?: Record<string, unknown> }
>;

console.log(`\nPRESENCIA · ${ctx.projectId} · espacio ${PAREJA_ID}`);
console.log('─'.repeat(70));

for (const persona of ['a', 'b']) {
  const p = presencia[persona];
  if (!p) {
    console.log(`  persona ${persona}:  (sin registro)\n`);
    continue;
  }

  const vivas = p.conexiones ? Object.keys(p.conexiones).length : 0;

  console.log(`  persona ${persona}`);
  console.log(`     campo 'estado' ..... ${p.estado ?? '—'}`);
  console.log(`     conexiones vivas ... ${vivas}   ← de aquí DERIVA la UI si está en línea`);
  console.log(`     ultimaConexion ..... ${p.ultimaConexion ?? '—'}`);
  console.log(`                          ${p.ultimaConexion ? fmt.format(p.ultimaConexion) : ''}`);
  console.log(`     desfase con reloj ... ${p.ultimaConexion ? `${Date.now() - p.ultimaConexion} ms` : '—'}`);
  console.log('');
}

console.log(JSON.stringify(presencia, null, 2));
process.exit(0);
