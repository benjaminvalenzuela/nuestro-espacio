import { initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from 'firebase/app-check';
import type { FirebaseApp } from 'firebase/app';
import { ENV, ES_DESA } from '../../config/env';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  APP CHECK
 *
 *  Verifica que la petición viene de TU página web y no de un `curl`, un script
 *  o un bot. Se comprueba ANTES de evaluar las Security Rules.
 *
 *  Qué NO hace: no sustituye a las reglas. Filtra el ruido para que las reglas
 *  se enfrenten solo a clientes reales. Las dos capas hacen falta.
 *
 *  Por qué importa especialmente aquí: con Anonymous Auth, crear una cuenta es
 *  gratis y automático — no se puede desactivar el registro, porque eso mismo
 *  impediría entrar a la app. App Check es lo que hace caro intentar fuerza
 *  bruta contra los códigos de vinculación desde fuera del navegador.
 *
 *  Sin clave configurada (DESA, o QA antes de terminar el alta) simplemente no
 *  se activa. Es opcional a propósito: así el arranque local no depende de nada.
 * ─────────────────────────────────────────────────────────────────────────────
 */

let appCheck: AppCheck | undefined;

export function iniciarAppCheck(app: FirebaseApp): void {
  if (appCheck || ES_DESA) return;

  const clave = ENV.PUBLIC_RECAPTCHA_SITE_KEY;
  if (!clave) {
    // No es un error: es el estado normal mientras App Check no esté dado de
    // alta. Se avisa para que no pase inadvertido en producción.
    if (ENV.PUBLIC_ENTORNO === 'prod') {
      console.warn('[appcheck] sin PUBLIC_RECAPTCHA_SITE_KEY: App Check desactivado en producción.');
    }
    return;
  }

  try {
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(clave),
      // Renueva el token solo, sin que el usuario note nada.
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    // Si App Check falla al arrancar, la app debe seguir funcionando: las
    // Security Rules siguen protegiendo los datos igualmente.
    console.warn('[appcheck] no se pudo inicializar:', (e as Error)?.message);
  }
}
