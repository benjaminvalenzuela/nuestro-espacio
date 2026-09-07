// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  CONFIGURACIÓN MULTI-ENTORNO
 *
 *  GitHub Pages sirve el sitio bajo una subruta, y esa subruta CAMBIA según el
 *  entorno. Astro necesita saberla en tiempo de compilación para reescribir
 *  todos los enlaces y las rutas de los assets:
 *
 *    DESA  http://localhost:4321/                        → base '/'
 *    QA    .../nuestro-espacio/qa/                       → base '/nuestro-espacio/qa/'
 *    PROD  .../nuestro-espacio/                          → base '/nuestro-espacio/'
 *
 *  El pipeline de CI define PUBLIC_BASE_PATH antes de compilar. En local no
 *  hace falta nada: el valor por defecto es '/'.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const base = process.env.PUBLIC_BASE_PATH || '/';
const site = process.env.PUBLIC_SITE_URL || 'http://localhost:4321';

export default defineConfig({
  site,
  base,
  output: 'static',           // GitHub Pages solo sirve archivos estáticos
  trailingSlash: 'ignore',
  build: {
    // Cada asset lleva un hash en el nombre: los despliegues sucesivos no
    // pueden servir una versión cacheada mezclada con otra.
    assets: '_astro',
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
      },
    },
  },
});
