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
 * reCAPTCHA Enterprise (App Check). Toca CUATRO directivas, y hasta que no se
 * probó desplegado no quedó claro que fueran cuatro:
 *
 *   script-src   carga enterprise.js desde google.com
 *   img-src      el distintivo trae imágenes de gstatic
 *   frame-src    el distintivo vive en un iframe de google.com
 *   connect-src  hace fetch a google.com/recaptcha/enterprise/clr  ← el que faltaba
 *
 * Sin el último, el SDK no consigue token y Firebase avisa con un genérico
 * "Provided AppCheck credentials are invalid", que no menciona la CSP por
 * ningún lado. Mientras el enforcement está en «sin aplicar» no se nota nada:
 * la aplicación funciona igual. Se cae entera el día que lo actives.
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

  ['connect-src', "'self'", 'https://*.googleapis.com', ...RECAPTCHA, ...RTDB,
   'wss://*.firebaseio.com', 'wss://*.firebasedatabase.app'].join(' '),

  // App Check (reCAPTCHA) muestra su distintivo en un iframe de google.com.
  "frame-src 'self' https://www.google.com",

  "base-uri 'self'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');
