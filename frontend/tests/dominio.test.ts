import { describe, it, expect } from 'vitest';
import {
  crearRng, elegirIndice, anguloFinal, suavizado, estadoEn,
} from '../src/domain/ruleta/animacionGiro';
import { recientesDe } from '../src/domain/preguntas/preguntasService';
import { elegirCarta, contarPendientes } from '../src/domain/banco/seleccion';
import { estaDescartada, PASES_PARA_DESCARTAR, type EntradaProgreso } from '@shared/schemas/progreso.schema';
import { formatearUltimaConexion, formatearCompleto } from '../src/domain/presencia/formatoFecha';
import { parsearCodigo, formatearCodigo, normalizarCodigo, generarCuerpo, ALFABETO_CODIGO, LARGO_CUERPO } from '@shared/schemas/codigo';
import { derivarPresencia } from '@shared/schemas/presencia.schema';
import { normalizarNombre } from '@shared/panoramas';
import { signoDe, signoLegible, edadDe } from '@shared/zodiaco';
import {
  faseDe, calcularPromedios, iniciosDesdeDias, proximaMenstruacion,
  rejillaMes, sumarDias, diasEntre, CICLO_POR_DEFECTO,
} from '@shared/ciclo';
import {
  puntuarRonda, ganadorDe, empiezaPorLetra, letraDeSemilla,
  categoriaValida, LETRAS,
} from '@shared/bachillerato';
import { POLITICA_CSP } from '../src/config/csp';
import { siguienteTema, etiquetaDe, type Tema } from '../src/domain/tema/tema';
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

