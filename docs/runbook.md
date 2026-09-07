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

## 6 · Reglas que no se rompen nunca

| Regla | Motivo |
|---|---|
| ⛔ No actualizar a plan **Blaze** | Spark corta el servicio al agotar cuota; Blaze factura. Es la garantía de costo $0 |
| ⛔ No copiar datos de PROD a QA/DESA | Los perfiles y respuestas son lo más sensible del sistema |
| ⛔ No guardar los códigos en el repositorio | Es público. Van en un gestor de contraseñas |
| ⛔ No sacar un Service Account de `backend/secrets/` | Ver sección 3 |
| ⛔ No usar `--entorno=prod` sin leer el banner rojo | El script exige teclear el project id a propósito |
