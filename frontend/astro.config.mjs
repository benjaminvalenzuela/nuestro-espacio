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

    /**
     * NUNCA incrustar scripts dentro del HTML.
     *
     * Astro, por defecto, mete los scripts de página pequeños directamente en
     * el <head> como <script type="module"> sin src. Es más rápido —se ahorra
     * una petición— y aquí es inservible: la Content Security Policy declara
     * `script-src 'self'` sin 'unsafe-inline', así que el navegador los
     * bloquea.
     *
     * El fallo es especialmente traicionero porque depende del TAMAÑO del
     * script: una pantalla con mucho código funciona y otra con poco no, y en
     * desarrollo no se nota porque ahí la CSP ni se emite. Se descubrió con el
     * botón del tema, que por ser corto acabó incrustado y no hacía nada en la
     * versión desplegada.
     */
    inlineStylesheets: 'never',
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      // Mismo motivo que inlineStylesheets: 0 desactiva por completo que Vite
      // convierta un asset pequeño en un data: URI o en contenido incrustado.
      assetsInlineLimit: 0,
    },
    resolve: {
      alias: {
        '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
      },
    },
  },
});
