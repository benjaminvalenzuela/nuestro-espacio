import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { obtenerFirestore } from '../../infra/firebase/firestore';
import { FS } from '@shared/rutas-datos';
import { NIVELES, type Nivel } from '@shared/enums';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  CACHÉ DEL BANCO
 *
 *  El problema que resuelve, en números: el banco tiene 2.000 cartas. Leerlo
 *  entero cuesta 2.000 lecturas de Firestore. El plan Spark —el que mantiene
 *  esto en cero pesos— da 50.000 al día. Sin caché, veinticinco aperturas de la
 *  app dejarían el juego muerto hasta el día siguiente, y con dos personas
 *  cambiando de categoría eso se alcanza en una tarde.
 *
 *  Con caché se lee una vez por dispositivo y se guarda en localStorage. En
 *  las siguientes visitas cuesta UNA lectura: la del documento de configuración
 *  que trae `versionBanco`.
 *
 *  INVALIDACIÓN. El seed y el panel incrementan `versionBanco` cada vez que el
 *  banco cambia. Si la versión guardada no coincide con la del servidor, la
 *  copia local se tira y se vuelve a descargar. Sin ese número, agregar una
 *  pregunta desde el panel no llegaría nunca al otro teléfono.
 *
 *  localStorage puede fallar —modo privado, cuota llena, permisos— y por eso
 *  todo acceso va envuelto: si la caché no está disponible, la app funciona
 *  igual, solo que leyendo de la red.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const PREFIJO = 'nuestro-espacio:banco';
/** Sube este número si cambia la FORMA de lo guardado, no su contenido. */
const ESQUEMA = 2;

export interface CartaPregunta {
  id: string;
  texto: string;
  categoria: string;
  nivel: Nivel;
}

export interface CartaDilema {
  id: string;
  opcionA: string;
  opcionB: string;
  categoria: string;
  nivel: Nivel;
}

interface Envoltorio<T> {
  esquema: number;
  version: number;
  cartas: T[];
}

const nivelValido = (v: unknown): Nivel =>
  (NIVELES as readonly number[]).includes(Number(v)) ? (Number(v) as Nivel) : 1;

function leerCache<T>(clave: string, version: number): T[] | null {
  try {
    const crudo = localStorage.getItem(clave);
    if (!crudo) return null;
    const env = JSON.parse(crudo) as Envoltorio<T>;
    if (env.esquema !== ESQUEMA || env.version !== version) return null;
    return Array.isArray(env.cartas) ? env.cartas : null;
  } catch {
    return null;
  }
}

function guardarCache<T>(clave: string, version: number, cartas: T[]): void {
  try {
    localStorage.setItem(clave, JSON.stringify({ esquema: ESQUEMA, version, cartas }));
  } catch {
    // Cuota llena o almacenamiento bloqueado: se sigue sin caché, no es fatal.
  }
}

/**
 * Versión actual del banco. Una lectura barata que decide si hay que bajar
 * las 2.000 cartas o basta con lo que ya está en el navegador.
 */
export async function leerVersionBanco(): Promise<number> {
  try {
    const snap = await getDoc(doc(obtenerFirestore(), FS.configApp));
    const v = snap.data()?.versionBanco;
    return typeof v === 'number' ? v : 0;
  } catch {
    return 0;
  }
}

export async function cargarPreguntas(): Promise<CartaPregunta[]> {
  const version = await leerVersionBanco();
  const clave = `${PREFIJO}:preguntas`;

  const cacheadas = leerCache<CartaPregunta>(clave, version);
  if (cacheadas) return cacheadas;

  const snap = await getDocs(
    query(collection(obtenerFirestore(), FS.preguntas), where('activa', '==', true)),
  );

  const cartas = snap.docs
    .map((d) => {
      const x = d.data();
      return {
        id: d.id,
        texto: String(x.texto ?? ''),
        categoria: String(x.categoria ?? 'profundas'),
        nivel: nivelValido(x.nivel),
      };
    })
    .filter((c) => c.texto.length > 0);

  guardarCache(clave, version, cartas);
  return cartas;
}

export async function cargarDilemas(): Promise<CartaDilema[]> {
  const version = await leerVersionBanco();
  const clave = `${PREFIJO}:dilemas`;

  const cacheados = leerCache<CartaDilema>(clave, version);
  if (cacheados) return cacheados;

  const snap = await getDocs(
    query(collection(obtenerFirestore(), FS.dilemas), where('activo', '==', true)),
  );

  const cartas = snap.docs
    .map((d) => {
      const x = d.data();
      return {
        id: d.id,
        opcionA: String(x.opcionA ?? ''),
        opcionB: String(x.opcionB ?? ''),
        categoria: String(x.categoria ?? 'general'),
        nivel: nivelValido(x.nivel),
      };
    })
    .filter((c) => c.opcionA && c.opcionB);

  guardarCache(clave, version, cartas);
  return cartas;
}

/**
 * Tira la copia local. La llama el panel al tocar el banco, para que el cambio
 * se vea en el mismo dispositivo sin esperar a que cambie la versión.
 */
export function invalidarCache(): void {
  try {
    localStorage.removeItem(`${PREFIJO}:preguntas`);
    localStorage.removeItem(`${PREFIJO}:dilemas`);
  } catch {
    /* sin caché que invalidar */
  }
}