describe('Elección de carta · anti-repetición, descartes y niveles', () => {
  const banco = (n: number, nivel: 1 | 2 | 3 = 1) =>
    Array.from({ length: n }, (_, i) => ({ id: `p${i}`, nivel }));

  const entrada = (o: Partial<EntradaProgreso> = {}): EntradaProgreso =>
    ({ h: false, p: 0, t: 0, q: null, ...o });

  it('no repite mientras queden cartas sin estrenar', () => {
    const catalogo = banco(20);
    const progreso: Record<string, EntradaProgreso> = {};
    const vistas: string[] = [];

    for (let i = 0; i < 14; i++) {
      const recientes = recientesDe(progreso, 25);
      const c = elegirCarta({ candidatas: catalogo, progreso, recientes, excluir: vistas.at(-1) })!;
      vistas.push(c.id);
      progreso[c.id] = entrada({ t: Date.now() + i });
    }

    expect(new Set(vistas).size).toBe(vistas.length);
  });

  it('con catálogo pequeño no se queda sin candidatas', () => {
    const catalogo = banco(3);
    const progreso = Object.fromEntries(
      catalogo.map((c, i) => [c.id, entrada({ t: Date.now() + i })]),
    );
    expect(elegirCarta({ candidatas: catalogo, progreso })).not.toBeNull();
  });

  it('nunca devuelve la que está en pantalla si hay alternativa', () => {
    const catalogo = banco(6);
    for (let i = 0; i < 50; i++) {
      expect(elegirCarta({ candidatas: catalogo, progreso: {}, excluir: 'p0' })!.id).not.toBe('p0');
    }
  });

  it('con catálogo vacío devuelve null en vez de reventar', () => {
    expect(elegirCarta({ candidatas: [], progreso: {} })).toBeNull();
  });

  it('una carta pasada tres veces no vuelve a salir', () => {
    const catalogo = banco(4);
    const progreso = { p0: entrada({ p: PASES_PARA_DESCARTAR }) };

    for (let i = 0; i < 80; i++) {
      expect(elegirCarta({ candidatas: catalogo, progreso })!.id).not.toBe('p0');
    }
    expect(estaDescartada(progreso.p0)).toBe(true);
  });

  it('si TODAS están descartadas devuelve null, no una descartada', () => {
    const catalogo = banco(3);
    const progreso = Object.fromEntries(
      catalogo.map((c) => [c.id, entrada({ p: PASES_PARA_DESCARTAR })]),
    );
    expect(elegirCarta({ candidatas: catalogo, progreso })).toBeNull();
  });

  it('prefiere las no hechas antes que las hechas', () => {
    const catalogo = banco(5);
    const progreso = {
      p0: entrada({ h: true }), p1: entrada({ h: true }),
      p2: entrada({ h: true }), p3: entrada({ h: true }),
    };
    // Solo p4 está sin hacer: debe salir siempre mientras exista.
    for (let i = 0; i < 40; i++) {
      expect(elegirCarta({ candidatas: catalogo, progreso })!.id).toBe('p4');
    }
  });

  it('las hechas vuelven a salir cuando ya no quedan nuevas', () => {
    const catalogo = banco(3);
    const progreso = Object.fromEntries(catalogo.map((c) => [c.id, entrada({ h: true })]));
    expect(elegirCarta({ candidatas: catalogo, progreso })).not.toBeNull();
  });

  it('respeta el reparto de niveles pedido: 55 % para 1 y 2, 45 % para el 3', () => {
    // Mismo número de cartas por nivel, para que la única diferencia sea el peso.
    const catalogo = [
      ...Array.from({ length: 100 }, (_, i) => ({ id: `a${i}`, nivel: 1 as const })),
      ...Array.from({ length: 100 }, (_, i) => ({ id: `b${i}`, nivel: 2 as const })),
      ...Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, nivel: 3 as const })),
    ];

    // Azar determinista: recorre la cuerda de pesos de forma uniforme, así el
    // test mide el reparto real y no la suerte de una tirada.
    let paso = 0;
    const azar = () => ((paso++ * 0.0007) % 1);

    const cuenta = { 1: 0, 2: 0, 3: 0 };
    for (let i = 0; i < 6000; i++) {
      const c = elegirCarta({ candidatas: catalogo, progreso: {}, azar })!;
      cuenta[c.nivel]++;
    }

    const total = cuenta[1] + cuenta[2] + cuenta[3];
    const pct = (n: number) => (n / total) * 100;

    expect(pct(cuenta[1]) + pct(cuenta[2])).toBeGreaterThan(50);
    expect(pct(cuenta[1]) + pct(cuenta[2])).toBeLessThan(60);
    expect(pct(cuenta[3])).toBeGreaterThan(40);
    expect(pct(cuenta[3])).toBeLessThan(50);
  });

  it('cuenta pendientes, hechas y descartadas por separado', () => {
    const catalogo = banco(10);
    const progreso = {
      p0: entrada({ h: true }),
      p1: entrada({ h: true }),
      p2: entrada({ p: PASES_PARA_DESCARTAR }),
    };
    const c = contarPendientes(catalogo, progreso);
    expect(c).toEqual({ total: 10, hechas: 2, descartadas: 1, pendientes: 7 });
  });

  it('una carta descartada no cuenta además como hecha', () => {
    // Se puede marcar hecha y luego pasarla tres veces. No debe contarse dos veces.
    const catalogo = banco(3);
    const progreso = { p0: entrada({ h: true, p: PASES_PARA_DESCARTAR }) };
    const c = contarPendientes(catalogo, progreso);
    expect(c.hechas + c.descartadas + c.pendientes).toBe(c.total);
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

  it('permite a reCAPTCHA las cuatro cosas que necesita', () => {
    // Las cuatro, no tres: el fetch a /recaptcha/enterprise/clr se descubrió
    // desplegado, y su ausencia solo se manifiesta como un genérico
    // "AppCheck credentials are invalid" que no menciona la CSP.
    expect(directiva('script-src')).toContain('https://www.google.com');
    expect(directiva('img-src')).toContain('https://www.gstatic.com');
    expect(directiva('frame-src')).toContain('https://www.google.com');
    expect(directiva('connect-src')).toContain('https://www.google.com');
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

describe('Signo zodiacal · se deduce, no se elige', () => {
  it('acierta en el centro de cada signo', () => {
    const casos: [string, string][] = [
      ['1996-01-05', 'Capricornio'], ['1996-02-05', 'Acuario'],
      ['1996-03-05', 'Piscis'], ['1996-04-05', 'Aries'],
      ['1996-05-05', 'Tauro'], ['1996-06-05', 'Géminis'],
      ['1996-07-05', 'Cáncer'], ['1996-08-05', 'Leo'],
      ['1996-09-05', 'Virgo'], ['1996-10-05', 'Libra'],
      ['1996-11-05', 'Escorpio'], ['1996-12-05', 'Sagitario'],
    ];
    for (const [fecha, esperado] of casos) {
      expect(signoDe(fecha)?.nombre, fecha).toBe(esperado);
    }
  });

  it('acierta justo en los bordes, que es donde se falla', () => {
    expect(signoDe('1996-01-19')?.nombre).toBe('Capricornio');
    expect(signoDe('1996-01-20')?.nombre).toBe('Acuario');
    expect(signoDe('1996-12-21')?.nombre).toBe('Sagitario');
    expect(signoDe('1996-12-22')?.nombre).toBe('Capricornio');
  });

  it('el 31 de diciembre y el 1 de enero son ambos Capricornio', () => {
    // El único signo que cruza el cambio de año. Un bucle mal cerrado lo parte.
    expect(signoDe('1996-12-31')?.nombre).toBe('Capricornio');
    expect(signoDe('1997-01-01')?.nombre).toBe('Capricornio');
  });

  it('no se desplaza un día por interpretar la fecha en UTC', () => {
    // new Date('1996-01-01') es medianoche UTC, que en Chile es el 31 de
    // diciembre. Si el cálculo pasara por ahí, esto daría Sagitario.
    expect(signoDe('1996-01-01')?.nombre).toBe('Capricornio');
    expect(signoDe('1996-07-23')?.nombre).toBe('Leo');
  });

  it('devuelve null con una fecha ausente o mal formada', () => {
    for (const malo of ['', '  ', 'ayer', '1996-13-01', '96-01-01', null, undefined]) {
      expect(signoDe(malo)).toBeNull();
    }
  });

  it('la versión legible trae emoji y elemento', () => {
    expect(signoLegible('1996-08-05')).toBe('♌ Leo · Fuego');
    expect(signoLegible(undefined)).toBe('');
  });

  it('la edad no cuenta el cumpleaños hasta que llega', () => {
    expect(edadDe('1996-07-10', '2026-07-09')).toBe(29);
    expect(edadDe('1996-07-10', '2026-07-10')).toBe(30);
    expect(edadDe('1996-07-10', '2026-07-11')).toBe(30);
  });

  it('la edad aguanta el 29 de febrero', () => {
    expect(edadDe('2000-02-29', '2026-02-28')).toBe(25);
    expect(edadDe('2000-02-29', '2026-03-01')).toBe(26);
  });
});

describe('Ciclo menstrual · aritmética de días civiles', () => {
  it('suma días cruzando meses y años', () => {
    expect(sumarDias('2026-01-31', 1)).toBe('2026-02-01');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('aguanta el año bisiesto', () => {
    expect(sumarDias('2028-02-28', 1)).toBe('2028-02-29');
    expect(diasEntre('2028-02-01', '2028-03-01')).toBe(29);
    expect(diasEntre('2026-02-01', '2026-03-01')).toBe(28);
  });

  it('no se desplaza en el cambio de hora chileno', () => {
    // Septiembre y abril son los meses del cambio: hay días de 23 y 25 horas.
    // Restando milisegundos y dividiendo por 86.400.000, esto daría 30 o 32.
    expect(diasEntre('2026-09-01', '2026-10-01')).toBe(30);
    expect(diasEntre('2026-04-01', '2026-05-01')).toBe(30);
  });
});

describe('Ciclo · inicios a partir de los días marcados', () => {
  it('agrupa días seguidos en un solo inicio', () => {
    const dias = ['2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'];
    expect(iniciosDesdeDias(dias)).toEqual(['2026-09-03']);
  });

  it('un día suelto sin marcar no corta la racha', () => {
    // Es normal que un día apenas manche y no se registre.
    const dias = ['2026-09-03', '2026-09-04', '2026-09-06'];
    expect(iniciosDesdeDias(dias)).toEqual(['2026-09-03']);
  });

  it('un hueco largo sí abre un ciclo nuevo', () => {
    const dias = ['2026-08-05', '2026-08-06', '2026-09-02', '2026-09-03'];
    expect(iniciosDesdeDias(dias)).toEqual(['2026-08-05', '2026-09-02']);
  });

  it('tolera días desordenados y repetidos', () => {
    const dias = ['2026-09-04', '2026-09-03', '2026-09-03'];
    expect(iniciosDesdeDias(dias)).toEqual(['2026-09-03']);
  });
});

describe('Ciclo · promedios reales, no el 28 de manual', () => {
  it('sin historial usa el valor por defecto y lo declara', () => {
    const p = calcularPromedios([]);
    expect(p.ciclo).toBe(CICLO_POR_DEFECTO);
    expect(p.muestras).toBe(0);
  });

  it('promedia los intervalos reales', () => {
    // 31 y 31 días de separación.
    const p = calcularPromedios(['2026-07-01', '2026-08-01', '2026-09-01']);
    expect(p.ciclo).toBe(31);
    expect(p.muestras).toBe(2);
  });

  it('descarta intervalos absurdos que arruinarían la predicción', () => {
    // El salto de dos años es un registro olvidado, no un ciclo.
    const p = calcularPromedios(['2024-01-01', '2026-08-01', '2026-08-29']);
    expect(p.ciclo).toBe(28);
    expect(p.muestras).toBe(1);
  });

  it('predice la próxima regla desde el último inicio', () => {
    const inicios = ['2026-07-01', '2026-08-01', '2026-09-01'];
    const p = calcularPromedios(inicios);
    expect(proximaMenstruacion(inicios, p)).toBe('2026-10-02');
  });
});

describe('Ciclo · fases', () => {
  const inicios = ['2026-09-01'];
  const p = calcularPromedios(inicios, 5);   // 28 días por defecto, regla de 5

  it('los primeros días son menstruación', () => {
    expect(faseDe('2026-09-01', inicios, p).fase).toBe('menstruacion');
    expect(faseDe('2026-09-05', inicios, p).fase).toBe('menstruacion');
    expect(faseDe('2026-09-06', inicios, p).fase).toBe('folicular');
  });

  it('la ovulación cae 14 días antes del final del ciclo', () => {
    // Ciclo de 28 → ovulación el día 14 → 13 días después del 1 de septiembre.
    const info = faseDe('2026-09-14', inicios, p);
    expect(info.fase).toBe('ovulacion');
    expect(info.diaDelCiclo).toBe(14);
    expect(info.fertil).toBe(true);
  });

  it('después de ovular viene la fase lútea', () => {
    expect(faseDe('2026-09-20', inicios, p).fase).toBe('lutea');
  });

  it('la ventana fértil cubre los cinco días previos y el día después', () => {
    expect(faseDe('2026-09-09', inicios, p).fertil).toBe(true);   // día 9
    expect(faseDe('2026-09-15', inicios, p).fertil).toBe(true);   // día 15
    expect(faseDe('2026-09-08', inicios, p).fertil).toBe(false);  // día 8
    expect(faseDe('2026-09-16', inicios, p).fertil).toBe(false);  // día 16
  });

  it('UN DÍA REGISTRADO MANDA SOBRE LA PREDICCIÓN', () => {
    // Si la regla se adelanta y ella lo marca, el calendario debe hacerle caso
    // aunque su cálculo dijera "fase lútea". Un hecho anotado no se discute.
    const registradas = new Set(['2026-09-25']);
    const info = faseDe('2026-09-25', inicios, p, registradas);
    expect(info.fase).toBe('menstruacion');
    expect(info.confirmado).toBe(true);
  });

  it('sin ningún inicio previo no inventa una fase', () => {
    expect(faseDe('2026-09-10', [], p).fase).toBe('desconocida');
    expect(faseDe('2026-08-15', inicios, p).fase).toBe('desconocida');
  });

  it('deja de predecir tras dos ciclos sin registrar', () => {
    // A los dos meses sin marcar nada, seguir dibujando fases sería inventar.
    expect(faseDe('2026-11-15', inicios, p).fase).toBe('desconocida');
  });

  it('un ciclo largo mueve la ovulación', () => {
    const largos = ['2026-06-01', '2026-07-04', '2026-08-06'];   // ~33 días
    const pl = calcularPromedios(largos, 5);
    expect(pl.ciclo).toBe(33);
    // Ovulación en el día 19, no en el 14.
    expect(faseDe('2026-08-24', largos, pl).fase).toBe('ovulacion');
  });
});

describe('Ciclo · rejilla del mes', () => {
  it('empieza en lunes y cuadra el primer día', () => {
    // El 1 de septiembre de 2026 es martes: un hueco antes.
    const celdas = rejillaMes(2026, 9);
    expect(celdas[0]?.relleno).toBe(true);
    expect(celdas[1]?.fecha).toBe('2026-09-01');
    expect(celdas.filter((c) => !c.relleno)).toHaveLength(30);
  });

  it('un mes que empieza en lunes no lleva huecos', () => {
    // 1 de junio de 2026 es lunes.
    const celdas = rejillaMes(2026, 6);
    expect(celdas[0]?.fecha).toBe('2026-06-01');
  });

  it('febrero bisiesto trae 29 días', () => {
    expect(rejillaMes(2028, 2).filter((c) => !c.relleno)).toHaveLength(29);
  });
});

describe('Bachillerato · puntuación', () => {
  const cats = ['Nombre', 'Animal'];

  it('0 si no escribiste nada', () => {
    const r = puntuarRonda(cats, { a: {}, b: { Nombre: 'Ana' } }, 'A');
    expect(r.puntajes.a).toBe(0);
  });

  it('50 si los dos escribieron lo mismo', () => {
    const r = puntuarRonda(['Nombre'], { a: { Nombre: 'Ana' }, b: { Nombre: 'Ana' } }, 'A');
    expect(r.puntajes.a).toBe(50);
    expect(r.puntajes.b).toBe(50);
  });

  it('100 si escribiste algo distinto', () => {
    const r = puntuarRonda(['Nombre'], { a: { Nombre: 'Ana' }, b: { Nombre: 'Alberto' } }, 'A');
    expect(r.puntajes.a).toBe(100);
    expect(r.puntajes.b).toBe(100);
  });

  it('"lo mismo" ignora tildes, mayúsculas y espacios', () => {
    const r = puntuarRonda(['Color'], { a: { Color: 'Ámbar' }, b: { Color: '  ambar ' } }, 'A');
    expect(r.puntajes.a).toBe(50);
    expect(r.celdas.Color?.a?.motivo).toBe('repetida');
  });

  it('una palabra que no empieza por la letra vale 0', () => {
    const r = puntuarRonda(['Animal'], { a: { Animal: 'Perro' }, b: {} }, 'A');
    expect(r.puntajes.a).toBe(0);
    expect(r.celdas.Animal?.a?.motivo).toBe('letra_incorrecta');
  });

  it('que el rival no conteste no te penaliza: son 100', () => {
    const r = puntuarRonda(['Animal'], { a: { Animal: 'Araña' }, b: {} }, 'A');
    expect(r.puntajes.a).toBe(100);
    expect(r.puntajes.b).toBe(0);
  });

  it('una palabra inválida del rival no cuenta como coincidencia', () => {
    // B escribió lo mismo pero con la letra equivocada: A no debe bajar a 50.
    const r = puntuarRonda(['Animal'], { a: { Animal: 'Araña' }, b: { Animal: 'Araña' } }, 'B');
    expect(r.puntajes.a).toBe(0);
    expect(r.puntajes.b).toBe(0);
  });

  it('suma todas las categorías', () => {
    const r = puntuarRonda(
      ['Nombre', 'Animal', 'Comida'],
      { a: { Nombre: 'Ana', Animal: 'Araña', Comida: 'Arroz' }, b: { Nombre: 'Ana' } },
      'A',
    );
    expect(r.puntajes.a).toBe(50 + 100 + 100);
    expect(r.puntajes.b).toBe(50);
  });

  it('la ñ no se confunde con la n', () => {
    const r = puntuarRonda(['Cosa'], { a: { Cosa: 'Añil' }, b: { Cosa: 'Anil' } }, 'A');
    expect(r.puntajes.a).toBe(100);
  });

  it('decide el ganador y detecta el empate', () => {
    expect(ganadorDe({ a: 300, b: 150 })).toBe('a');
    expect(ganadorDe({ a: 150, b: 300 })).toBe('b');
    expect(ganadorDe({ a: 200, b: 200 })).toBe('empate');
    expect(ganadorDe({ a: 0, b: 0 })).toBe('empate');
  });

  it('acepta la tilde inicial como la letra', () => {
    expect(empiezaPorLetra('Ángel', 'A')).toBe(true);
    expect(empiezaPorLetra('Ángel', 'E')).toBe(false);
    expect(empiezaPorLetra('   ', 'A')).toBe(false);
  });

  it('la letra sale de la semilla y siempre está en el alfabeto', () => {
    for (const semilla of [0, 1, 7, 12345, 999999, 2 ** 31]) {
      expect(LETRAS).toContain(letraDeSemilla(semilla));
    }
    // Determinista: la misma semilla da la misma letra en las dos pantallas.
    expect(letraDeSemilla(12345)).toBe(letraDeSemilla(12345));
  });

  it('valida los nombres de categoría', () => {
    expect(categoriaValida('Animal')).toBe(true);
    expect(categoriaValida('A')).toBe(false);
    expect(categoriaValida('  ')).toBe(false);
    expect(categoriaValida('<script>')).toBe(false);
    expect(categoriaValida('x'.repeat(41))).toBe(false);
  });
});

describe('Tema claro/oscuro', () => {
  it('rota entre los tres estados y vuelve al principio', () => {
    let t: Tema = 'claro';
    t = siguienteTema(t); expect(t).toBe('oscuro');
    t = siguienteTema(t); expect(t).toBe('sistema');
    t = siguienteTema(t); expect(t).toBe('claro');
  });

  it('cada estado tiene etiqueta y emoji', () => {
    for (const t of ['claro', 'oscuro', 'sistema'] as Tema[]) {
      const e = etiquetaDe(t);
      expect(e.etiqueta.length).toBeGreaterThan(0);
      expect(e.emoji.length).toBeGreaterThan(0);
    }
  });

  it('el script del tema NO puede ser inline: la CSP lo bloquearía', () => {
    // script-src no lleva 'unsafe-inline', así que el tema se carga desde un
    // archivo propio. Si alguien lo devolviera al HTML, dejaría de aplicarse
    // en producción sin ningún error visible en desarrollo.
    const scriptSrc = POLITICA_CSP.split('; ').find((d) => d.startsWith('script-src')) ?? '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("'self'");

    // style-src SÍ lo lleva, y es correcto: Astro y Tailwind emiten estilos
    // dentro del HTML. Un estilo inline no ejecuta código; un script sí.
    const styleSrc = POLITICA_CSP.split('; ').find((d) => d.startsWith('style-src')) ?? '';
    expect(styleSrc).toContain("'unsafe-inline'");
  });
});
