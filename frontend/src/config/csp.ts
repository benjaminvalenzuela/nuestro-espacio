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
   * google.com y gstatic.com son para reCAPTCHA de App Check.
   */
  ['script-src', "'self'", 'https://www.google.com', 'https://www.gstatic.com', ...RTDB].join(' '),

  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",

  ['connect-src', "'self'", 'https://*.googleapis.com', ...RTDB,
   'wss://*.firebaseio.com', 'wss://*.firebasedatabase.app'].join(' '),

  // App Check (reCAPTCHA) abre su desafío en un iframe de google.com.
  "frame-src 'self' https://www.google.com",

  "base-uri 'self'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');
