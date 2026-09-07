import { describe, it, expect } from 'vitest';
import {
  crearRng, elegirIndice, anguloFinal, suavizado, estadoEn,
} from '../src/domain/ruleta/animacionGiro';
import { elegirPregunta, type Pregunta } from '../src/domain/preguntas/preguntasService';
import { formatearUltimaConexion, formatearCompleto } from '../src/domain/presencia/formatoFecha';
import { parsearCodigo, formatearCodigo, normalizarCodigo, generarCuerpo, ALFABETO_CODIGO, LARGO_CUERPO } from '@shared/schemas/codigo';
import { derivarPresencia } from '@shared/schemas/presencia.schema';
import { normalizarNombre } from '@shared/panoramas';
import { POLITICA_CSP } from '../src/config/csp';
import type { Giro } from '@shared/schemas/giro.schema';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  TESTS DEL DOMINIO
 *
 *  Todo lo que se prueba aquí son funciones PURAS: sin Firebase, sin DOM, sin
 *  red. Es el pago de haber mantenido la capa de dominio desacoplada — estos
 *  tests corren en milisegundos y no necesitan emuladores.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const giroDe = (over: Partial<Giro> = {}): Giro => ({
  id: 'giro-de-prueba',
  estado: 'girando',
  iniciadoPor: 'a',
  semilla: 123456,
  indiceGanador: 0,
  opcionesSnapshot: ['uno', 'dos', 'tres', 'cuatro'],
  iniciadoEn: 1_000_000,
  duracionMs: 5200,
  confirmadoEn: null,
  ...over,
});

