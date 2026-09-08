import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  PRUEBAS SOBRE EL SITIO YA COMPILADO
 *
 *  Los demás tests miran funciones sueltas. Estos miran el HTML que de verdad
 *  se sube, porque hay una clase de fallo que solo existe ahí: el compilador
 *  toma decisiones —incrustar un script, mover un asset— que ningún test de
 *  unidad ve y que la Content Security Policy sí castiga.
 *
 *  Se saltan si no hay build. No tiene sentido obligar a compilar para correr
 *  los tests de dominio, pero en CI el build ocurre antes y estos sí corren.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const DIST = resolve(import.meta.dirname, '../dist');
const hayBuild = existsSync(DIST);

function htmlsDe(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...htmlsDe(ruta));
    else if (entrada.endsWith('.html')) salida.push(ruta);
  }
  return salida;
}

describe.skipIf(!hayBuild)('El sitio compilado respeta la CSP', () => {
  const paginas = hayBuild ? htmlsDe(DIST) : [];

  it('compila varias páginas', () => {
    expect(paginas.length).toBeGreaterThan(5);
  });

  /**
   * EL FALLO QUE ESTE TEST EXISTE PARA IMPEDIR.
   *
   * Astro incrusta en el HTML los scripts de página que le parecen pequeños.
   * Con `script-src 'self'` y sin 'unsafe-inline', el navegador los bloquea y
   * la funcionalidad desaparece sin ningún error en desarrollo, donde la CSP
   * ni siquiera se emite.
   *
   * Lo peor es que depende del TAMAÑO: una pantalla con mucho código funciona
   * y otra con poco no. Apareció con el botón del tema, que por ser corto
   * quedó incrustado y no hacía nada en la versión desplegada.
   */
  it('ninguna página incrusta scripts en el HTML', () => {
    const sinSrc = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

    for (const pagina of paginas) {
      const html = readFileSync(pagina, 'utf8');
      const encontrados = [...html.matchAll(sinSrc)]
        .map((m) => m[1]?.trim() ?? '')
        .filter((cuerpo) => cuerpo.length > 0);

      expect(encontrados, `${pagina} incrusta ${encontrados.length} script(s)`).toEqual([]);
    }
  });

  it('todos los scripts salen del propio sitio', () => {
    const conSrc = /<script[^>]*\bsrc="([^"]+)"/g;

    for (const pagina of paginas) {
      const html = readFileSync(pagina, 'utf8');
      for (const m of html.matchAll(conSrc)) {
        const src = m[1] ?? '';
        // 'self' cubre las rutas relativas y absolutas del propio dominio.
        expect(src.startsWith('http'), `${pagina} carga ${src}`).toBe(false);
      }
    }
  });

  it('el script del tema se carga desde un archivo, no incrustado', () => {
    // Si volviera a ser inline, el tema no se aplicaría en producción y la
    // app daría un fogonazo blanco al abrirla de noche.
    const inicio = paginas.find((p) => p.endsWith(join('inicio', 'index.html')));
    expect(inicio).toBeDefined();
    expect(readFileSync(inicio!, 'utf8')).toContain('tema.js');
  });
});
