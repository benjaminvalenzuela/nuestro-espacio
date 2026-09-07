import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  ENTORNO DE PRUEBAS DE SECURITY RULES
 *
 *  Estos tests cargan los MISMOS archivos de reglas que se despliegan a QA y a
 *  producción, y los ejecutan contra los emuladores. No prueban la app: prueban
 *  el servidor. Es la única forma de saber que una regla hace lo que dice.
 *
 *  Se usa un projectId propio para no tocar los datos de desarrollo.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const AQUI = dirname(fileURLToPath(import.meta.url));

export const PAREJA = 'pareja_test';
export const UID_A1 = 'uid-a-computador';
export const UID_A2 = 'uid-a-celular';
export const UID_B1 = 'uid-b-celular';
export const UID_INTRUSO = 'uid-desconocido';

export const CODIGO_A = 'A-K3F9-2XQ7-M8T4';
export const CODIGO_B = 'B-M8T4-9WZ2-K3F9';

/** El CLI de Firebase admite comentarios en database.rules.json; el parser de
 *  los tests no. Se quitan antes de cargarlas. */
function reglasRtdb(): string {
  const crudo = readFileSync(resolve(AQUI, '../database.rules.json'), 'utf8');
  return crudo
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
}

export async function crearEntorno(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: 'demo-reglas-test',
    firestore: {
      rules: readFileSync(resolve(AQUI, '../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
    database: {
      rules: reglasRtdb(),
      host: '127.0.0.1',
      port: 9000,
    },
  });
}

/**
 * Deja el espacio en su estado normal: códigos publicados, y los dispositivos
 * de A (dos aparatos) y de B (uno) ya vinculados. Se escribe con las reglas
 * desactivadas porque es lo que haría el Admin SDK, que las omite.
 */
export async function sembrar(env: RulesTestEnvironment): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('config/app').set({ parejaId: PAREJA });
    await db.doc(`parejas/${PAREJA}/secretos/asientos`).set({ a: CODIGO_A, b: CODIGO_B });

    for (const [uid, persona] of [
      [UID_A1, 'a'],
      [UID_A2, 'a'],
      [UID_B1, 'b'],
    ] as const) {
      await db.doc(`parejas/${PAREJA}/dispositivos/${uid}`).set({
        persona, nombre: persona === 'a' ? 'Ana' : 'Beto',
        codigo: persona === 'a' ? CODIGO_A : CODIGO_B,
        vinculadoEn: new Date(),
      });
    }

    await db.doc(`parejas/${PAREJA}/panoramas/pan1`).set({
      nombre: 'Ir al cerro', nombreNormalizado: 'ir al cerro',
      creadoPor: 'a', creadoEn: new Date(), activo: true, peso: 1,
      vecesRealizado: 0, ultimaVezEn: null,
    });

    await db.doc(`parejas/${PAREJA}/organizadores/a`).set({ vecesOrganizado: 0, ultimaVezEn: null });
    await db.doc(`parejas/${PAREJA}/organizadores/b`).set({ vecesOrganizado: 0, ultimaVezEn: null });

    const rtdb = ctx.database();
    await rtdb.ref(`salas/${PAREJA}/asientos`).set({
      a: { codigo: CODIGO_A }, b: { codigo: CODIGO_B },
    });
    for (const [uid, persona] of [[UID_A1, 'a'], [UID_A2, 'a'], [UID_B1, 'b']] as const) {
      await rtdb.ref(`salas/${PAREJA}/dispositivos/${uid}`).set({
        persona, nombre: persona === 'a' ? 'Ana' : 'Beto',
        codigo: persona === 'a' ? CODIGO_A : CODIGO_B,
        vinculadoEn: Date.now(),
      });
    }
  });
}
