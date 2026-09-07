import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { ref, get, set, update, remove, serverTimestamp } from 'firebase/database';
import {
  crearEntorno, sembrar, PAREJA, UID_A1, UID_A2, UID_B1, UID_INTRUSO, CODIGO_A, CODIGO_B,
} from './entorno.js';

let env: RulesTestEnvironment;

const como = (uid: string) => env.authenticatedContext(uid).database();
const sinSesion = () => env.unauthenticatedContext().database();

const S = `salas/${PAREJA}`;

beforeAll(async () => { env = await crearEntorno(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearDatabase();
  await sembrar(env);
});

describe('Asientos · el código nunca sale del servidor', () => {
  it('un miembro NO puede leer los códigos', async () => {
    await assertFails(get(ref(como(UID_A1), `${S}/asientos`)));
  });

  it('tampoco el código de su propio asiento', async () => {
    await assertFails(get(ref(como(UID_A1), `${S}/asientos/a/codigo`)));
  });

  it('nadie los puede sobrescribir', async () => {
    await assertFails(set(ref(como(UID_A1), `${S}/asientos/a/codigo`), 'A-0000-0000-0000'));
  });
});

describe('Vinculación en RTDB', () => {
  const nuevo = 'uid-nuevo';

  it('rechaza un código incorrecto', async () => {
    await assertFails(
      set(ref(como(nuevo), `${S}/dispositivos/${nuevo}`), {
        persona: 'a', nombre: 'X', codigo: 'A-0000-0000-0000', vinculadoEn: serverTimestamp(),
      }),
    );
  });

  it('rechaza usar el código de A para el asiento de B', async () => {
    await assertFails(
      set(ref(como(nuevo), `${S}/dispositivos/${nuevo}`), {
        persona: 'b', nombre: 'X', codigo: CODIGO_A, vinculadoEn: serverTimestamp(),
      }),
    );
  });

  it('acepta el código correcto', async () => {
    await assertSucceeds(
      set(ref(como(nuevo), `${S}/dispositivos/${nuevo}`), {
        persona: 'b', nombre: 'Beto', codigo: CODIGO_B, vinculadoEn: serverTimestamp(),
      }),
    );
  });

  it('rechaza un nombre con < o >', async () => {
    await assertFails(
      set(ref(como(nuevo), `${S}/dispositivos/${nuevo}`), {
        persona: 'a', nombre: '<img src=x>', codigo: CODIGO_A, vinculadoEn: serverTimestamp(),
      }),
    );
  });

  it('el vínculo es de escritura única', async () => {
    await assertFails(
      set(ref(como(UID_A1), `${S}/dispositivos/${UID_A1}`), {
        persona: 'b', nombre: 'Ana', codigo: CODIGO_B, vinculadoEn: serverTimestamp(),
      }),
    );
  });

  it('nadie lee el vínculo ajeno', async () => {
    await assertFails(get(ref(como(UID_A1), `${S}/dispositivos/${UID_B1}`)));
  });
});

describe('Presencia', () => {
  it('sin vínculo no se lee la presencia', async () => {
    await assertFails(get(ref(como(UID_INTRUSO), `${S}/presencia`)));
  });

  it('B no puede escribir la presencia de A', async () => {
    await assertFails(
      update(ref(como(UID_B1), `${S}/presencia/a`), { ultimaConexion: serverTimestamp() }),
    );
  });

  it('A escribe la suya desde su segundo aparato', async () => {
    await assertSucceeds(
      update(ref(como(UID_A2), `${S}/presencia/a`), { ultimaConexion: serverTimestamp() }),
    );
  });

  it('RECHAZA una hora inventada por el cliente', async () => {
    await assertFails(
      update(ref(como(UID_A1), `${S}/presencia/a`), { ultimaConexion: 946684800000 }),
    );
  });
});

describe('🔒 VOTACIÓN CIEGA · la invariante más importante del sistema', () => {
  const RONDA = 'r1';

  const abrir = async () => {
    await assertSucceeds(
      set(ref(como(UID_A1), `${S}/dilemas/${RONDA}/meta`), {
        dilemaId: 'dl_001', abiertoEn: serverTimestamp(), votosEmitidos: 0,
      }),
    );
  };

  const votar = (uid: string, persona: 'a' | 'b', opcion: 'A' | 'B') =>
    set(ref(como(uid), `${S}/dilemas/${RONDA}/votos/${persona}`), {
      opcion, emitidoEn: serverTimestamp(),
    });

  it('con UN solo voto, la otra persona NO puede leer los votos', async () => {
    await abrir();
    await assertSucceeds(votar(UID_A1, 'a', 'A'));
    await assertFails(get(ref(como(UID_B1), `${S}/dilemas/${RONDA}/votos`)));
  });

  it('con UN solo voto, ni siquiera quien votó puede leerlos', async () => {
    await abrir();
    await assertSucceeds(votar(UID_A1, 'a', 'A'));
    await assertFails(get(ref(como(UID_A1), `${S}/dilemas/${RONDA}/votos`)));
  });

  it('tampoco se puede espiar el voto suelto de la otra persona', async () => {
    await abrir();
    await assertSucceeds(votar(UID_A1, 'a', 'A'));
    await assertFails(get(ref(como(UID_B1), `${S}/dilemas/${RONDA}/votos/a`)));
  });

  it('FALSEAR el contador NO abre la lectura', async () => {
    await abrir();
    await assertSucceeds(votar(UID_A1, 'a', 'A'));
    // El contador es escribible por el cliente a propósito: es una señal de UI.
    await assertSucceeds(
      set(ref(como(UID_B1), `${S}/dilemas/${RONDA}/meta/votosEmitidos`), 2),
    );
    // Y aun así, el servidor sigue negando los votos.
    await assertFails(get(ref(como(UID_B1), `${S}/dilemas/${RONDA}/votos`)));
  });

  it('con los DOS votos, ambos leen', async () => {
    await abrir();
    await assertSucceeds(votar(UID_A1, 'a', 'A'));
    await assertSucceeds(votar(UID_B1, 'b', 'B'));
    await assertSucceeds(get(ref(como(UID_A1), `${S}/dilemas/${RONDA}/votos`)));
    await assertSucceeds(get(ref(como(UID_B1), `${S}/dilemas/${RONDA}/votos`)));
  });

  it('nadie puede votar por la otra persona', async () => {
    await abrir();
    await assertFails(votar(UID_B1, 'a', 'A'));
  });

  it('el voto es de escritura única: no se cambia tras ver el del otro', async () => {
    await abrir();
    await assertSucceeds(votar(UID_A1, 'a', 'A'));
    await assertSucceeds(votar(UID_B1, 'b', 'B'));
    await assertFails(votar(UID_A1, 'a', 'B'));
  });

  it('tampoco se puede borrar el propio voto para volver a votar', async () => {
    await abrir();
    await assertSucceeds(votar(UID_A1, 'a', 'A'));
    await assertFails(remove(ref(como(UID_A1), `${S}/dilemas/${RONDA}/votos/a`)));
  });

  it('RECHAZA una opción que no sea A o B', async () => {
    await abrir();
    await assertFails(
      set(ref(como(UID_A1), `${S}/dilemas/${RONDA}/votos/a`), {
        opcion: 'C', emitidoEn: serverTimestamp(),
      }),
    );
  });

  it('el segundo aparato de A tampoco puede votar dos veces', async () => {
    await abrir();
    await assertSucceeds(votar(UID_A1, 'a', 'A'));
    await assertFails(votar(UID_A2, 'a', 'B'));
  });
});

describe('Giro de ruleta · candado de la condición de carrera', () => {
  const giro = (uid: string, id: string, iniciadoEn: unknown, estado = 'girando') =>
    set(ref(como(uid), `${S}/giro/panoramas`), {
      id, estado, iniciadoPor: 'a', semilla: 123, indiceGanador: 0,
      opcionesSnapshot: ['Ir al cerro'], iniciadoEn, duracionMs: 5200, confirmadoEn: null,
    });

  it('el primer giro se acepta', async () => {
    await assertSucceeds(giro(UID_A1, 'giro-0000001', serverTimestamp()));
  });

  it('RECHAZA un giro nuevo mientras hay uno en curso', async () => {
    await assertSucceeds(giro(UID_A1, 'giro-0000001', serverTimestamp()));
    await assertFails(giro(UID_B1, 'giro-0000002', serverTimestamp()));
  });

  it('permite actualizar el MISMO giro (cerrarlo)', async () => {
    await assertSucceeds(giro(UID_A1, 'giro-0000001', serverTimestamp()));
    await assertSucceeds(
      update(ref(como(UID_B1), `${S}/giro/panoramas`), {
        estado: 'resuelto', confirmadoEn: serverTimestamp(),
      }),
    );
  });

  it('auto-sanación: tras 30 s colgado, se admite un giro nuevo', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref(`${S}/giro/panoramas`).set({
        id: 'giro-colgado01', estado: 'girando', iniciadoPor: 'a', semilla: 1,
        indiceGanador: 0, opcionesSnapshot: ['x'],
        iniciadoEn: Date.now() - 60_000, duracionMs: 5200, confirmadoEn: null,
      });
    });
    await assertSucceeds(giro(UID_B1, 'giro-0000003', serverTimestamp()));
  });

  it('RECHAZA una duración fuera de rango', async () => {
    await assertFails(
      set(ref(como(UID_A1), `${S}/giro/panoramas`), {
        id: 'giro-0000009', estado: 'girando', iniciadoPor: 'a', semilla: 1,
        indiceGanador: 0, opcionesSnapshot: ['x'], iniciadoEn: serverTimestamp(),
        duracionMs: 999_999, confirmadoEn: null,
      }),
    );
  });

  it('sin vínculo no se puede girar', async () => {
    await assertFails(giro(UID_INTRUSO, 'giro-0000004', serverTimestamp()));
  });
});