describe('RNG determinista · la base de que ambos vean lo mismo', () => {
  it('la misma semilla produce la misma secuencia', () => {
    const a = crearRng(42);
    const b = crearRng(42);
    const sa = [a(), a(), a(), a(), a()];
    const sb = [b(), b(), b(), b(), b()];
    expect(sa).toEqual(sb);
  });

  it('semillas distintas producen secuencias distintas', () => {
    expect(crearRng(1)()).not.toBe(crearRng(2)());
  });

  it('los valores caen en [0, 1)', () => {
    const r = crearRng(7);
    for (let i = 0; i < 500; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('Ángulo del giro · el ganador queda bajo el puntero', () => {
  /** Índice de la porción que queda arriba (las 12) tras rotar `grados`. */
  function porcionBajoElPuntero(n: number, grados: number): number {
    const paso = 360 / n;
    for (let k = 0; k < n; k++) {
      const centro = (k * paso + paso / 2 + grados) % 360;
      const desvio = Math.min(centro, 360 - centro);
      if (desvio < paso / 2 + 0.001) return k;
    }
    return -1;
  }

  it('para cualquier número de opciones y cualquier ganador, acierta', () => {
    for (const n of [1, 2, 3, 5, 6, 8, 12, 20]) {
      for (let k = 0; k < n; k++) {
        const giro = giroDe({
          opcionesSnapshot: Array.from({ length: n }, (_, i) => `op${i}`),
          indiceGanador: k,
          semilla: n * 1000 + k,
        });
        expect(porcionBajoElPuntero(n, anguloFinal(giro))).toBe(k);
      }
    }
  });

  it('da al menos 5 vueltas completas, para que se vea como un giro', () => {
    for (let s = 0; s < 50; s++) {
      expect(anguloFinal(giroDe({ semilla: s }))).toBeGreaterThanOrEqual(5 * 360);
    }
  });

  it('el ángulo es idéntico en dos dispositivos con los mismos datos', () => {
    const giro = giroDe({ semilla: 987654, indiceGanador: 2 });
    expect(anguloFinal(giro)).toBe(anguloFinal({ ...giro }));
  });
});

describe('Progreso de la animación · se calcula desde la hora del servidor', () => {
  const giro = giroDe();

  it('en el instante inicial está en 0', () => {
    expect(estadoEn(giro, giro.iniciadoEn).progreso).toBe(0);
  });

  it('a mitad de camino va por la mitad del tiempo', () => {
    expect(estadoEn(giro, giro.iniciadoEn + giro.duracionMs / 2).progreso).toBeCloseTo(0.5, 5);
  });

  it('al terminar marca terminado', () => {
    expect(estadoEn(giro, giro.iniciadoEn + giro.duracionMs).terminado).toBe(true);
  });

  it('quien llega TARDE entra en la posición correcta, no desde cero', () => {
    const tarde = estadoEn(giro, giro.iniciadoEn + 4000);
    const temprano = estadoEn(giro, giro.iniciadoEn + 100);
    expect(tarde.angulo).toBeGreaterThan(temprano.angulo);
    expect(tarde.progreso).toBeCloseTo(4000 / giro.duracionMs, 5);
  });

  it('un reloj atrasado nunca produce progreso negativo', () => {
    expect(estadoEn(giro, giro.iniciadoEn - 99_999).progreso).toBe(0);
  });

  it('el suavizado desacelera: avanza más al principio que al final', () => {
    expect(suavizado(0)).toBe(0);
    expect(suavizado(1)).toBe(1);
    expect(suavizado(0.5) - suavizado(0.25)).toBeGreaterThan(suavizado(1) - suavizado(0.75));
  });
});

describe('Pesos de la ruleta', () => {
  it('un peso mayor sale más veces', () => {
    const rng = crearRng(2024);
    const cuenta = [0, 0];
    for (let i = 0; i < 4000; i++) cuenta[elegirIndice(rng, [1, 4])]!++;
    expect(cuenta[1]!).toBeGreaterThan(cuenta[0]! * 2);
  });

  it('siempre devuelve un índice válido', () => {
    const rng = crearRng(5);
    for (let i = 0; i < 200; i++) {
      const k = elegirIndice(rng, [1, 1, 1]);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(3);
    }
  });
});

describe('Anti-repetición de preguntas', () => {
  const banco = (n: number): Pregunta[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `p${i}`, texto: `Pregunta ${i}`, categoria: 'profundas' as const,
    }));

  it('no repite mientras queden preguntas frescas', () => {
    const catalogo = banco(20);
    const servidas = new Map<string, number>();
    const vistas: string[] = [];

    for (let i = 0; i < 14; i++) {
      const p = elegirPregunta(catalogo, servidas, 25, vistas.at(-1) ?? null)!;
      vistas.push(p.id);
      servidas.set(p.id, Date.now() + i);
    }

    expect(new Set(vistas).size).toBe(vistas.length);
  });

  it('con catálogo pequeño no se queda sin candidatas', () => {
    const catalogo = banco(3);
    const servidas = new Map(catalogo.map((p, i) => [p.id, Date.now() + i]));
    expect(elegirPregunta(catalogo, servidas, 25, null)).not.toBeNull();
  });

  it('nunca devuelve la que ya está en pantalla si hay alternativa', () => {
    const catalogo = banco(6);
    for (let i = 0; i < 50; i++) {
      expect(elegirPregunta(catalogo, new Map(), 25, 'p0')!.id).not.toBe('p0');
    }
  });

  it('con catálogo vacío devuelve null en vez de reventar', () => {
    expect(elegirPregunta([], new Map(), 25, null)).toBeNull();
  });
});

describe('Códigos de vinculación', () => {
  it('tolera minúsculas, espacios y guiones de más', () => {
    const canonico = 'A-K3F9-2XQ7-M8T4';
    for (const escrito of ['a-k3f9-2xq7-m8t4', 'AK3F92XQ7M8T4', ' a k3f9 2xq7 m8t4 ', 'A--K3F9--2XQ7--M8T4']) {
      expect(parsearCodigo(escrito)).toEqual({ persona: 'a', canonico });
    }
  });

  it('deduce la persona del prefijo', () => {
    expect(parsearCodigo('B-M8T4-9WZ2-K3F9')?.persona).toBe('b');
  });

  it('rechaza longitudes incorrectas y prefijos inválidos', () => {
    expect(parsearCodigo('A-K3F9')).toBeNull();
    expect(parsearCodigo('C-K3F9-2XQ7-M8T4')).toBeNull();
    expect(parsearCodigo('')).toBeNull();
  });

  it('el alfabeto no tiene caracteres ambiguos (I, L, O, U, 0, 1)', () => {
    for (const c of 'ILOU01') expect(ALFABETO_CODIGO).not.toContain(c);
  });

  it('normalizar descarta lo que no pertenece al alfabeto', () => {
    expect(normalizarCodigo('a-k3f9!!!')).toBe('AK3F9');
  });

  it('genera cuerpos del largo correcto y solo con el alfabeto', () => {
    let n = 0;
    const cuerpo = generarCuerpo(() => (n++ * 37) % 256);
    expect(cuerpo).toHaveLength(LARGO_CUERPO);
    for (const c of cuerpo) expect(ALFABETO_CODIGO).toContain(c);
  });

  it('formatear y parsear son inversas', () => {
    const canonico = formatearCodigo('b', '23456789ABCD');
    expect(parsearCodigo(canonico)?.canonico).toBe(canonico);
  });
});

describe('Fechas en America/Santiago', () => {
  // 2026-09-07 22:15 en Santiago. Chile está en UTC-3 en septiembre (horario de verano).
  const t = Date.parse('2026-09-08T01:15:00Z');

  it('muestra la hora local, no la UTC', () => {
    expect(formatearUltimaConexion(t, t + 60_000)).toContain('22:15');
  });

  it('distingue hoy de ayer por día civil chileno', () => {
    expect(formatearUltimaConexion(t, t + 3_600_000)).toMatch(/^hoy a las/);
    // Ojo con la aritmética: t son las 22:15, así que +26 h ya cae DOS días
    // después. Para "ayer" hay que quedarse dentro del día siguiente.
    expect(formatearUltimaConexion(t, t + 14 * 3_600_000)).toMatch(/^ayer a las/);
  });

  it('pasados dos días da la fecha completa', () => {
    expect(formatearUltimaConexion(t, t + 72 * 3_600_000)).toMatch(/^el \d+ de \w+ a las/);
  });

  it('el alfabeto del código no admite el 1: el fixture inválido debe fallar', () => {
    // Este caso nació de un fallo real de estos tests: usé 'B-M8T4-9WZ1-K3F9'
    // como código de prueba y parsearCodigo lo rechazó, con razón. Se conserva
    // como test para que la protección no se pierda.
    expect(parsearCodigo('B-M8T4-9WZ1-K3F9')).toBeNull();
  });

  it('sin registro no inventa una fecha', () => {
    expect(formatearUltimaConexion(null)).toBe('sin conexiones registradas');
    expect(formatearCompleto(null)).toBe('sin registro');
  });
});

describe('Presencia derivada · la verdad son las conexiones vivas', () => {
  it('sin conexiones está desconectado', () => {
    expect(derivarPresencia({ ultimaConexion: 123, conexiones: {} }).enLinea).toBe(false);
  });

  it('con una conexión está en línea', () => {
    const v = derivarPresencia({ ultimaConexion: 123, conexiones: { s1: { iniciadaEn: 1, agente: 'web' } } });
    expect(v.enLinea).toBe(true);
    expect(v.dispositivos).toBe(1);
  });

  it('cuenta varios dispositivos', () => {
    const v = derivarPresencia({
      ultimaConexion: 1,
      conexiones: { s1: { iniciadaEn: 1, agente: 'web' }, s2: { iniciadaEn: 2, agente: 'web' } },
    });
    expect(v.dispositivos).toBe(2);
  });

  it('con datos corruptos o ausentes no revienta', () => {
    expect(derivarPresencia(null).enLinea).toBe(false);
    expect(derivarPresencia({ basura: true }).ultimaConexion).toBeNull();
  });
});

describe('Normalización de panoramas · misma regla en la app y en el seed', () => {
  it('ignora mayúsculas, tildes y espacios de más', () => {
    const esperado = 'ir al cerro san cristobal';
    expect(normalizarNombre('Ir al Cerro San Cristóbal')).toBe(esperado);
    expect(normalizarNombre('  ir  al   cerro  san cristobal ')).toBe(esperado);
    expect(normalizarNombre('IR AL CERRO SAN CRISTÓBAL')).toBe(esperado);
  });

  it('distingue planes que de verdad son distintos', () => {
    expect(normalizarNombre('Ir al cine')).not.toBe(normalizarNombre('Ir al circo'));
  });

  it('la ñ NO es una n con tilde: son planes diferentes', () => {
    // NFD descompone la tilde de "ó", pero la ñ es una letra por derecho propio.
    // Si la normalización la aplastara, "año nuevo" y "ano nuevo" colisionarían.
    expect(normalizarNombre('Año nuevo juntos')).toBe('año nuevo juntos');
  });

  it('es idempotente: normalizar lo ya normalizado no lo cambia', () => {
    const una = normalizarNombre('Café en la Plaza Ñuñoa');
    expect(normalizarNombre(una)).toBe(una);
  });
});

describe('Content Security Policy', () => {
  const directiva = (nombre: string) =>
    POLITICA_CSP.split('; ').find((d) => d.startsWith(nombre + ' ')) ?? '';

  it('permite el long polling de Realtime Database en script-src', () => {
    // El SDK cae a JSONP cuando el WebSocket no conecta, e inyecta un <script>
    // apuntando a la base de datos. Sin esto la app se queda cargando, y solo
    // en algunas redes: es un fallo que no aparece en desarrollo.
    expect(directiva('script-src')).toContain('https://*.firebaseio.com');
    expect(directiva('script-src')).toContain('https://*.firebasedatabase.app');
  });

  it('permite a reCAPTCHA cargar script, iframe e imágenes', () => {
    // El distintivo de reCAPTCHA trae imágenes de gstatic: sin img-src queda
    // roto, y una directiva corta no avisa con un error legible.
    expect(directiva('script-src')).toContain('https://www.google.com');
    expect(directiva('img-src')).toContain('https://www.gstatic.com');
    expect(directiva('frame-src')).toContain('https://www.google.com');
  });

  it('permite websocket y REST hacia Firebase en connect-src', () => {
    const conexion = directiva('connect-src');
    expect(conexion).toContain('wss://*.firebaseio.com');
    expect(conexion).toContain('https://*.googleapis.com');
  });

  it('no deja rendijas abiertas', () => {
    expect(POLITICA_CSP).not.toContain("'unsafe-eval'");
    expect(directiva('script-src')).not.toContain("'unsafe-inline'");
    expect(POLITICA_CSP).toContain("object-src 'none'");
    expect(POLITICA_CSP).toContain("base-uri 'self'");
    // La app no envía formularios a ningún sitio: todo pasa por el SDK.
    expect(POLITICA_CSP).toContain("form-action 'none'");
  });

  it('parte de default-src propio', () => {
    expect(POLITICA_CSP.startsWith("default-src 'self'")).toBe(true);
  });
});
