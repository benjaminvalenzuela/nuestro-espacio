# Runbook operativo — nuestro-espacio

Procedimientos manuales. Cada uno indica en qué entorno se ejecuta y qué NO hacer.

Modelo de identidad vigente: **ADR-012 · Anonymous Auth + persona + código**.
No hay login, ni contraseñas, ni cuentas de Google.

---

## 1 · Vincular un dispositivo

Cada persona tiene un código fijo (`A-…` o `B-…`) y lo escribe **una vez por
aparato**. Después, abrir la app basta: el vínculo vive en el navegador y no
caduca.

1. Obtener los códigos (los imprime el provisionado, y solo esa vez):
   ```
   npm run provisionar -- --entorno=<desa|qa|prod>
   ```
2. Esa persona abre la app, escribe su nombre y su código, y pulsa **Entrar**.
3. Comprobar el inventario:
   ```
   npm run dispositivos -- --entorno=<desa|qa|prod>
   ```

> No hay ninguna "ventana" que abrir ni cerrar: el registro está cerrado por
> construcción. Sin el código, la escritura del vínculo la rechaza el servidor.

**Segundo dispositivo (celular):** exactamente lo mismo, el mismo código. Queda
vinculado a la misma persona; presencia, perfiles y marcadores se comparten.

---

## 2 · Emergencia: dispositivo perdido o robado

Se revoca **ese aparato**, no la persona. Los demás siguen funcionando y no se
pierde ningún dato:

```
npm run dispositivos -- --entorno=prod                    # localizar el uid
npm run dispositivos -- --entorno=prod --revocar=<uid>    # cortarlo
```

Borra el vínculo en Firestore y en RTDB: ese uid deja de pasar cualquier regla
de inmediato.

**Si el código en sí quedó comprometido** (alguien lo vio, se envió por un canal
inseguro):

```
npm run provisionar -- --entorno=prod --regenerar
```

⚠ Esto invalida **todos** los dispositivos vinculados con el código anterior:
habrá que volver a vincularlos con el nuevo.

---

## 3 · Emergencia: Service Account filtrado

El JSON de `backend/secrets/` ignora todas las Security Rules. Si sale de tu
máquina (commit, captura, adjunto), se considera comprometido de inmediato.

1. Consola Firebase → **Configuración → Cuentas de servicio → Administrar
   permisos** → Google Cloud IAM → localizar la clave → **Eliminar**.
2. Generar una nueva y guardarla SOLO en `backend/secrets/`.
3. Rotar el GitHub Secret correspondiente (`FIREBASE_SA_QA` / `FIREBASE_SA_PROD`).
4. Regenerar los códigos (sección 2) y revisar `/parejas/{id}/auditoria`.

> Borrar el commit **no** resuelve nada: el repositorio es público y el secreto
> queda en el historial, los forks y los mirrors de GitHub.

---

## 4 · Reversión de un despliegue a PROD

- **Frontend:** `git revert <commit>` sobre `main` → el pipeline redespliega. ~3 min.
- **Security Rules:** Consola → Firestore → Rules → pestaña **Historial** →
  seleccionar la versión anterior → **Restaurar**. Efecto inmediato.
  Después, revertir también el archivo en el repo para no redesplegar el fallo.

---

## 5 · Diagnóstico de presencia

Muestra el nodo tal cual está en la base, sin pasar por la UI. Sirve para
comprobar lo que no se ve desde el navegador: qué queda grabado cuando el
último dispositivo de alguien se desconecta.

```
npm --workspace backend run presencia -- --entorno=<desa|qa|prod>
```

`conexiones vivas` es la fuente de verdad de "en línea" — hubo un campo
`estado` y se eliminó porque mentía con varios dispositivos abiertos.

---

## 6 · Cargar contenido en un entorno nuevo

```
npm --workspace backend run seed -- --entorno=<qa|prod>
```

Carga tres cosas y cada una con una regla distinta de reejecución:

| | Dónde vive | Al reejecutar |
|---|---|---|
| Preguntas | banco global | `merge:true` — refresca el texto, respeta `activa` |
| Dilemas | banco global | igual que las preguntas |
| Panoramas | bajo la pareja | **solo crea los que faltan** |

