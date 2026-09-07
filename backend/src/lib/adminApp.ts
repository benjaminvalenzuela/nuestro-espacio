/**
 * adminApp.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Inicializa el Firebase Admin SDK.
 *
 * CREDENCIAL: se resuelve en este orden y NUNCA se escribe en disco ni en logs.
 *   1. FIREBASE_SERVICE_ACCOUNT  -> JSON completo en una variable (GitHub Actions)
 *   2. GOOGLE_APPLICATION_CREDENTIALS -> ruta a un .json local (backend/secrets/*)
 *   3. Emuladores -> no requieren credencial real
 *
 * Un Service Account puede leer y borrar TODO, ignorando las Security Rules.
 * Trátalo como la llave maestra del sistema: es exactamente eso.
 */

import { readFileSync } from 'node:fs';
import { initializeApp, cert, applicationDefault, getApps, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getDatabase, type Database } from 'firebase-admin/database';
import type { ContextoEjecucion } from './guardEntorno.js';

export interface ServiciosAdmin {
  app: App;
  auth: Auth;
  db: Firestore;
  rtdb: Database;
  ctx: ContextoEjecucion;
}

function resolverCredencial(ctx: ContextoEjecucion) {
  if (ctx.usaEmuladores) {
    // Los emuladores aceptan cualquier credencial: no hay secreto que exponer.
    return applicationDefault();
  }

  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inline) {
    try {
      return cert(JSON.parse(inline));
    } catch {
      // Nunca imprimir el contenido: podría acabar en los logs de CI.
      throw new Error('FIREBASE_SERVICE_ACCOUNT no contiene un JSON válido.');
    }
  }

  const ruta = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (ruta) {
    return cert(JSON.parse(readFileSync(ruta, 'utf8')));
  }

  throw new Error(
    'Sin credencial. Define FIREBASE_SERVICE_ACCOUNT (CI) o ' +
      'GOOGLE_APPLICATION_CREDENTIALS (local, apuntando a backend/secrets/).',
  );
}

export function crearAdmin(ctx: ContextoEjecucion): ServiciosAdmin {
  const databaseURL =
    process.env.FIREBASE_DATABASE_URL ??
    `https://${ctx.projectId}-default-rtdb.firebaseio.com`;

  const app =
    getApps()[0] ??
    initializeApp({
      credential: resolverCredencial(ctx),
      projectId: ctx.projectId,
      databaseURL,
    });

  return {
    app,
    auth: getAuth(app),
    db: getFirestore(app),
    rtdb: getDatabase(app),
    ctx,
  };
}
