/**
 * Adaptador de Cloud Firestore.
 *
 * Módulo aparte por la misma razón que ./rtdb: mantener el SDK de Firestore
 * fuera de las páginas que no consultan datos persistentes.
 */

import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { obtenerApp } from './cliente';
import { ES_DESA, EMULADORES } from '../../config/env';

let firestore: Firestore | undefined;

export function obtenerFirestore(): Firestore {
  if (firestore) return firestore;
  firestore = getFirestore(obtenerApp());
  if (ES_DESA) connectFirestoreEmulator(firestore, EMULADORES.host, EMULADORES.firestore);
  return firestore;
}
