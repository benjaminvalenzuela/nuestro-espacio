import { z } from 'zod';

/**
 * Forma del nodo /salas/{parejaId}/presencia/{uid} en RTDB.
 *
 * Espeja exactamente las reglas de database.rules.json. Si algún día cambia
 * una, este schema debe cambiar con ella — y los tests del Paso 4 lo verifican.
 */

export const ConexionSchema = z.object({
  /** Milisegundos epoch puestos por el SERVIDOR (ServerValue.TIMESTAMP). */
  iniciadaEn: z.number().int().positive(),
  agente: z.string().max(40),
});
export type Conexion = z.infer<typeof ConexionSchema>;

export const PresenciaSchema = z.object({
  ultimaConexion: z.number().int().positive(),
  /** Un hijo por pestaña o dispositivo abierto. */
  conexiones: z.record(z.string(), ConexionSchema).optional(),
});
export type Presencia = z.infer<typeof PresenciaSchema>;

/**
 * Vista derivada que consume la UI.
 *
 * DECISIÓN IMPORTANTE: `enLinea` se DERIVA de si quedan conexiones vivas.
 *
 * Hubo un campo `estado` ('online'/'offline') y se eliminó tras comprobarlo en
 * ejecución: el onDisconnect de cada pestaña escribe sobre el nodo compartido
 * de la persona, así que cerrar UNA lo ponía en 'offline' aunque otro
 * dispositivo siguiera conectado. Contar conexiones es la única fuente
 * correcta cuando una persona usa varios aparatos.
 */
export interface VistaPresencia {
  enLinea: boolean;
  /** Epoch ms, o null si nunca se ha conectado. */
  ultimaConexion: number | null;
  dispositivos: number;
}

export function derivarPresencia(crudo: unknown): VistaPresencia {
  const r = PresenciaSchema.partial().safeParse(crudo ?? {});
  const datos = r.success ? r.data : {};
  const dispositivos = datos.conexiones ? Object.keys(datos.conexiones).length : 0;

  return {
    enLinea: dispositivos > 0,
    ultimaConexion: datos.ultimaConexion ?? null,
    dispositivos,
  };
}