Los panoramas son la excepción y es deliberado: llevan `vecesRealizado`, el
histórico de cuántas veces se ha hecho ese plan. Un `merge` ciego lo pondría
a cero. La comparación es por `nombreNormalizado`, así que un panorama que
ustedes agregaron desde la app con el mismo nombre no se duplica.

Si el seed dice `20 creados, 0 ya estaban` en un entorno que ya usaban,
algo va mal: revisar `PAREJA_ID` en el `.env` antes de seguir.

### Cuentas anónimas huérfanas

Abrir la app crea una cuenta anónima **antes** de saber si quien entra
escribirá un código válido. Los intentos fallidos y las pruebas dejan cuentas
que no están vinculadas a ningún dispositivo: son inofensivas —sin vínculo no
pasan ninguna regla— pero se acumulan.

```
npm run dispositivos -- --entorno=<qa|prod> --huerfanos           # solo informa
npm run dispositivos -- --entorno=<qa|prod> --huerfanos --purgar  # borra
```

Nunca toca una cuenta vinculada, y respeta 24 horas de gracia: una cuenta
recién creada puede ser la de alguien que está tecleando su código ahora.

⛔ **Esto sustituye a la "limpieza automática" de Firebase, que debe seguir
desactivada.** Aquella borra por antigüedad sin mirar el vínculo: se llevaría
los dispositivos legítimos, que están pensados para durar años.

---

## 7 · Falsos positivos de gitleaks

Si CI falla con `leaks found` y el hallazgo apunta a un archivo de
`assets/` o `_astro/`: es el bundle publicado, no una fuga. La API key de
Firebase Web **tiene** que estar ahí — es un identificador público que el
navegador necesita, y lo que protege el proyecto es la restricción por
referrer más las Security Rules, no el secreto de esa cadena.

El escaneo está acotado con `--log-opts HEAD` justamente para no recorrer
`gh-pages`. Si vuelve a aparecer, comprobar que ese flag sigue puesto antes
de tocar la allowlist: ampliar la allowlist es la forma habitual de dejar
de ver fugas de verdad.

---

## 8 · Emergencia: App Check tumbó la aplicación

**Síntoma:** justo después de poner una API en `Aplicado`, todo devuelve
permiso denegado — también para ustedes, también con el dispositivo vinculado.

**Reversión inmediata**, antes de investigar nada:

> Firebase → App Check → **APIs** → la API afectada → **`Sin aplicar`**.
> El efecto es inmediato y no se pierde ningún dato.

Después, en la app desplegada, abrir la consola del navegador:

| Lo que se ve | Lo que significa |
|---|---|
| Violaciones de CSP contra `google.com/recaptcha/...` | Falta un origen. reCAPTCHA toca **cuatro** directivas: `script-src`, `img-src`, `frame-src` y `connect-src` |
| `AppCheck credentials ... are invalid` **y ninguna violación de CSP** | La clave de sitio no corresponde a este proyecto, o el provider del SDK no coincide con el proveedor registrado en la consola |
| Nada anómalo, pero sigue fallando | Comprobar que `RECAPTCHA_SITE_KEY` está en el environment **correcto** y que el despliegue posterior sí la incluyó |

**La trampa de este apartado:** con el enforcement en `Sin aplicar`, una
configuración rota de App Check **no se nota**. La aplicación funciona igual.
Por eso el orden es siempre: configurar → desplegar → comprobar en la consola
que no hay avisos → y solo entonces `Aplicado`, primero en QA.

---

## 9 · Respaldo de los datos

```
npm --workspace backend run respaldo -- --entorno=prod
```

Deja un JSON en `backend/respaldos/` con perfiles, panoramas y sus contadores,
banco completo, historiales, progreso, ciclo y partidas. Se puede abrir y leer
a ojo: las fechas van en texto, no en formato de Firebase.

**No incluye los códigos de vinculación, a propósito.** Un respaldo acaba en la
carpeta de Descargas o adjunto en un correo, y los códigos no pueden acabar
ahí. Si hicieran falta, se regeneran con `provisionar`.

La carpeta está en `.gitignore`: el repositorio es público.

### Qué puede y qué no puede borrar datos

