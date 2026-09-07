/**
 * Adaptador de Realtime Database.
 *
 * Módulo aparte de `cliente.ts` a propósito: así el SDK de RTDB solo entra en
 * el bundle de las páginas que lo usan (presencia, ruletas, dilemas) y no en
 * la de login.
 */

import { getDatabase, connectDatabaseEmulator, type Database } from 'firebase/database';
import { obtenerApp } from './cliente';
import { ES_DESA, EMULADORES } from '../../config/env';

let rtdb: Database | undefined;

export function obtenerRtdb(): Database {
  if (rtdb) return rtdb;
  rtdb = getDatabase(obtenerApp());
  if (ES_DESA) connectDatabaseEmulator(rtdb, EMULADORES.host, EMULADORES.rtdb);
  return rtdb;
}
