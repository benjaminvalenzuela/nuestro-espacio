import { z } from 'zod';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  CONFIGURACIÓN DE ENTORNO — validada, no confiada.
 *
 *  Si falta una variable, quiero que la compilación falle AHORA con un mensaje
 *  claro, no que la app despliegue y muera en el navegador con un
 *  "auth/invalid-api-key" a las once de la noche.
 *
 *  En DESA no hace falta ningún .env: los valores demo van cableados abajo.
 *  No son secretos — el prefijo `demo-` es lo que hace que los emuladores
 *  rechacen conectarse a la nube. Es una salvaguarda, no un descuido.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CONFIG_DEMO = {
  PUBLIC_ENTORNO: 'desa',
  PUBLIC_FIREBASE_API_KEY: 'demo-api-key',
  PUBLIC_FIREBASE_AUTH_DOMAIN: 'demo-nuestro-espacio.firebaseapp.com',
  PUBLIC_FIREBASE_PROJECT_ID: 'demo-nuestro-espacio',
  PUBLIC_FIREBASE_APP_ID: '1:000000000000:web:demo',
  PUBLIC_FIREBASE_DATABASE_URL: 'https://demo-nuestro-espacio-default-rtdb.firebaseio.com',
  PUBLIC_PAREJA_ID: 'pareja_principal',
} as const;

const EsquemaEntorno = z.object({
  PUBLIC_ENTORNO: z.enum(['desa', 'qa', 'prod']),
  PUBLIC_FIREBASE_API_KEY: z.string().min(1),
  PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1),
  PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1),
  PUBLIC_FIREBASE_APP_ID: z.string().min(1),
  PUBLIC_FIREBASE_DATABASE_URL: z.url(),
  PUBLIC_PAREJA_ID: z.string().min(1),
  /** Solo en QA/PROD. En DESA App Check no interviene. */
  PUBLIC_RECAPTCHA_SITE_KEY: z.string().optional(),
});

const crudo = {
  PUBLIC_ENTORNO: import.meta.env.PUBLIC_ENTORNO ?? CONFIG_DEMO.PUBLIC_ENTORNO,
  PUBLIC_FIREBASE_API_KEY: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  PUBLIC_FIREBASE_AUTH_DOMAIN: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  PUBLIC_FIREBASE_PROJECT_ID: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  PUBLIC_FIREBASE_APP_ID: import.meta.env.PUBLIC_FIREBASE_APP_ID,
  PUBLIC_FIREBASE_DATABASE_URL: import.meta.env.PUBLIC_FIREBASE_DATABASE_URL,
  PUBLIC_PAREJA_ID: import.meta.env.PUBLIC_PAREJA_ID,
  PUBLIC_RECAPTCHA_SITE_KEY: import.meta.env.PUBLIC_RECAPTCHA_SITE_KEY,
};

// En DESA se rellenan los huecos con los valores demo; en QA/PROD nunca.
const conDefectos =
  crudo.PUBLIC_ENTORNO === 'desa'
    ? { ...CONFIG_DEMO, ...Object.fromEntries(Object.entries(crudo).filter(([, v]) => v != null)) }
    : crudo;

const resultado = EsquemaEntorno.safeParse(conDefectos);

if (!resultado.success) {
  const faltantes = resultado.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`);
  throw new Error(
    `Configuración de entorno inválida (PUBLIC_ENTORNO=${crudo.PUBLIC_ENTORNO}):\n` +
      faltantes.join('\n') +
      '\n\nRevisa las variables PUBLIC_* del pipeline o copia frontend/.env.example a frontend/.env',
  );
}

export const ENV = resultado.data;

export const ES_DESA = ENV.PUBLIC_ENTORNO === 'desa';
export const ES_PROD = ENV.PUBLIC_ENTORNO === 'prod';

/** Puertos de los emuladores. Deben coincidir con firebase.json. */
export const EMULADORES = {
  host: '127.0.0.1',
  auth: 9099,
  firestore: 8080,
  rtdb: 9000,
} as const;

/**
 * Construye una URL respetando el `base` del despliegue.
 * En PROD la app vive en /nuestro-espacio/, así que un href="/inicio" cableado
 * llevaría a la raíz del dominio y daría 404. Usar siempre esta función.
 */
export function ruta(destino: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/${destino.replace(/^\//, '')}`;
}
