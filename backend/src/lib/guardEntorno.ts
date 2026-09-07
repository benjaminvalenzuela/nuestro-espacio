/**
 * guardEntorno.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Portero de TODO script del Admin SDK.
 *
 * El Admin SDK OMITE por completo las Security Rules: es una credencial de
 * superusuario. El accidente más caro de este proyecto no sería un ataque,
 * sino ejecutar `npm run seed` apuntando a PROD por descuido.
 *
 * Por eso: el entorno se declara SIEMPRE de forma explícita, nunca se infiere,
 * y apuntar a producción exige teclear el nombre del proyecto a mano.
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export type Entorno = 'desa' | 'qa' | 'prod';

const RAIZ_BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const PROYECTOS: Record<Entorno, string> = {
  desa: 'demo-nuestro-espacio',   // el prefijo demo- fuerza modo emulador
  qa: 'nuestro-espacio-qa',
  prod: 'nuestro-espacio-prod',
};

export interface ContextoEjecucion {
  entorno: Entorno;
  projectId: string;
  esProduccion: boolean;
  usaEmuladores: boolean;
}

function leerArg(nombre: string): string | undefined {
  const prefijo = `--${nombre}=`;
  return process.argv.find((a) => a.startsWith(prefijo))?.slice(prefijo.length);
}

function tieneFlag(nombre: string): boolean {
  return process.argv.includes(`--${nombre}`);
}

/**
 * Resuelve el entorno, carga su .env y —si es PROD— exige confirmación humana.
 * Devuelve el contexto o termina el proceso.
 */
export async function resolverEntorno(): Promise<ContextoEjecucion> {
  const crudo = leerArg('entorno');

  if (!crudo) {
    console.error(
      '\n✖ Falta --entorno. Es obligatorio y no tiene valor por defecto a propósito.\n' +
        '  Uso:  npm run <script> -- --entorno=desa|qa|prod\n',
    );
    process.exit(1);
  }

  if (!(crudo in PROYECTOS)) {
    console.error(`\n✖ Entorno inválido: "${crudo}". Válidos: desa | qa | prod\n`);
    process.exit(1);
  }

  const entorno = crudo as Entorno;
  const projectId = PROYECTOS[entorno];
  const usaEmuladores = entorno === 'desa';

  // Carga la configuración de ESE entorno y de ningún otro.
  const rutaEnv = resolve(RAIZ_BACKEND, `.env.${entorno}`);
  if (existsSync(rutaEnv)) {
    dotenv.config({ path: rutaEnv });
  } else if (!usaEmuladores) {
    console.error(
      `\n✖ No existe ${rutaEnv}\n` +
        '  Copia backend/.env.example y complétalo. Recuerda: NUNCA se versiona.\n',
    );
    process.exit(1);
  }

  if (usaEmuladores) {
    // Estas variables hacen que el Admin SDK hable con los emuladores locales
    // en lugar de con la nube. Sin ellas, un script de "desa" tocaría datos reales.
    process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
    process.env.FIREBASE_DATABASE_EMULATOR_HOST ??= '127.0.0.1:9000';
  }

  const banner =
    entorno === 'prod'
      ? '\x1b[41m\x1b[97m'  // fondo rojo: imposible no verlo
      : entorno === 'qa'
        ? '\x1b[43m\x1b[30m'
        : '\x1b[42m\x1b[30m';

  console.log(
    `\n${banner}  ENTORNO: ${entorno.toUpperCase()}  ·  proyecto: ${projectId}  ` +
      `${usaEmuladores ? '· EMULADORES LOCALES ' : ''} \x1b[0m\n`,
  );

  if (entorno === 'prod') {
    // --si-estoy-seguro solo se acepta en CI, donde no hay teclado.
    const bypassCI = tieneFlag('si-estoy-seguro') && process.env.CI === 'true';

    if (!bypassCI) {
      const rl = createInterface({ input: stdin, output: stdout });
      const respuesta = await rl.question(
        `⚠  Vas a escribir en PRODUCCIÓN con datos reales.\n` +
          `   Escribe el id del proyecto para continuar (${projectId}): `,
      );
      rl.close();

      if (respuesta.trim() !== projectId) {
        console.error('\n✖ Confirmación incorrecta. Operación abortada. No se tocó nada.\n');
        process.exit(1);
      }
    }
  }

  return { entorno, projectId, esProduccion: entorno === 'prod', usaEmuladores };
}
