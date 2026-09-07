# Nuestro Espacio

App privada para dos personas: ruleta de panoramas, juegos de pareja, perfiles
y presencia en tiempo real. Alojada gratis en GitHub Pages con Firebase detrás.

**Costo de operación: $0.** Plan Spark de Firebase, GitHub Pages y Actions en
repositorio público. Actualizar a Blaze está explícitamente prohibido en este
proyecto: en Spark, agotar la cuota detiene el servicio en vez de generar una factura.

---

## Arranque en local

Sin nube, sin cuentas, sin configurar nada:

```bash
npm install
npm run emu        # emuladores de Firebase (necesita Java 21)
npm run desa       # provisiona el espacio e imprime los códigos de acceso
npm run dev        # http://localhost:4321
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Compilación estática de producción |
| `npm run test` | Typecheck + dominio + Security Rules |
| `npm run typecheck` | Solo tipos |
| `npm run test:dominio` | Funciones puras, sin red |
| `npm run test:reglas` | Reglas contra los emuladores |
| `npm run provisionar -- --entorno=<e>` | Crea el espacio y los códigos |
| `npm run dispositivos -- --entorno=<e>` | Inventario y revocación de aparatos |
| `npm run seed -- --entorno=<e>` | Carga preguntas y dilemas |
| `npm run secrets:scan` | gitleaks en local |

## Estructura

```
frontend/   Astro + Tailwind. UI (islas) → dominio (TS puro) → infra (Firebase)
backend/    Admin SDK: provisionado, revocación, seeds, tests de reglas
shared/     Contrato único: schemas Zod, enums, rutas de datos
docs/       Runbook operativo y plan de pruebas
```

La capa de dominio **no importa `firebase/*`**. Solo `frontend/src/infra/` lo hace.
Por eso el dominio se testea sin red y en milisegundos.

## Decisiones que conviene conocer antes de tocar nada

| | |
|---|---|
| **Sin Cloud Functions** | Requieren plan Blaze. **Las Security Rules SON el backend de autorización.** Lo que no se prohíba ahí, queda abierto |
| **Repositorio público** | GitHub Pages gratis lo exige. Cero secretos en el repo, nunca |
| **Identidad sin login** | Anonymous Auth + persona (`a`/`b`) + código de vinculación. Un uid = un dispositivo; varios dispositivos = una persona |
| **RTDB + Firestore** | `onDisconnect()` solo existe en RTDB: es lo que permite registrar la última conexión al perder internet |
| **Todo en UTC** | Se formatea en `America/Santiago`. Chile cambia de hora dos veces al año |
| **Borrado lógico** | "Eliminar" marca inactivo. Las reglas prohíben el `delete` en los bancos de contenido |

## Seguridad

- **19 invariantes** cubiertas por 67 tests de reglas — ver [docs/plan-pruebas.md](docs/plan-pruebas.md)
- **Anti-XSS en tres capas:** Zod en cliente → reglas en servidor → `textContent` al pintar
- **Anti-IDOR estructural:** la pertenencia se comprueba contra el vínculo del dispositivo, no contra el id del documento
- **Votación ciega impuesta por el servidor:** los votos son ilegibles hasta que existen los dos
- **Auditoría append-only:** ni el administrador puede editarla o borrarla

Procedimientos de emergencia (dispositivo perdido, código filtrado, Service
Account comprometido) en [docs/runbook.md](docs/runbook.md).

## Puesta en marcha en la nube

Guía paso a paso para QA y producción, desde crear el proyecto de Firebase
hasta el primer despliegue: **[docs/despliegue.md](docs/despliegue.md)**.

## Despliegue

```
feature/* → PR → CI (tipos · dominio · reglas · gitleaks · audit · build)
develop   → QA   automático  → /nuestro-espacio/qa/
main      → PROD con aprobación manual → /nuestro-espacio/
```

Las **Security Rules se despliegan aparte y a mano** (workflow *Desplegar
Security Rules*): un fallo ahí no rompe una pantalla, abre la base de datos.
El workflow vuelve a ejecutar los tests antes de subir nada.
