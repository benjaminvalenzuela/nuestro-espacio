import { $identidad, iniciarIdentidad, type EstadoIdentidad } from './identidad';
import { ruta } from '../../config/env';

export type SesionActiva = Extract<EstadoIdentidad, { fase: 'vinculado' }>;

/**
 * Guardia de página. Arranca la identidad y llama a `alEntrar` UNA sola vez,
 * cuando este dispositivo está vinculado; si no lo está, redirige.
 *
 * ⚠ Esto es UX, no seguridad. Quien lo salte (desactivando JS, editando el
 * bundle) llegará a una página vacía: las Security Rules deniegan todas las
 * lecturas a un uid sin vínculo. El guardia evita el parpadeo de contenido
 * roto, no protege los datos — eso lo hace el servidor.
 */
export function protegerPagina(alEntrar: (sesion: SesionActiva) => void): void {
  let entrado = false;

  iniciarIdentidad();

  $identidad.subscribe((s) => {
    if (s.fase === 'cargando') return;

    if (s.fase !== 'vinculado') {
      window.location.replace(ruta('/identificarse'));
      return;
    }

    if (entrado) return;
    entrado = true;
    alEntrar(s);
  });
}
