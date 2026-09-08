/**
 * Aplica el tema guardado ANTES de que el navegador pinte nada.
 *
 * Vive en /public y se carga con <script src> síncrono, no como script inline,
 * por una razón concreta: la Content Security Policy de esta app declara
 * `script-src 'self'` sin 'unsafe-inline'. Un script escrito dentro del HTML
 * sería bloqueado en producción y el tema no se aplicaría —el mismo tipo de
 * fallo silencioso que ya se dio con el long polling y con reCAPTCHA.
 *
 * Al ser síncrono y estar en el <head>, se ejecuta antes del primer pintado:
 * quien abra la app de noche con el tema oscuro forzado no ve el fogonazo
 * blanco que daría aplicarlo desde un módulo diferido.
 */
(function () {
  try {
    var t = localStorage.getItem('nuestro-espacio:tema');
    if (t === 'claro') document.documentElement.setAttribute('data-tema', 'light');
    else if (t === 'oscuro') document.documentElement.setAttribute('data-tema', 'dark');
  } catch (e) {
    /* Sin preferencia accesible: manda el sistema operativo. */
  }
})();