describe('Pregunta activa · un nodo por categoría', () => {
  const servir = (uid: string, filtro: string, id: string) =>
    set(ref(como(uid), `${S}/preguntaActiva/${filtro}`), {
      preguntaId: id, mostradaEn: serverTimestamp(), servidaPor: 'a',
    });

  it('cada categoría acepta su propia carta', async () => {
    await assertSucceeds(servir(UID_A1, 'mix', 'pf_001'));
    await assertSucceeds(servir(UID_A1, 'profundas', 'pf_002'));
  });

  it('las categorías no se pisan entre sí', async () => {
    await servir(UID_A1, 'mix', 'pf_001');
    await servir(UID_A1, 'profundas', 'pf_002');
    const mix = await get(ref(como(UID_A1), `${S}/preguntaActiva/mix/preguntaId`));
    const prof = await get(ref(como(UID_A1), `${S}/preguntaActiva/profundas/preguntaId`));
    expect(mix.val()).toBe('pf_001');
    expect(prof.val()).toBe('pf_002');
  });

  it('RECHAZA una categoría inventada', async () => {
    await assertFails(servir(UID_A1, 'inventada', 'pf_001'));
  });
});

describe('Denegación por defecto', () => {
  it('una rama no declarada está cerrada', async () => {
    await assertFails(get(ref(como(UID_A1), `${S}/rama_inexistente`)));
    await assertFails(set(ref(como(UID_A1), 'basura/x'), { y: 1 }));
  });

  it('sin sesión no se lee la raíz', async () => {
    await assertFails(get(ref(sinSesion(), '/')));
  });
});
