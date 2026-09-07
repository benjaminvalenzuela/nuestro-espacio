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

## 8 · Reglas que no se rompen nunca

| Regla | Motivo |
|---|---|
| ⛔ No actualizar a plan **Blaze** | Spark corta el servicio al agotar cuota; Blaze factura. Es la garantía de costo $0 |
| ⛔ No copiar datos de PROD a QA/DESA | Los perfiles y respuestas son lo más sensible del sistema |
| ⛔ No guardar los códigos en el repositorio | Es público. Van en un gestor de contraseñas |
| ⛔ No sacar un Service Account de `backend/secrets/` | Ver sección 3 |
| ⛔ No usar `--entorno=prod` sin leer el banner rojo | El script exige teclear el project id a propósito |
