# Guía de despliegue — de cero a producción

Se hace **dos veces**: primero `qa`, después `prod`. Empieza siempre por QA:
si algo sale mal, sale mal donde no importa.

Tiempo estimado: 25 min por entorno la primera vez.

> **Regla que no se rompe:** ⛔ **nunca actualices a plan Blaze.** En Spark,
> agotar la cuota detiene el servicio; en Blaze, factura. Es la garantía de
> costo $0. Si la consola te ofrece "Actualizar", di que no.

---

# PARTE 1 · Firebase

## 1.1 Crear el proyecto

1. Entra a **[console.firebase.google.com](https://console.firebase.google.com)** → **Crear un proyecto**.
2. Nombre: `nuestro-espacio-qa` (luego repites con `nuestro-espacio-prod`).
3. **Desactiva Google Analytics.** No lo necesitas y evita que datos de uso de
   una app íntima salgan hacia un producto de publicidad.
4. Crear.

> ⚠ **Anota el ID real del proyecto.** Firebase le añade un sufijo si el nombre
> ya está tomado (`nuestro-espacio-qa-4f2a1`). Aparece en
> **⚙ Configuración del proyecto → ID del proyecto**. Si no coincide
> exactamente con `nuestro-espacio-qa`, hay que corregir `.firebaserc` — está en
> el paso 2.1.

5. Comprueba abajo a la izquierda que dice **Spark · Sin costo**.

## 1.2 Authentication — inicio de sesión anónimo

6. **Compilación → Authentication → Comenzar**.
7. Pestaña **Sign-in method** → **Anónimo** → **Habilitar** → Guardar.
8. No habilites ningún otro proveedor.

> 🔴 **Deja ACTIVADA la creación de cuentas** (Settings → User actions →
> "Habilitar creación"). Es contraintuitivo, pero desactivarla bloquearía el
> propio inicio de sesión anónimo: cada dispositivo nuevo *crea* un usuario al
> entrar. Sin eso, la app no arranca para nadie.
>
> **Entonces, ¿qué impide que entre un desconocido?** Que una cuenta anónima
> sin vínculo de dispositivo **no puede leer ni escribir absolutamente nada**.
> Necesita el código, y ese lo verifica el servidor contra un nodo que ningún
> cliente puede leer. La puerta no es el registro: es el código.

## 1.3 Cloud Firestore

9. **Compilación → Firestore Database → Crear base de datos**.
10. ⚠️ **Modo de producción** (deny-all). **Nunca modo de prueba**: deja todo
    abierto 30 días y es el error número uno con Firebase.
11. Ubicación: **`southamerica-west1` (Santiago)**.

> ⚠ La ubicación es **permanente**. No se puede cambiar después sin crear otro
> proyecto.

## 1.4 Realtime Database

12. **Compilación → Realtime Database → Crear base de datos**.
13. Ubicación: **`us-central1`**. RTDB no tiene región sudamericana; es la mejor
    opción disponible. Añade ~150 ms, imperceptible para presencia y ruletas.
14. Reglas: **modo bloqueado**.
15. **Copia la URL** que aparece arriba
    (`https://nuestro-espacio-qa-default-rtdb.firebaseio.com`). La necesitas dos veces.

## 1.5 Registrar la app web

16. **⚙ Configuración del proyecto → Tus apps → icono `</>` (Web)**.
17. Apodo: `Nuestro Espacio`. **No** marques "Firebase Hosting" — desplegamos en
    GitHub Pages.
18. Copia los cinco valores del `firebaseConfig`:

```
apiKey        →  PUBLIC_FIREBASE_API_KEY
authDomain    →  PUBLIC_FIREBASE_AUTH_DOMAIN
projectId     →  PUBLIC_FIREBASE_PROJECT_ID
appId         →  PUBLIC_FIREBASE_APP_ID
databaseURL   →  PUBLIC_FIREBASE_DATABASE_URL   (la del paso 15)
```

> Estos valores **acabarán en el bundle público y no pasa nada**: son
> identificadores, no credenciales. Google lo documenta así. Lo que protege los
> datos son las Security Rules, las restricciones de referrer y App Check.

## 1.6 · 1.7 App Check con reCAPTCHA Enterprise

> **Esto cambió y las guías antiguas mienten.** Google movió reCAPTCHA a Cloud:
> ya no se crean claves v3 sueltas desde `google.com/recaptcha/admin`, y las
> apps nuevas se registran con **reCAPTCHA Enterprise**. Sigue siendo gratis
> —10.000 evaluaciones al mes, sin tarjeta— y el proyecto no sale de Spark.

19. Firebase → **Compilación → App Check → Apps** → tu app web.
20. Proveedor **reCAPTCHA Enterprise** → Firebase crea la clave y la registra.
21. Copia la **clave de sitio** que queda a la vista. Es pública: viaja en el
    HTML. Con Enterprise **no hay clave secreta** que guardar.
22. Deja el **TTL del token** en 7 días. Menos llamadas a reCAPTCHA, menos
    cuota consumida; con dos usuarios el riesgo de un token robado es teórico.
23. En **APIs**, deja **Firestore**, **Realtime Database** y **Authentication**
    en **`Sin aplicar`** por ahora.

> ⚠️ El SDK tiene **dos providers distintos y no intercambiables**:
> `ReCaptchaV3Provider` y `ReCaptchaEnterpriseProvider`. Usar el que no
> corresponde no da ningún error visible mientras el enforcement esté en «sin
> aplicar» — y tumba la aplicación entera en cuanto lo actives. El código usa
> Enterprise: ver `frontend/src/infra/firebase/appcheck.ts`.

> El enforcement se activa **al final**, cuando la app ya funcione en esa URL.
> Activarlo antes solo produce errores difíciles de diagnosticar.

## 1.8 Restringir la API key

25. **[console.cloud.google.com](https://console.cloud.google.com)** → mismo proyecto →
    **APIs y servicios → Credenciales**.
26. Abre la clave `Browser key (auto created by Firebase)`.
27. **Restricciones de aplicación → Sitios web (referentes HTTP)** → agrega
    **el origen entero, sin ruta**, en los dos entornos:

```
https://benjaminvalenzuela.github.io/*
```

> **Por qué no se puede restringir por ruta.** La app envía
> `<meta name="referrer" content="strict-origin-when-cross-origin">`, así que
> el navegador manda solo el origen — nunca `/nuestro-espacio/qa/`. Una
> restricción con ruta es entonces **imposible de satisfacer** y produce
> `auth/requests-from-referer-...-are-blocked`. En `localhost` no se nota,
> porque ahí la ruta va en la propia URL de desarrollo.
>
> Consecuencia aceptada: QA y PROD comparten origen, así que la restricción
> por referrer no los separa entre sí. Lo que sí los separa —y es lo que
> importa— son proyectos distintos, bases distintas y códigos distintos.

28. **Solo en QA**, agrega además `http://localhost:4321/*` para poder probar en
    local contra la nube. En PROD, nunca.

## 1.9 Service Account

29. **⚙ Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada**.
30. Guarda el `.json` **exclusivamente** en `backend/secrets/sa-qa.json`
    (o `sa-prod.json`). Esa carpeta está en `.gitignore`.

> 🔴 Ese archivo **ignora todas las Security Rules**: puede leer y borrar todo.
> Si alguna vez se filtra, ve al [runbook](runbook.md), sección 3.

---

# PARTE 2 · Conectar con el proyecto

## 2.1 Corregir los IDs si Firebase les puso sufijo

Si los IDs reales no son exactamente `nuestro-espacio-qa` / `nuestro-espacio-prod`,
edita `.firebaserc`:

```json
{
  "projects": {
    "default": "demo-nuestro-espacio",
    "desa": "demo-nuestro-espacio",
    "qa": "AQUÍ-EL-ID-REAL-DE-QA",
    "prod": "AQUÍ-EL-ID-REAL-DE-PROD"
  }
}
```

## 2.2 Configurar el backend

```bash
cp backend/.env.example backend/.env.qa
cp backend/.env.example backend/.env.prod
```

Completa cada uno con la URL de RTDB de **su** proyecto y la ruta a **su**
Service Account (`./secrets/sa-qa.json` o `./secrets/sa-prod.json`).

## 2.3 Iniciar sesión en Firebase CLI

```bash
npx firebase login
```

Se abre el navegador. Autentícate con tu cuenta de Google. Es lo único que
requiere tus credenciales; después el token queda en tu máquina.

## 2.4 Desplegar las Security Rules

```bash
npm run rules:qa
```

Sin esto, **ambas bases están cerradas por completo** (las creaste en modo
bloqueado). La app no funcionaría.

## 2.5 Provisionar el espacio y obtener los códigos

```bash
npm run provisionar -- --entorno=qa
```

Imprime los dos códigos **una sola vez**:

```
┌──────────────────────────────────────────────┐
│  CÓDIGOS DE VINCULACIÓN                      │
├──────────────────────────────────────────────┤
│  Persona A   A-XXXX-XXXX-XXXX                │
│  Persona B   B-XXXX-XXXX-XXXX                │
└──────────────────────────────────────────────┘
```

> Guárdalos en tu gestor de contraseñas. **Nunca en el repositorio: es público.**
> Si los pierdes, se regeneran con `--regenerar`, pero eso desvincula todos los
> dispositivos.

## 2.6 Cargar el banco de contenido

```bash
npm run seed -- --entorno=qa
```

## 2.7 Probar en local contra QA antes de desplegar

Crea `frontend/.env` (ya está en `.gitignore`) con los valores del paso 18:

```
PUBLIC_ENTORNO=qa
PUBLIC_FIREBASE_API_KEY=...
PUBLIC_FIREBASE_AUTH_DOMAIN=...
PUBLIC_FIREBASE_PROJECT_ID=...
PUBLIC_FIREBASE_APP_ID=...
PUBLIC_FIREBASE_DATABASE_URL=...
PUBLIC_PAREJA_ID=pareja_principal
PUBLIC_RECAPTCHA_SITE_KEY=...
```

```bash
npm run dev
```

Entra con tu código. Si funciona aquí, funcionará desplegado.
**Borra `frontend/.env` después**, o el emulador local dejará de usarse.

---

# PARTE 3 · GitHub

## 3.1 Crear el repositorio

1. **[github.com/new](https://github.com/new)** → nombre `nuestro-espacio` →
   **Público** (obligatorio: GitHub Pages gratis lo exige) → sin README.

```bash
git add -A
git commit -m "Nuestro Espacio"
git branch -M main
git remote add origin https://github.com/benjaminvalenzuela/nuestro-espacio.git
git push -u origin main
```

## 3.2 Crear la rama develop

```bash
git checkout -b develop && git push -u origin develop
```

## 3.3 Crear los Environments

**Settings → Environments → New environment**, uno llamado `qa` y otro
`production`.

En **`production`** marca **Required reviewers** y añádete a ti mismo. Eso hace
que el despliegue a producción se detenga y espere tu aprobación. Es la única
puerta manual del pipeline, y es a propósito.

## 3.4 Variables por entorno

Dentro de cada environment → **Environment variables** → **Add variable**:

| Nombre | Valor |
|---|---|
| `FIREBASE_API_KEY` | del paso 18 |
| `FIREBASE_AUTH_DOMAIN` | del paso 18 |
| `FIREBASE_PROJECT_ID` | del paso 18 |
| `FIREBASE_APP_ID` | del paso 18 |
| `FIREBASE_DATABASE_URL` | del paso 15 |
| `PAREJA_ID` | `pareja_principal` |
| `RECAPTCHA_SITE_KEY` | clave del **sitio** del paso 21 |

## 3.5 Secreto por entorno

Dentro de cada environment → **Environment secrets** → **Add secret**:

| Nombre | Valor |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | **el contenido completo** del `.json` del paso 29 |

> Pega el JSON entero, desde `{` hasta `}`. No la ruta: el contenido.

## 3.6 Permitir que Actions escriba

**Settings → Actions → General → Workflow permissions** →
**Read and write permissions** → Guardar.

Sin esto, el workflow no puede crear la rama `gh-pages`.

## 3.7 Primer despliegue a QA

**Actions → Desplegar a QA → Run workflow → rama `develop`**.

Al terminar existe la rama `gh-pages` con la carpeta `/qa`.

## 3.8 Activar GitHub Pages

Solo ahora, porque hasta este momento la rama no existía:

**Settings → Pages → Source: Deploy from a branch → `gh-pages` / `(root)`** → Save.

En 1–2 minutos: **https://benjaminvalenzuela.github.io/nuestro-espacio/qa/**

## 3.9 Repetir para producción

Repite la **Parte 1** completa con `nuestro-espacio-prod`, luego:

```bash
npm run rules:prod
npm --workspace backend run provisionar -- --entorno=prod
npm --workspace backend run seed -- --entorno=prod
```

Y mergea `develop` → `main`. El workflow se detendrá esperando tu aprobación.

---

# PARTE 4 · Cierre de seguridad

Solo cuando la app YA funcione en su URL:

1. **App Check → APIs → Firestore y Realtime Database → `Aplicado`** (primero en
   QA; comprueba que la app sigue funcionando; después en PROD).
2. Comprueba que `http://localhost:4321/*` **no** está en los referentes de PROD.
3. Vincula los dispositivos: cada uno escribe su código una vez por aparato.
4. Verifica quién entró:
   ```bash
   npm run dispositivos -- --entorno=prod
   ```

---

## Verificación final

| Comprobación | Cómo |
|---|---|
| Sin código no se entra | Abre la URL en incógnito y escribe un código inventado |
| Los datos están cerrados | En incógnito, DevTools → no debe poder leerse nada |
| Presencia funciona | Dos dispositivos → "En línea" / "Última vez a las HH:MM" |
| Voto ciego funciona | Vota uno solo → el otro no ve nada hasta votar |
| Sigues en Spark | Consola Firebase, abajo a la izquierda: **Sin costo** |

---

## Si algo falla

| Síntoma | Causa casi segura |
|---|---|
| `auth/configuration-not-found` | Falta habilitar **Anónimo** en Authentication (paso 7) |
| `permission_denied` en todo | Reglas sin desplegar (paso 2.4) o espacio sin provisionar (2.5) |
| "Código incorrecto" con el código bueno | Provisionaste otro entorno; los códigos son por proyecto |
| Página en blanco tras desplegar | `PUBLIC_BASE_PATH` mal: revisa la subruta en el workflow |
| Todo falla justo tras activar App Check | `RECAPTCHA_SITE_KEY` ausente o de otro proyecto. Vuelve a `Sin aplicar` y revisa |
| `auth/requests-from-referer-...-are-blocked` | Restricción de API key **por ruta**. Debe ser por origen (ver paso 27) |
| `Configuración de entorno inválida` en el sitio desplegado | El workflow corrió antes de crear las Variables del environment. Relanza el despliegue |
| Cambias algo y el sitio sigue igual | Caché de GitHub Pages. Prueba con `?v=2` al final de la URL |
| El workflow no puede hacer push | Falta el paso 3.6 (permisos de escritura) |
| **Se queda en "Cargando" para siempre, a veces sí y a veces no** | La CSP no permite el *long polling* de RTDB. En la consola verás violaciones contra `.../.lp?start=t`. Los dominios de la base tienen que estar también en `script-src`, no solo en `connect-src` |
| CI falla con `leaks found` señalando `_astro/` | Es el bundle publicado, no una fuga. Ver runbook §7 |
| La ruleta aparece vacía en un entorno nuevo | Falta `npm run seed` (paso 2.6): los panoramas se siembran ahí |
