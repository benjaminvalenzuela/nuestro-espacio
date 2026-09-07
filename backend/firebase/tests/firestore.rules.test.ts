import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, increment } from 'firebase/firestore';
import {
  crearEntorno, sembrar, PAREJA, UID_A1, UID_A2, UID_B1, UID_INTRUSO, CODIGO_A, CODIGO_B,
} from './entorno.js';

let env: RulesTestEnvironment;

const como = (uid: string) => env.authenticatedContext(uid).firestore();
const sinSesion = () => env.unauthenticatedContext().firestore();

beforeAll(async () => { env = await crearEntorno(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await sembrar(env);
});

describe('Pertenencia · un dispositivo sin vínculo no existe para el sistema', () => {
  it('sin sesión no se lee nada', async () => {
    await assertFails(getDoc(doc(sinSesion(), `parejas/${PAREJA}/panoramas/pan1`)));
  });

  it('autenticado pero SIN vínculo no lee los panoramas', async () => {
    await assertFails(getDoc(doc(como(UID_INTRUSO), `parejas/${PAREJA}/panoramas/pan1`)));
  });

  it('autenticado pero SIN vínculo no lee los perfiles', async () => {
    await assertFails(getDoc(doc(como(UID_INTRUSO), `parejas/${PAREJA}/perfiles/a`)));
  });

  it('autenticado pero SIN vínculo no lee el banco global de preguntas', async () => {
    await assertFails(getDoc(doc(como(UID_INTRUSO), 'preguntas/pf_001')));
  });

  it('un dispositivo vinculado sí lee los panoramas', async () => {
    await assertSucceeds(getDoc(doc(como(UID_A1), `parejas/${PAREJA}/panoramas/pan1`)));
  });
});

describe('Anti-IDOR · la frontera es el vínculo, no el id del documento', () => {
  it('no se alcanza el espacio de otra pareja aunque se adivine el id', async () => {
    await assertFails(getDoc(doc(como(UID_A1), 'parejas/otra_pareja/panoramas/pan1')));
  });

  it('no se escribe en el espacio de otra pareja', async () => {
    await assertFails(
      setDoc(doc(como(UID_A1), 'parejas/otra_pareja/panoramas/x'), {
        nombre: 'Colarse', nombreNormalizado: 'colarse', creadoPor: 'a',
        creadoEn: serverTimestamp(), activo: true, vecesRealizado: 0,
      }),
    );
  });
});

describe('Secretos · los códigos no se leen NUNCA desde el cliente', () => {
  it('ni siquiera un miembro legítimo puede leer los asientos', async () => {
    await assertFails(getDoc(doc(como(UID_A1), `parejas/${PAREJA}/secretos/asientos`)));
  });

  it('nadie puede sobrescribir los códigos', async () => {
    await assertFails(
      setDoc(doc(como(UID_A1), `parejas/${PAREJA}/secretos/asientos`), { a: 'A-0000', b: 'B-0000' }),
    );
  });
});

describe('Vinculación · el código lo comprueba el servidor', () => {
  const nuevo = 'uid-aparato-nuevo';

  it('rechaza un código incorrecto', async () => {
    await assertFails(
      setDoc(doc(como(nuevo), `parejas/${PAREJA}/dispositivos/${nuevo}`), {
        persona: 'a', nombre: 'Intruso', codigo: 'A-0000-0000-0000',
        vinculadoEn: serverTimestamp(),
      }),
    );
  });

  it('rechaza el código de A reclamando el asiento de B', async () => {
    await assertFails(
      setDoc(doc(como(nuevo), `parejas/${PAREJA}/dispositivos/${nuevo}`), {
        persona: 'b', nombre: 'Ana', codigo: CODIGO_A, vinculadoEn: serverTimestamp(),
      }),
    );
  });

  it('acepta el código correcto', async () => {
    await assertSucceeds(
      setDoc(doc(como(nuevo), `parejas/${PAREJA}/dispositivos/${nuevo}`), {
        persona: 'a', nombre: 'Ana', codigo: CODIGO_A, vinculadoEn: serverTimestamp(),
      }),
    );
  });

  it('no se puede vincular el aparato de otro uid', async () => {
    await assertFails(
      setDoc(doc(como(nuevo), `parejas/${PAREJA}/dispositivos/otro-uid`), {
        persona: 'a', nombre: 'Ana', codigo: CODIGO_A, vinculadoEn: serverTimestamp(),
      }),
    );
  });

  it('el vínculo es inmutable: no se cambia de persona reescribiéndolo', async () => {
    await assertFails(
      updateDoc(doc(como(UID_A1), `parejas/${PAREJA}/dispositivos/${UID_A1}`), { persona: 'b' }),
    );
  });

  it('nadie lee el vínculo de otro dispositivo', async () => {
    await assertFails(getDoc(doc(como(UID_A1), `parejas/${PAREJA}/dispositivos/${UID_B1}`)));
  });

  it('cada quien sí lee el suyo', async () => {
    await assertSucceeds(getDoc(doc(como(UID_A1), `parejas/${PAREJA}/dispositivos/${UID_A1}`)));
  });
});

describe('Perfiles · propiedad del recurso', () => {
  it('B no puede escribir el perfil de A', async () => {
    await assertFails(
      setDoc(doc(como(UID_B1), `parejas/${PAREJA}/perfiles/a`), {
        nombre: 'Suplantada', actualizadoEn: serverTimestamp(),
      }),
    );
  });

  it('A escribe el suyo desde cualquiera de sus dos aparatos', async () => {
    await assertSucceeds(
      setDoc(doc(como(UID_A2), `parejas/${PAREJA}/perfiles/a`), {
        nombre: 'Ana', actualizadoEn: serverTimestamp(),
      }),
    );
  });

  it('B sí puede LEER el perfil de A', async () => {
    await assertSucceeds(getDoc(doc(como(UID_B1), `parejas/${PAREJA}/perfiles/a`)));
  });
});

describe('Integridad · contadores y timestamps', () => {
  const ref = (uid: string) => doc(como(uid), `parejas/${PAREJA}/panoramas/pan1`);

  it('acepta el incremento de exactamente +1', async () => {
    await assertSucceeds(
      updateDoc(ref(UID_A1), { vecesRealizado: increment(1), ultimaVezEn: serverTimestamp() }),
    );
  });

  it('RECHAZA un salto de +2', async () => {
    await assertFails(
      updateDoc(ref(UID_A1), { vecesRealizado: increment(2), ultimaVezEn: serverTimestamp() }),
    );
  });

  it('RECHAZA fijar el contador a un valor arbitrario', async () => {
    await assertFails(
      updateDoc(ref(UID_A1), { vecesRealizado: 99, ultimaVezEn: serverTimestamp() }),
    );
  });

  it('RECHAZA un timestamp puesto por el cliente', async () => {
    await assertFails(
      updateDoc(ref(UID_A1), { vecesRealizado: increment(1), ultimaVezEn: new Date(2000, 0, 1) }),
    );
  });

  it('RECHAZA un campo no declarado (inyección de campos)', async () => {
    await assertFails(
      updateDoc(ref(UID_A1), { nombre: 'Otro', esSuperAdmin: true }),
    );
  });

  it('RECHAZA nombres con < o > (anti-XSS en el servidor)', async () => {
    await assertFails(
      updateDoc(ref(UID_A1), { nombre: '<script>alert(1)</script>', nombreNormalizado: 'x' }),
    );
  });

  it('el marcador de organización solo sube de uno en uno', async () => {
    const marcador = doc(como(UID_B1), `parejas/${PAREJA}/organizadores/b`);
    await assertSucceeds(updateDoc(marcador, { vecesOrganizado: increment(1), ultimaVezEn: serverTimestamp() }));
    await assertFails(updateDoc(marcador, { vecesOrganizado: increment(5), ultimaVezEn: serverTimestamp() }));
  });
});

describe('Historial y auditoría · append-only', () => {
  it('el historial no se puede reescribir', async () => {
    const id = 'ev1';
    await assertSucceeds(
      setDoc(doc(como(UID_A1), `parejas/${PAREJA}/historialPanoramas/${id}`), {
        panoramaId: 'pan1', nombreSnapshot: 'Ir al cerro', giroId: 'g1',
        ocurridoEn: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(como(UID_A1), `parejas/${PAREJA}/historialPanoramas/${id}`), {
        nombreSnapshot: 'Otra cosa',
      }),
    );
  });

  it('la auditoría no se puede firmar en nombre de la otra persona', async () => {
    await assertFails(
      setDoc(doc(como(UID_B1), `parejas/${PAREJA}/auditoria/x`), {
        actor: 'a', accion: 'borrar', recurso: 'historial',
        ocurridoEn: serverTimestamp(), origen: 'app',
      }),
    );
  });

  it('la auditoría es inmutable incluso para quien la escribió', async () => {
    await assertSucceeds(
      setDoc(doc(como(UID_A1), `parejas/${PAREJA}/auditoria/y`), {
        actor: 'a', accion: 'borrar', recurso: 'historial',
        ocurridoEn: serverTimestamp(), origen: 'app',
      }),
    );
    await assertFails(deleteDoc(doc(como(UID_A1), `parejas/${PAREJA}/auditoria/y`)));
  });
});

describe('Evento en curso · desde el banner solo se toca la fecha', () => {
  const crear = (uid: string) =>
    setDoc(doc(como(uid), `parejas/${PAREJA}/eventos/actual`), {
      panoramaId: 'pan1', nombre: 'Ir al cerro', organizador: 'b', fecha: null,
      giroId: 'g1', creadoEn: serverTimestamp(), actualizadoEn: serverTimestamp(),
    });

  it('un miembro puede crear el evento', async () => {
    await assertSucceeds(crear(UID_A1));
  });

  it('se le puede poner fecha', async () => {
    await crear(UID_A1);
    await assertSucceeds(
      updateDoc(doc(como(UID_B1), `parejas/${PAREJA}/eventos/actual`), {
        fecha: '2026-09-20', actualizadoEn: serverTimestamp(),
      }),
    );
  });

  it('RECHAZA una fecha con formato inválido', async () => {
    await crear(UID_A1);
    await assertFails(
      updateDoc(doc(como(UID_A1), `parejas/${PAREJA}/eventos/actual`), {
        fecha: '20-09-2026', actualizadoEn: serverTimestamp(),
      }),
    );
  });

  it('un giro NUEVO puede reemplazar el evento entero', async () => {
    await crear(UID_A1);
    await assertSucceeds(
      setDoc(doc(como(UID_B1), `parejas/${PAREJA}/eventos/actual`), {
        panoramaId: 'pan2', nombre: 'Cocinar juntos', organizador: 'a', fecha: null,
        giroId: 'g2', creadoEn: serverTimestamp(), actualizadoEn: serverTimestamp(),
      }),
    );
  });

  it('RECHAZA reemplazarlo conservando la fecha del evento anterior', async () => {
    await crear(UID_A1);
    await assertFails(
      setDoc(doc(como(UID_B1), `parejas/${PAREJA}/eventos/actual`), {
        panoramaId: 'pan2', nombre: 'Cocinar juntos', organizador: 'a',
        fecha: '2026-09-20',
        giroId: 'g2', creadoEn: serverTimestamp(), actualizadoEn: serverTimestamp(),
      }),
    );
  });

  it('RECHAZA cambiar el organizador sin volver a girar', async () => {
    await crear(UID_A1);
    await assertFails(
      updateDoc(doc(como(UID_B1), `parejas/${PAREJA}/eventos/actual`), {
        organizador: 'a', actualizadoEn: serverTimestamp(),
      }),
    );
  });
});
