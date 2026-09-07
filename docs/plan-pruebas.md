# Plan de pruebas — nuestro-espacio

```bash
npm run test          # typecheck + dominio + reglas (necesita los emuladores)
npm run typecheck     # astro check
npm run test:dominio  # vitest sobre funciones puras (sin red)
npm run test:reglas   # @firebase/rules-unit-testing contra los emuladores
```

**Estado actual: 0 errores de tipos · 34 tests de dominio · 67 tests de reglas.**

---

## 1 · Por qué estas tres capas

| Capa | Qué prueba | Coste |
|---|---|---|
| **Typecheck** | Que el código es coherente consigo mismo | segundos |
| **Dominio** | Lógica pura: ángulos, anti-repetición, fechas, códigos | milisegundos, sin red |
| **Reglas** | **El servidor.** Carga los mismos `.rules` que se despliegan | ~25 s, necesita emuladores |

Los tests de reglas son los que importan de verdad: el frontend es código público
que cualquiera puede modificar, así que la única garantía real está en el servidor.

---

## 2 · Invariantes de seguridad cubiertas

| # | Invariante | Dónde |
|---|---|---|
| S1 | Un dispositivo sin vínculo no lee **nada** | ambos |
| S2 | No se alcanza el espacio de otra pareja aunque se adivine el id (IDOR) | firestore |
| S3 | Los códigos de vinculación **no se leen jamás**, ni por un miembro | ambos |
| S4 | Un código incorrecto no vincula; el de A no sirve para el asiento de B | ambos |
| S5 | El vínculo es de escritura única: no se cambia de persona | ambos |
| S6 | Nadie lee el vínculo de otro dispositivo | ambos |
| S7 | **Con un solo voto emitido, NADIE puede leer los votos** | database |
| S8 | **Falsear `votosEmitidos` no abre la lectura** | database |
| S9 | No se puede votar por la otra persona ni cambiar el voto | database |
| S10 | El segundo aparato de la misma persona tampoco vota dos veces | database |
| S11 | Los contadores solo aceptan +1 exacto | firestore |
| S12 | Los timestamps de cliente se rechazan | ambos |
| S13 | Los campos no declarados se rechazan (inyección) | firestore |
| S14 | Los textos con `<` o `>` se rechazan en el servidor | ambos |
| S15 | Historial y auditoría son inmutables | firestore |
| S16 | No se lanza un giro nuevo mientras hay uno en curso | database |
| S17 | Un giro colgado >30 s se puede reemplazar (auto-sanación) | database |
| S18 | Desde el banner solo se toca la fecha, no el organizador | firestore |
| S19 | Las rutas no declaradas están cerradas por defecto | ambos |

### Prueba de mutación

Los tests que pasan a la primera no prueban nada por sí solos. Se verificó
eliminando el portero de `/votos` en las reglas: **fallaron exactamente los 4
tests de votación ciega y ningún otro**. La suite detecta la regresión y es
precisa, no frágil.

Conviene repetirlo al tocar reglas críticas: romperla a propósito y comprobar
que la alarma suena donde debe.

---

## 3 · Pruebas manuales ejecutadas

Casos que hoy no automatizo porque requieren dos navegadores reales. Están
documentados para poder repetirlos igual.

### C1 · Clics simultáneos en la ruleta (condición de carrera)
1. Abrir `/ruleta` en dos navegadores.
2. Programar el clic en ambos para el mismo instante.
3. **Esperado:** una gana; la otra muestra *"Se adelantó tu pareja"*; **ambas ven el mismo resultado**; el contador sube **+1**, no +2.
> Este caso destapó un bug real: con dos pestañas de la *misma* persona, ambas
> se creían responsables de anotar y el contador subía +2. Se corrigió con una
> transacción de cierre.

### C2 · Multi-dispositivo y presencia
1. Abrir la app en dos pestañas → *"en 2 dispositivos"*, en línea.
2. Cerrar una → sigue **En línea**, contador a 1.
3. Cerrar la última → `conexiones: 0` y el **servidor** sella `ultimaConexion`.
> Destapó otro bug: el campo `estado` mentía con varios aparatos abiertos. Se eliminó.

