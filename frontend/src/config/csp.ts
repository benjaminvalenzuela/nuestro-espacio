/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  CONTENT SECURITY POLICY
 *
 *  GitHub Pages no permite cabeceras HTTP personalizadas, así que la política
 *  viaja en un <meta>. Cubre script-src y connect-src —lo importante para XSS
 *  y para exfiltración de datos—; queda fuera `frame-ancestors`, que solo
 *  funciona como cabecera. Riesgo residual documentado en el Paso 2.
 *
 *  Vive en un módulo propio, y no dentro del layout, para que las decisiones
 *  de abajo sean verificables por un test: una CSP incompleta no rompe el
 *  build ni los tipos, rompe la aplicación desplegada y solo a veces.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Orígenes de Realtime Database. Los subdominios varían según la región. */
const RTDB = ['https://*.firebaseio.com', 'https://*.firebasedatabase.app'];

/**
 * reCAPTCHA Enterprise (App Check). Carga su script desde google.com, sus
 * recursos estáticos desde gstatic.com, y muestra el distintivo en un iframe.
 * Se listan los dos orígenes en img-src porque el distintivo trae imágenes:
 * una directiva corta aquí no da un error legible, deja la insignia rota o
 * —peor— impide obtener el token y tumba la app con el enforcement activado.
 */
const RECAPTCHA = ['https://www.google.com', 'https://www.gstatic.com'];

export const POLITICA_CSP = [
  "default-src 'self'",

  /**
   * Los dominios de RTDB están aquí, y no solo en connect-src, por un motivo
   * que no se ve en desarrollo: cuando el WebSocket no llega a establecerse
   * —red corporativa, proxy, navegador incrustado— el SDK cae a *long
   * polling*, que no usa fetch sino que INYECTA <script src=".lp?...">.
   *
   * Eso lo gobierna script-src, no connect-src. Sin estos orígenes la app
   * se queda cargando para siempre, y de forma intermitente: en la conexión
   * donde el WebSocket sí funciona, todo parece correcto.
   *
   */
  ['script-src', "'self'", ...RECAPTCHA, ...RTDB].join(' '),

  "style-src 'self' 'unsafe-inline'",
  ['img-src', "'self'", 'data:', ...RECAPTCHA].join(' '),
  "font-src 'self' data:",

  ['connect-src', "'self'", 'https://*.googleapis.com', ...RTDB,
   'wss://*.firebaseio.com', 'wss://*.firebasedatabase.app'].join(' '),

  // App Check (reCAPTCHA) muestra su distintivo en un iframe de google.com.
  "frame-src 'self' https://www.google.com",

  "base-uri 'self'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');
