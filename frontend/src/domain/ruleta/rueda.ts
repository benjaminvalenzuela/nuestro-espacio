import type { Giro } from '@shared/schemas/giro.schema';
import { estadoEn, anguloFinal, prefiereMenosMovimiento } from './animacionGiro';
import { ahoraServidor } from '../tiempo/relojServidor';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  LA RUEDA — dibujo y animación.
 *
 *  SVG y no canvas: escala sin pixelarse en cualquier pantalla, hereda los
 *  colores del tema (claro/oscuro) sin repintar nada, y el texto es texto de
 *  verdad — un lector de pantalla puede leerlo.
 *
 *  Cero HTML dinámico por concatenación: cada nodo se crea con la API del DOM
 *  y las etiquetas se asignan con textContent. Es la tercera capa anti-XSS,
 *  la que hace inofensivo cualquier nombre de panorama por raro que sea.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const NS = 'http://www.w3.org/2000/svg';
const RADIO = 100;
const TINTES = 4;

/** Punto del borde para un ángulo en grados, medido en horario desde las 12. */
function borde(grados: number): [number, number] {
  const r = (grados * Math.PI) / 180;
  return [RADIO * Math.sin(r), -RADIO * Math.cos(r)];
}

function acortar(texto: string, maximo: number): string {
  return texto.length <= maximo ? texto : `${texto.slice(0, maximo - 1)}…`;
}

export interface Rueda {
  pintar: (textos: string[]) => void;
  rotar: (grados: number) => void;
  destacar: (indice: number | null) => void;
}

export function crearRueda(svg: SVGSVGElement): Rueda {
  svg.setAttribute('viewBox', `${-RADIO - 6} ${-RADIO - 6} ${(RADIO + 6) * 2} ${(RADIO + 6) * 2}`);
  svg.setAttribute('role', 'img');

  const giratorio = document.createElementNS(NS, 'g');
  svg.replaceChildren(giratorio);

  let porciones: SVGPathElement[] = [];
  /** Etiquetas con su posición base, para poder contrarrotarlas en cada fotograma. */
  let etiquetas: { el: SVGTextElement; x: number; y: number }[] = [];
  let anguloActual = 0;

  function pintar(textos: string[]): void {
    giratorio.replaceChildren();
    porciones = [];
    etiquetas = [];

    const n = textos.length;
    if (n === 0) return;

    svg.setAttribute('aria-label', `Ruleta con ${n} opciones`);
    const paso = 360 / n;
    // Con una sola opción el arco degenera; se dibuja el disco completo.
    const arcoCompleto = n === 1;

    textos.forEach((etiqueta, i) => {
      const desde = i * paso;
      const hasta = (i + 1) * paso;

      const porcion = document.createElementNS(NS, 'path');
      if (arcoCompleto) {
        porcion.setAttribute(
          'd',
          `M 0 ${-RADIO} A ${RADIO} ${RADIO} 0 1 1 -0.01 ${-RADIO} Z`,
        );
      } else {
        const [x0, y0] = borde(desde);
        const [x1, y1] = borde(hasta);
        const arcoGrande = paso > 180 ? 1 : 0;
        porcion.setAttribute(
          'd',
          `M 0 0 L ${x0.toFixed(3)} ${y0.toFixed(3)} A ${RADIO} ${RADIO} 0 ${arcoGrande} 1 ${x1.toFixed(3)} ${y1.toFixed(3)} Z`,
        );
      }
      porcion.setAttribute('fill', `var(--rueda-${(i % TINTES) + 1})`);
      porcion.setAttribute('stroke', 'var(--superficie)');
      porcion.setAttribute('stroke-width', '0.8');
      giratorio.appendChild(porcion);
      porciones.push(porcion);

      const texto = document.createElementNS(NS, 'text');
      const centro = desde + paso / 2;
      const [tx, ty] = borde(centro).map((v) => v * 0.66) as [number, number];
      texto.setAttribute('x', tx.toFixed(2));
      texto.setAttribute('y', ty.toFixed(2));
      texto.setAttribute('text-anchor', 'middle');
      texto.setAttribute('dominant-baseline', 'middle');
      texto.setAttribute('font-size', n > 12 ? '5.5' : n > 7 ? '7' : '8.5');
      texto.setAttribute('font-weight', '600');
      texto.setAttribute('fill', 'var(--rueda-texto)');
      texto.textContent = acortar(etiqueta, n > 12 ? 11 : 14);
      giratorio.appendChild(texto);
      etiquetas.push({ el: texto, x: tx, y: ty });
    });

    // Se reaplica la rotación vigente para que las etiquetas nazcan derechas
    // aunque se repinte la rueda con un giro ya en curso.
    rotar(anguloActual);

    const eje = document.createElementNS(NS, 'circle');
    eje.setAttribute('r', '11');
    eje.setAttribute('fill', 'var(--superficie)');
    eje.setAttribute('stroke', 'var(--borde)');
    eje.setAttribute('stroke-width', '1.5');
    svg.appendChild(eje);
  }

  /**
   * Rota la rueda y CONTRARROTA las etiquetas.
   *
   * Sin esto, el texto gira con su porción y a mitad de la vuelta queda cabeza
   * abajo. Se vio enseguida en la ruleta de organización, que solo tiene dos
   * porciones: el nombre de abajo aparecía invertido. Aplicar a cada etiqueta
   * la rotación opuesta la deja siempre horizontal y legible, gire lo que gire
   * la rueda. Son pocos nodos de texto, así que hacerlo por fotograma no pesa.
   */
  function rotar(grados: number): void {
    anguloActual = grados;
    giratorio.style.transform = `rotate(${grados}deg)`;
    giratorio.style.transformOrigin = '0 0';

    for (const { el, x, y } of etiquetas) {
      el.setAttribute('transform', `rotate(${(-grados).toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)})`);
    }
  }

  function destacar(indice: number | null): void {
    porciones.forEach((p, i) => {
      const activa = indice === i;
      p.setAttribute('fill', activa ? 'var(--acento)' : `var(--rueda-${(i % TINTES) + 1})`);
      p.setAttribute('stroke-width', activa ? '1.6' : '0.8');
    });
  }

  return { pintar, rotar, destacar };
}