| Acción | ¿Se pierde algo? |
|---|---|
| Desplegar una versión nueva | **No.** Solo cambia el HTML y el JS; la base ni se toca |
| `npm run seed` | **No.** Todo es `merge` y no hay un solo `delete` |
| Cambiar Security Rules | **No.** Pueden bloquear una escritura, nunca borrar |
| Quitar un campo del esquema | **Sí, en la práctica.** El dato sobrevive pero deja de verse, que para quien lo escribió es lo mismo. **Es el único que hay que vigilar** |
| Botón de limpieza del panel | **Sí**, y solo los tres historiales: la lista blanca está en `adminService.ts` y hay un test que la fija |

---

## 10 · «Cargando» eterno con 404 en la consola

**Síntoma:** tras un despliegue, la app se queda cargando y la consola muestra
varios 404 de archivos `_astro/*.js`.

**Causa:** el HTML que sirve GitHub Pages es de una versión y los assets que
pide ya no existen. Los nombres llevan hash, así que cada build genera otros
archivos distintos; si el despliegue borró los anteriores, quien tenga el HTML
cacheado —en el borde de Pages o en su navegador— pide fantasmas.

**Ya no debería pasar:** los dos entornos publican con `keep_files: true`, así
que las versiones conviven y la transición es invisible. Si vuelve a ocurrir,
lo primero es comprobar que ese flag sigue puesto en `cd-qa.yml` y
`cd-prod.yml`.

**Mientras dure**, se arregla solo en unos minutos, cuando expira el caché del
HTML. Para forzarlo: recargar con un `?v=` distinto.

⚠️ El workflow **Reconstruir gh-pages** sí borra todo a propósito: úsalo solo
cuando la rama acumule demasiada basura, y relanza los dos despliegues después.

---

## 11 · Cuánta cuota gasta la app de verdad

El plan Spark da **50.000 lecturas de Firestore al día**. Esto es lo que cuesta
cada cosa, medido y no estimado a ojo:

| Acción | Lecturas |
|---|---|
| Abrir el juego de preguntas por primera vez en un aparato | ~1.020 |
| Abrirlo cualquier otra vez | **1** (solo pregunta si cambió el banco) |
| Sacar la siguiente pregunta | **0** — se elige en memoria |
| Cambiar de categoría | **0** |
| Marcar hecha o pasar | 0 lecturas, 1 escritura |
| Abrir «Ya respondidas» | hasta 300 |

El catálogo se guarda en el navegador (**214 KB** de los ~5.000 disponibles) y
solo se vuelve a descargar cuando cambia `versionBanco`, es decir, cuando
alguien toca el banco desde el panel o se ejecuta el seed.

### Lo que sí puede disparar la cuota

1. **Cargar contenido nuevo muchas veces en un día.** Cada cambio del banco
   obliga a los cuatro aparatos a redescargar ~2.000 documentos: unas 8.000
   lecturas por cambio. Cinco cambios en un día son 40.000, y quedan 10.000
   para todo lo demás. Si vas a agregar preguntas, hazlo de una vez.

2. **Recargar listas dentro de un bucle de juego.** Pasó de verdad: el
   historial de «qué prefieres» se recargaba entero tras cada ronda revelada,
   así que el coste crecía con el uso —cuanto más jugaban, más caro les salía
   jugar—. Se corrigió añadiendo la partida en memoria. Si añades una pantalla
   nueva, comprueba que no lee una colección completa dentro de una acción que
   se repite.

### Cómo ver el consumo real

Consola de Firebase → **Firestore Database → Uso**. Muestra lecturas,
escrituras y borrados del día. Si algo se dispara, ahí se ve antes de que la
app deje de funcionar.

---

## 12 · Qué cuenta como panorama «realizado»

El contador `vecesRealizado` de cada panorama, y la línea que se ve en la
ruleta como «Realizado 3 veces», ya **no** los mueve el sorteo. Los mueve el
botón **✅ Evento realizado** del banner del inicio.

Antes se anotaba en el momento de girar, y por eso el número mentía: tres
giros un viernes indeciso sumaban tres «realizados» sin que nadie hubiera
salido de casa. Los dos botones del banner separan las dos cosas:

| Botón | Historial | Contador | Evento |
|---|---|---|---|
| ✅ Evento realizado | añade una entrada con `confirmado: true` | +1 | se cierra |
| ✖️ Cancelar evento | no toca nada | igual | se cierra |

Cancelar pide confirmación y realizar no, a propósito: confirmar añade una
línea que se puede volver a añadir, mientras que cancelar borra el panorama
sorteado y recuperarlo obliga a girar otra vez.

