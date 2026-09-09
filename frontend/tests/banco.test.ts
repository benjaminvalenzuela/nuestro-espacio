import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  EL BANCO DE PREGUNTAS Y DILEMAS, VALIDADO ANTES DE SEMBRARLO
 *
 *  El seed ya valida cada registro con Zod y aborta si algo está mal. El
 *  problema es CUÁNDO se entera uno: al desplegar contenido, con el script a
 *  medias y contra un proyecto real. Aquí se entera en dos segundos.
 *
 *  El caso que de verdad importa es el id repetido. Un id duplicado entre dos
 *  archivos no rompe nada visible: el segundo simplemente pisa al primero en
 *  Firestore, y una pregunta desaparece del banco sin que nadie lo note hasta
 *  contarlas a mano.
 *
 *  Se leen los archivos del backend a propósito: el banco es uno solo, y
 *  duplicarlo para tenerlo "cerca del test" sería crear la segunda copia que
 *  este test existe para evitar.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const BANCO = resolve(import.meta.dirname, '../../backend/data/banco');

interface Fila {
  id?: unknown;
  texto?: unknown;
  opcionA?: unknown;
  opcionB?: unknown;
  nivel?: unknown;
}

const archivos = readdirSync(BANCO).filter((f) => f.endsWith('.json'));

function leer(archivo: string): Fila[] {
  return JSON.parse(readFileSync(join(BANCO, archivo), 'utf8')) as Fila[];
}

describe('Banco de contenido', () => {
  it('hay archivos que leer', () => {
    expect(archivos.length).toBeGreaterThan(10);
  });

  it('ningún id se repite en todo el banco', () => {
    const donde = new Map<string, string>();
    const choques: string[] = [];

    for (const archivo of archivos) {
      for (const fila of leer(archivo)) {
        const id = String(fila.id);
        const previo = donde.get(id);
        if (previo) choques.push(`${id}: ${previo} y ${archivo}`);
        else donde.set(id, archivo);
      }
    }

    expect(choques).toEqual([]);
  });

  it('los ids tienen la forma que aceptan las reglas', () => {
    for (const archivo of archivos) {
      for (const fila of leer(archivo)) {
        expect(String(fila.id), archivo).toMatch(/^[a-z0-9_-]{3,60}$/);
      }
    }
  });

  /**
   * Los mismos límites que firestore.rules. Si un texto se pasa de largo, las
   * reglas rechazan la escritura y el registro no llega — pero el seed lo
   * habría dado por bueno si el schema del seed y el de las reglas se
   * separaran algún día.
   */
  it('los textos respetan longitudes y no llevan < ni >', () => {
    for (const archivo of archivos) {
      const esDilema = archivo.startsWith('dilemas');
      for (const fila of leer(archivo)) {
        const partes = esDilema
          ? [{ v: fila.opcionA, min: 2, max: 120 }, { v: fila.opcionB, min: 2, max: 120 }]
          : [{ v: fila.texto, min: 8, max: 300 }];

        for (const { v, min, max } of partes) {
          expect(typeof v, `${archivo} · ${fila.id}`).toBe('string');
          const s = String(v).trim();
          expect(s.length, `${archivo} · ${fila.id}: "${s}"`).toBeGreaterThanOrEqual(min);
          expect(s.length, `${archivo} · ${fila.id}: "${s}"`).toBeLessThanOrEqual(max);
          expect(s, `${archivo} · ${fila.id}`).not.toMatch(/[<>]/);
        }
      }
    }
  });

  it('ningún dilema ofrece dos veces la misma opción', () => {
    for (const archivo of archivos.filter((f) => f.startsWith('dilemas'))) {
      for (const fila of leer(archivo)) {
        expect(fila.opcionA, `${archivo} · ${fila.id}`).not.toBe(fila.opcionB);
      }
    }
  });

  it('los niveles declarados son 1, 2 o 3', () => {
    for (const archivo of archivos) {
      for (const fila of leer(archivo)) {
        if (fila.nivel === undefined) continue;   // hereda el del archivo
        expect([1, 2, 3], `${archivo} · ${fila.id}`).toContain(fila.nivel);
      }
    }
  });

  /**
   * Un texto repetido palabra por palabra no rompe la app, pero sí la
   * experiencia: sale la "misma" carta dos veces con distinto id y parece que
   * el juego se atascó.
   */
  it('no hay preguntas repetidas literalmente', () => {
    const vistos = new Map<string, string>();
    const repetidos: string[] = [];

    for (const archivo of archivos.filter((f) => !f.startsWith('dilemas'))) {
      for (const fila of leer(archivo)) {
        const clave = String(fila.texto).trim().toLowerCase();
        const previo = vistos.get(clave);
        if (previo) repetidos.push(`"${clave}" (${previo} y ${archivo})`);
        else vistos.set(clave, archivo);
      }
    }

    expect(repetidos).toEqual([]);
  });

  it('no hay dilemas repetidos literalmente', () => {
    const vistos = new Map<string, string>();
    const repetidos: string[] = [];

    for (const archivo of archivos.filter((f) => f.startsWith('dilemas'))) {
      for (const fila of leer(archivo)) {
        const clave = `${String(fila.opcionA).trim().toLowerCase()}|${String(fila.opcionB).trim().toLowerCase()}`;
        const previo = vistos.get(clave);
        if (previo) repetidos.push(`${clave} (${previo} y ${archivo})`);
        else vistos.set(clave, archivo);
      }
    }

    expect(repetidos).toEqual([]);
  });
});