/**
 * Reproduce un giro.
 *
 * El ángulo NO se acumula fotograma a fotograma: se recalcula desde
 * (horaServidor − iniciadoEn). Consecuencia importante: si alguien abre la app
 * a mitad del giro, o recarga, o su navegador salta fotogramas, la rueda
 * aparece en la posición correcta. Es una transmisión en directo, no una
 * animación local que cada quien arranca por su cuenta.
 */
export function animarGiro(giro: Giro, rueda: Rueda, alTerminar: () => void): () => void {
  let raf = 0;
  let red = 0;
  let cancelado = false;
  let yaTermino = false;

  // Un único punto de salida: da igual quién llegue primero, el rAF o la red
  // de seguridad. alTerminar se ejecuta exactamente una vez.
  const rematar = () => {
    if (cancelado || yaTermino) return;
    yaTermino = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(red);
    rueda.rotar(anguloFinal(giro));
    rueda.destacar(giro.indiceGanador);
    alTerminar();
  };

  // Accesibilidad: quien pide menos movimiento ve el resultado sin la rueda
  // dando vueltas, pero conservando el suspense de la espera.
  if (prefiereMenosMovimiento()) {
    rueda.rotar(anguloFinal(giro));
    const restante = Math.max(0, giro.iniciadoEn + giro.duracionMs - ahoraServidor());
    const t = window.setTimeout(rematar, Math.min(restante, 1200));
    return () => {
      cancelado = true;
      window.clearTimeout(t);
    };
  }

  const paso = () => {
    if (cancelado || yaTermino) return;
    const { angulo, terminado } = estadoEn(giro, ahoraServidor());
    rueda.rotar(angulo);
    if (terminado) rematar();
    else raf = requestAnimationFrame(paso);
  };

  paso();

  // ═══ RED DE SEGURIDAD ═══
  // requestAnimationFrame se CONGELA en pestañas de segundo plano. Se descubrió
  // probando contra la nube: bastaba cambiar de pestaña a mitad del giro para
  // que la animación se quedara parada y el resultado no se anotara nunca — el
  // giro se quedaba colgado hasta que la auto-sanación de 30 s lo liberaba.
  //
  // Los temporizadores sí corren en segundo plano (con menos precisión, pero
  // corren). Este remata el giro pase lo que pase, mire el usuario o no.
  const restante = Math.max(0, giro.iniciadoEn + giro.duracionMs - ahoraServidor());
  red = window.setTimeout(rematar, restante + 400);

  return () => {
    cancelado = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(red);
  };
}