Consecuencia al leer datos antiguos: las entradas de `historialPanoramas`
creadas antes de este cambio **no** llevan `confirmado`, y corresponden a
sorteos, no necesariamente a salidas.

## 13 · Contenido nuevo en el banco

Los archivos viven en `backend/data/banco/`, uno por bloque temático, y la
categoría y el nivel salen del **nombre del archivo** (ver `MAPA` en
`seed-contenido.ts`). Para añadir contenido:

1. Crear o ampliar un archivo con un prefijo que ya esté en el `MAPA`
   —`dilemas-tono-4.json` entra como `subidas_de_tono` sin tocar el script—.
2. `npm --workspace frontend run test` valida ids repetidos, longitudes,
   niveles y textos duplicados **antes** de tocar Firebase.
3. `npm --workspace backend run seed -- --entorno=qa`, comprobar, y luego
   `--entorno=prod`.

El seed es idempotente y no borra nada, así que reejecutarlo es seguro. Sube
`versionBanco`, que es lo que invalida la caché de los dos teléfonos: sin ese
salto, el contenido nuevo no aparecería hasta que alguien limpiara el
almacenamiento del navegador.

## 14 · Correr los tests de Security Rules en Windows

Los emuladores de Firestore y Realtime Database son procesos Java. Sin Java en
el PATH, `firebase emulators:exec` falla con un mensaje que no menciona Java
para nada —`"C:\Program" no se reconoce como un comando`— y es fácil concluir
que el problema es el espacio en la ruta del proyecto. No lo es.

En esta máquina el JDK ya está instalado, solo fuera del PATH. Desde
PowerShell, y sin tocar nada del sistema:

```powershell
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-21.0.12.101-hotspot"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
npx firebase emulators:exec --project demo-nuestro-espacio --only auth,firestore,database "npm run test:reglas"
```

El `--project demo-nuestro-espacio` no es decorativo: el prefijo `demo-` es lo
que fuerza el modo emulador. Sin él, el SDK intentaría hablar con un proyecto
real.

## 15 · Duración del ciclo: de dónde sale el número

La app usa una duración de ciclo para predecir la ovulación, la ventana fértil
y la próxima regla. Sale de cuatro sitios, en este orden de autoridad:

| Origen | Cuándo manda | Lo que dice la pantalla |
|---|---|---|
| `manual` | el modo está en «La defino yo» | «porque los definiste tú» |
| `promedio` | hay al menos dos reglas registradas | «promedio de N ciclos» |
| `declarado` | sin registros, pero ella puso un valor | «los que pusiste, aún sin registros» |
| `defecto` | no hay nada | «28 días por defecto» |

Los cuatro casos se dicen en voz alta en la pantalla a propósito: «ciclo de 31
días» sin más no distingue un dato medido de una suposición, y de ese número
sale una predicción de fertilidad.

En modo manual se sigue calculando el promedio real y se muestra si difiere.
Ocultarlo sería decidir por ella que su propio dato no importa.

Límites: 21 a 45 días. 21-35 es el rango que la literatura considera normal;
se admite hasta 45 porque los ciclos largos existen —adolescencia, SOP— y una
app que no deja registrar la realidad de alguien no le sirve a esa persona.
Por encima de 35 la pantalla avisa de que conviene consultarlo.

⚠️ Las reglas de `/ciclo/config` aceptan el documento **sin** `duracionCiclo`
ni `modoCiclo`. Es deliberado: un dispositivo con la página anterior en caché
sigue enviando solo los dos campos viejos durante los minutos que dure esa
caché, y exigirlos convertiría eso en un «no se pudo guardar» sin explicación.

## 16 · Reglas que no se rompen nunca

| Regla | Motivo |
|---|---|
| ⛔ No actualizar a plan **Blaze** | Spark corta el servicio al agotar cuota; Blaze factura. Es la garantía de costo $0 |
| ⛔ No copiar datos de PROD a QA/DESA | Los perfiles y respuestas son lo más sensible del sistema |
| ⛔ No guardar los códigos en el repositorio | Es público. Van en un gestor de contraseñas |
| ⛔ No sacar un Service Account de `backend/secrets/` | Ver sección 3 |
| ⛔ No usar `--entorno=prod` sin leer el banner rojo | El script exige teclear el project id a propósito |
