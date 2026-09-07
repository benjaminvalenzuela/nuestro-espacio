/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  ADAPTADOR FIREBASE · núcleo (app + auth)
 *
 *  Frontera de la arquitectura desacoplada: la capa de dominio habla con estos
 *  módulos, nunca con `firebase/*` directamente. Cambiar de proveedor sería
 *  reescribir esta carpeta y nada más.
 *
 *  ⚠ POR QUÉ ESTE ARCHIVO SOLO TRAE Auth:
 *  Importar aquí también Firestore y RTDB metía los tres SDK en un único chunk
 *  de 668 KB que descargaba hasta la pantalla de login. Cada servicio vive en
 *  su propio módulo (./rtdb, ./firestore) para que el empaquetador solo incluya
 *  lo que cada página usa de verdad. En una app mobile-first eso no es un
 *  detalle: es la diferencia entre abrir rápido o no.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { ENV, ES_DESA, EMULADORES } from '../../config/env';
import { iniciarAppCheck } from './appcheck';

let app: FirebaseApp | undefined;
let auth: Auth | undefined;

export function obtenerApp(): FirebaseApp {
  if (app) return app;
  app =
    getApps()[0] ??
    initializeApp({
      apiKey: ENV.PUBLIC_FIREBASE_API_KEY,
      authDomain: ENV.PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: ENV.PUBLIC_FIREBASE_PROJECT_ID,
      appId: ENV.PUBLIC_FIREBASE_APP_ID,
      databaseURL: ENV.PUBLIC_FIREBASE_DATABASE_URL,
    });

  // App Check debe inicializarse justo tras la app y ANTES de usar cualquier
  // servicio: si no, las primeras peticiones saldrían sin token.
  iniciarAppCheck(app);

  return app;
}

export function obtenerAuth(): Auth {
  if (auth) return auth;
  auth = getAuth(obtenerApp());
  if (ES_DESA) {
    // disableWarnings: el emulador avisa en cada carga por consola; ya lo sabemos.
    connectAuthEmulator(auth, `http://${EMULADORES.host}:${EMULADORES.auth}`, {
      disableWarnings: true,
    });
  }
  return auth;
}

/**
 * El espacio de esta pareja. Se fija en compilación por comodidad; quien manda
 * de verdad es el claim `parejaId` del token, que sí verifica el servidor.
 */
export const PAREJA_ID = ENV.PUBLIC_PAREJA_ID;
