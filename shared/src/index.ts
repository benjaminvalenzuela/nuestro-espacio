/**
 * Contrato único entre frontend y backend.
 *
 * Todo lo que cruza la frontera cliente/servidor se define AQUÍ una sola vez.
 * Las Security Rules replican estas mismas invariantes en el servidor: este
 * módulo es la versión ejecutable del contrato, no una segunda fuente de verdad.
 */

export * from './enums.js';
export * from './rutas-datos.js';
export * from './schemas/presencia.schema.js';
export * from './schemas/perfil.schema.js';
export * from './schemas/codigo.js';
