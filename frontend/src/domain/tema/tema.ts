/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  TEMA CLARO / OSCURO
 *
 *  Tres estados, no dos: claro, oscuro y "el que diga el sistema". El tercero
 *  es el que viene de fábrica y es el que la mayoría quiere — el teléfono ya
 *  cambia solo de noche y la app debería acompañarlo.
 *
 *  La preferencia se guarda por DISPOSITIVO, no en la base de datos. Es una
 *  decisión: uno puede querer la app oscura en el teléfono de noche y clara en
 *  el computador de día, y sincronizarla obligaría a los dos a compartir gusto.
 *
 *  El acceso a localStorage va envuelto porque puede fallar —modo privado,
 *  almacenamiento bloqueado— y quedarse sin tema guardado no puede impedir que
 *  la app arranque.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type Tema = 'claro' | 'oscuro' | 'sistema';

export const CLAVE_TEMA = 'nuestro-espacio:tema';

export const TEMAS: { id: Tema; etiqueta: string; emoji: string }[] = [
  { id: 'claro', etiqueta: 'Claro', emoji: '☀️' },
  { id: 'oscuro', etiqueta: 'Oscuro', emoji: '🌙' },
  { id: 'sistema', etiqueta: 'Automático', emoji: '🌗' },
];

export function leerTema(): Tema {
  try {
    const v = localStorage.getItem(CLAVE_TEMA);
    return v === 'claro' || v === 'oscuro' ? v : 'sistema';
  } catch {
    return 'sistema';
  }
}

/**
 * Escribe el atributo que gobierna los tokens de color.
 *
 * En 'sistema' se QUITA el atributo en vez de poner un valor: así vuelve a
 * mandar la media query del sistema operativo. Poner data-tema="sistema"
 * dejaría a la app en claro para siempre, porque el selector oscuro exige
 * `:not([data-tema='light'])` y nunca casaría con un valor desconocido.
 */
export function aplicarTema(tema: Tema): void {
  const raiz = document.documentElement;
  if (tema === 'sistema') raiz.removeAttribute('data-tema');
  else raiz.setAttribute('data-tema', tema === 'oscuro' ? 'dark' : 'light');
}

export function guardarTema(tema: Tema): void {
  try {
    if (tema === 'sistema') localStorage.removeItem(CLAVE_TEMA);
    else localStorage.setItem(CLAVE_TEMA, tema);
  } catch {
    // Sin persistencia: el tema dura lo que dure la pestaña. No es fatal.
  }
  aplicarTema(tema);
}

/** El siguiente en el ciclo claro → oscuro → automático. */
export function siguienteTema(actual: Tema): Tema {
  const orden: Tema[] = ['claro', 'oscuro', 'sistema'];
  return orden[(orden.indexOf(actual) + 1) % orden.length]!;
}

export function etiquetaDe(tema: Tema): { etiqueta: string; emoji: string } {
  const t = TEMAS.find((x) => x.id === tema) ?? TEMAS[2]!;
  return { etiqueta: t.etiqueta, emoji: t.emoji };
}

/**
 * Conecta un botón que rota entre los tres temas.
 *
 * Devuelve el tema activo tras montar, para que quien lo llame pueda pintar
 * cualquier otra cosa que dependa de él.
 */
export function montarBotonTema(boton: HTMLElement): Tema {
  let actual = leerTema();

  const pintar = () => {
    const { etiqueta, emoji } = etiquetaDe(actual);
    boton.textContent = emoji;
    boton.setAttribute('title', `Tema: ${etiqueta}`);
    boton.setAttribute('aria-label', `Cambiar tema. Actual: ${etiqueta}`);
  };

  boton.addEventListener('click', () => {
    actual = siguienteTema(actual);
    guardarTema(actual);
    pintar();
  });

  pintar();
  return actual;
}