### C3 · Desconexión abrupta a mitad de giro
1. Girar y cerrar la pestaña antes de que termine.
2. **Esperado:** a los 30 s cualquiera puede girar de nuevo (auto-sanación, S17). Cubierto también por test automático.

### C4 · Espiar el voto de la pareja
1. Votar solo con una persona.
2. Falsear `votosEmitidos = 2` desde fuera de la app.
3. **Esperado:** la app pide los votos, el servidor deniega, no se filtra nada.
> Verificado. Destapó un tercer bug: RTDB **cancela** la suscripción al denegar
> y no reintenta, así que la revelación se quedaba colgada. Se añadió reintento.

### C5 · Independencia de categorías en preguntas
1. Sacar una carta en *Mix*.
2. Cambiar a *Profundas*, *Subidas de tono*, *Supuestos*.
3. **Esperado:** ninguna arrastra la carta de Mix; cada categoría conserva la suya.

### C6 · Perfiles
1. Rellenar el propio: nombre, nacimiento, gustos, hobbies, alergias → guardar.
2. **Esperado:** la pareja lo ve en su pestaña, **en solo lectura**; las alergias destacadas.
3. Poner fecha de inicio → contador en años/meses/días y días al aniversario.
4. **Esperado:** los intereses en común se calculan solos, ignorando mayúsculas y tildes.

### C7 · Panel de administración
1. Crear una pregunta → aparece en el banco.
2. Intentar crear una con `<script>` → **rechazada** ("No se admiten los caracteres < ni >").
3. Ocultar una pregunta → deja de salir en el juego, pero el documento sigue existiendo.
4. Limpiar una colección → exige **doble confirmación** y queda registrada en la auditoría.

### C8 · Sorteo encadenado y banner
1. Girar en `/ruleta` → panorama → arranca sola la segunda rueda → organizador.
2. Ir a `/inicio` → banner con actividad y responsable.
3. Poner fecha → cuenta atrás y fecha exacta en horario de Santiago.

### C9 · Transporte degradado de Realtime Database
La app se probó en un navegador incrustado donde el **WebSocket no llega a
establecerse**. Es el caso que descubrió la CSP incompleta: el SDK no falla,
cae a *long polling* por JSONP, y la política bloqueaba ese `<script>`.

Cómo reproducirlo sin ese navegador: en DevTools → Network, bloquear el
patrón `wss://*`, recargar y comprobar que la app **carga igual**. Si se
queda en «Cargando», mirar la consola: si hay violaciones de CSP contra
`.../.lp?start=t`, falta un origen en `script-src`.

Merece un caso propio porque es un fallo **intermitente por red**: en una
conexión doméstica normal el WebSocket funciona y todo parece correcto.

---

## 4 · Lo que todavía NO está cubierto

Se dice explícitamente en lugar de dar una falsa sensación de cobertura:

| Hueco | Riesgo | Plan |
|---|---|---|
| **E2E con dos navegadores** (Playwright) | Medio | Automatizaría C1, C2 y C4 |
| **Contenido de los arrays** de perfiles | Bajo | Rules no itera listas; solo Zod en cliente |
| **Rendimiento con catálogos grandes** | Bajo | Con 20 planes y 20 preguntas no aplica |
| **Accesibilidad automatizada** (axe) | Medio | Hoy solo hay revisión manual: foco visible, `aria-live`, `prefers-reduced-motion` |
| **Perfiles y Panel de Admin** | Medio | Construidos y probados a mano; sin cobertura automática todavía |
| **La CSP contra el navegador real** | Bajo | Los tests comprueban la cadena de la política, no que el navegador la acepte. Un origen que falte solo se ve desplegado (ver C9) |

---

## 5 · Requisito para ejecutar los tests de reglas

Los emuladores deben estar arriba:

```bash
npm run emu
```

Usan un `projectId` propio (`demo-reglas-test`) y limpian entre casos, así que
no tocan los datos de desarrollo.
