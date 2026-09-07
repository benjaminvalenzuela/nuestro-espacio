import {
  ref,
  onValue,
  onDisconnect,
  update,
  set,
  remove,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/database';
import { obtenerRtdb } from '../../infra/firebase/rtdb';
import { RTDB } from '@shared/rutas-datos';
import { derivarPresencia, type VistaPresencia } from '@shared/schemas/presencia.schema';
import type { Persona } from '@shared/enums';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  SISTEMA DE PRESENCIA
 *
 *  El requisito difícil: "al cerrar la página o perder internet, registrar el
 *  evento y mostrar la fecha y hora exacta de la última conexión."
 *
 *  Un navegador que pierde el wifi no puede avisar de nada — ya no hay red. Por
 *  eso la marca la pone el SERVIDOR: con onDisconnect() se deja preparada una
 *  operación que Firebase ejecuta por su cuenta cuando el socket muere. Es la
 *  única razón por la que este módulo vive en Realtime Database y no en
 *  Firestore, que no tiene equivalente.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface ControlPresencia {
  detener: () => Promise<void>;
}

/**
 * Anuncia a este usuario como presente y programa su despedida.
 *
 * Indexado por PERSONA, no por dispositivo: cada pestaña o aparato registra su
 * propia `sesionId` bajo `conexiones/`. Así, cerrar el portátil no te marca
 * desconectado si el celular sigue abierto — que es justo lo que se pidió al
 * permitir varios dispositivos por persona.
 */
export function iniciarPresencia(parejaId: string, persona: Persona): ControlPresencia {
  const rtdb = obtenerRtdb();
  const sesionId = crypto.randomUUID();

  const refPresencia = ref(rtdb, RTDB.presenciaDe(parejaId, persona));
  const refConexion = ref(rtdb, RTDB.conexion(parejaId, persona, sesionId));
  const refConectado = ref(rtdb, '.info/connected');

  let cancelarSuscripcion: Unsubscribe | undefined;

  // '.info/connected' es un nodo sintético local: refleja si HAY socket vivo.
  // Vuelve a dispararse en cada reconexión, y eso importa: las operaciones
  // onDisconnect se pierden al reconectar y hay que volver a registrarlas.
  cancelarSuscripcion = onValue(refConectado, async (snap) => {
    if (snap.val() !== true) return;

    try {
      // ── ORDEN DELIBERADO ──
      // 1º programar la despedida, 2º anunciarse. Si se hiciera al revés y el
      // socket cayera entre medias, quedaría un "conectado" fantasma para
      // siempre: no habría nada registrado que lo limpiara.
      await onDisconnect(refConexion).remove();
      // Al morir el socket, el servidor sella la hora exacta. Se escribe en
      // cada desconexión aunque queden otros dispositivos vivos: no importa,
      // porque la UI solo la muestra cuando NO queda ninguno — y en ese
      // momento el valor es el correcto.
      await onDisconnect(refPresencia).update({
        ultimaConexion: serverTimestamp(),
      });

      await update(refPresencia, { ultimaConexion: serverTimestamp() });

      await set(refConexion, {
        iniciadaEn: serverTimestamp(),
        agente: 'web',
      });
    } catch (e) {
      // Sin claims, las reglas rechazan estas escrituras. No es un fallo de la
      // app: es el sistema funcionando. Se registra y se sigue.
      console.warn('[presencia] escritura rechazada:', (e as Error)?.message);
    }
  });

  // Cierre limpio de pestaña: onDisconnect tardaría unos segundos en detectar
  // el socket muerto. Borrar la conexión a mano hace que el otro lo vea al
  // instante. 'pagehide' es el evento fiable en iOS; 'beforeunload' no lo es.
  const alOcultar = () => {
    void remove(refConexion).catch(() => {});
  };
  window.addEventListener('pagehide', alOcultar);

  return {
    async detener() {
      window.removeEventListener('pagehide', alOcultar);
      cancelarSuscripcion?.();
      await onDisconnect(refConexion).cancel().catch(() => {});
      await remove(refConexion).catch(() => {});
      await update(refPresencia, { ultimaConexion: serverTimestamp() }).catch(() => {});
    },
  };
}

/** Observa la presencia de cualquiera de los dos (incluido uno mismo). */
export function observarPresencia(
  parejaId: string,
  persona: Persona,
  alCambiar: (vista: VistaPresencia) => void,
): Unsubscribe {
  return onValue(
    ref(obtenerRtdb(), RTDB.presenciaDe(parejaId, persona)),
    (snap) => alCambiar(derivarPresencia(snap.val())),
    () => alCambiar({ enLinea: false, ultimaConexion: null, dispositivos: 0 }),
  );
}

/**
 * Nombre visible de una persona, en tiempo real.
 *
 * Ya no hace falta ningún mapa auxiliar para saber "quién es el otro": con dos
 * asientos fijos, la pareja de 'a' es siempre 'b'. Ese es uno de los efectos
 * secundarios buenos de indexar por persona en vez de por uid.
 */
export function observarNombre(
  parejaId: string,
  persona: Persona,
  alCambiar: (nombre: string | null) => void,
): Unsubscribe {
  return onValue(
    ref(obtenerRtdb(), `${RTDB.persona(parejaId, persona)}/nombre`),
    (snap) => alCambiar(snap.exists() ? String(snap.val()) : null),
    () => alCambiar(null),
  );
}
