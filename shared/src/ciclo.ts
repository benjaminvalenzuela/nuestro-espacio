/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  CICLO MENSTRUAL · cálculo de fases
 *
 *  ⚠️ ESTO NO ES UN MÉTODO ANTICONCEPTIVO NI UN DIAGNÓSTICO.
 *
 *  Lo que hay aquí es aritmética de calendario sobre las fechas que ustedes
 *  anotan. Predice igual que predice una app comercial —promediando ciclos
 *  pasados— y falla igual: el estrés, un viaje, una enfermedad o un cambio
 *  hormonal mueven la ovulación varios días sin avisar. La ventana fértil que
 *  se dibuja es una estimación, no una certeza, y la app lo dice en pantalla.
 *
 *  DECISIONES QUE IMPORTAN:
 *
 *  · Todo se calcula en DÍAS CIVILES, sobre cadenas 'AAAA-MM-DD', nunca con
 *    aritmética de milisegundos. Restar timestamps parece más simple hasta que
 *    llega el cambio de hora: en Chile hay días de 23 y de 25 horas, y dividir
 *    por 86.400.000 desplaza el calendario un día justo en esas semanas.
 *
 *  · El ciclo promedio sale de los INTERVALOS REALES entre menstruaciones
 *    anotadas, no de un 28 de manual. Si sus ciclos duran 31 días, la
 *    predicción se ajusta sola tras un par de registros.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const SINTOMAS = [
  { id: 'colicos', etiqueta: 'Cólicos', emoji: '😖', grupo: 'cuerpo' },
  { id: 'dolor_cabeza', etiqueta: 'Dolor de cabeza', emoji: '🤕', grupo: 'cuerpo' },
  { id: 'dolor_espalda', etiqueta: 'Dolor de espalda', emoji: '🦴', grupo: 'cuerpo' },
  { id: 'pechos_sensibles', etiqueta: 'Pechos sensibles', emoji: '💗', grupo: 'cuerpo' },
  { id: 'hinchazon', etiqueta: 'Hinchazón', emoji: '🎈', grupo: 'cuerpo' },
  { id: 'nauseas', etiqueta: 'Náuseas', emoji: '🤢', grupo: 'cuerpo' },
  { id: 'mareo', etiqueta: 'Mareo', emoji: '💫', grupo: 'cuerpo' },
  { id: 'acne', etiqueta: 'Acné', emoji: '🔴', grupo: 'cuerpo' },
  { id: 'cansancio', etiqueta: 'Cansancio', emoji: '😴', grupo: 'energia' },
  { id: 'insomnio', etiqueta: 'Insomnio', emoji: '🌙', grupo: 'energia' },
  { id: 'con_energia', etiqueta: 'Con energía', emoji: '⚡', grupo: 'energia' },
  { id: 'antojos', etiqueta: 'Antojos', emoji: '🍫', grupo: 'energia' },
  { id: 'feliz', etiqueta: 'Feliz', emoji: '😄', grupo: 'animo' },
  { id: 'motivada', etiqueta: 'Motivada', emoji: '🚀', grupo: 'animo' },
  { id: 'tranquila', etiqueta: 'Tranquila', emoji: '🌿', grupo: 'animo' },
  { id: 'sensible', etiqueta: 'Sensible', emoji: '🥺', grupo: 'animo' },
  { id: 'irritable', etiqueta: 'Irritable', emoji: '😤', grupo: 'animo' },
  { id: 'ansiosa', etiqueta: 'Ansiosa', emoji: '😰', grupo: 'animo' },
  { id: 'triste', etiqueta: 'Triste', emoji: '😢', grupo: 'animo' },
  { id: 'libido_alta', etiqueta: 'Con ganas', emoji: '🔥', grupo: 'animo' },
  { id: 'libido_baja', etiqueta: 'Sin ganas', emoji: '🧊', grupo: 'animo' },
] as const;

export type IdSintoma = (typeof SINTOMAS)[number]['id'];
export const IDS_SINTOMAS: readonly string[] = SINTOMAS.map((s) => s.id);

export const GRUPOS_SINTOMA = [
  { id: 'cuerpo', titulo: 'Cuerpo', emoji: '🩺' },
  { id: 'energia', titulo: 'Energía', emoji: '🔋' },
  { id: 'animo', titulo: 'Ánimo', emoji: '💭' },
] as const;

export type Fase = 'menstruacion' | 'folicular' | 'ovulacion' | 'lutea' | 'desconocida';

export const ETIQUETA_FASE: Record<Fase, string> = {
  menstruacion: 'Menstruación',
  folicular: 'Fase folicular',
  ovulacion: 'Ovulación',
  lutea: 'Fase lútea',
  desconocida: 'Sin datos',
};

/** Valores por defecto hasta que haya suficientes registros propios. */
export const CICLO_POR_DEFECTO = 28;
export const REGLA_POR_DEFECTO = 5;
/** La fase lútea dura de forma bastante estable ~14 días; el ciclo varía antes. */
export const DIAS_LUTEA = 14;

// ── Aritmética de días civiles ──────────────────────────────────────────────

const ES_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Número de día absoluto. Sirve para restar fechas sin tocar husos horarios. */
export function aDiaAbsoluto(iso: string): number | null {
  const m = ES_ISO.exec(iso);
  if (!m) return null;
  // Date.UTC es seguro aquí: solo se usa como contador, nunca se formatea.
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
}

export function desdeDiaAbsoluto(dias: number): string {
  const d = new Date(dias * 86400000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export function sumarDias(iso: string, dias: number): string {
  const base = aDiaAbsoluto(iso);
  return base === null ? iso : desdeDiaAbsoluto(base + dias);
}

export function diasEntre(desde: string, hasta: string): number | null {
  const a = aDiaAbsoluto(desde);
  const b = aDiaAbsoluto(hasta);
  return a === null || b === null ? null : b - a;
}

// ── Promedios a partir del historial real ───────────────────────────────────

export interface Promedios {
  ciclo: number;
  regla: number;
  /** Cuántos intervalos reales sostienen el promedio. 0 = todo es supuesto. */
  muestras: number;
}

/**
 * Promedia los intervalos entre menstruaciones.
 *
 * Se descartan los intervalos absurdos (menos de 15 o más de 60 días): casi
 * siempre son un registro olvidado y reaparecido meses después, y uno solo
 * bastaría para desplazar toda la predicción.
 */
export function calcularPromedios(
  iniciosSinOrdenar: string[],
  reglaDeclarada = REGLA_POR_DEFECTO,
): Promedios {
  const inicios = [...new Set(iniciosSinOrdenar)].sort();
  const intervalos: number[] = [];

  for (let i = 1; i < inicios.length; i++) {
    const d = diasEntre(inicios[i - 1]!, inicios[i]!);
    if (d !== null && d >= 15 && d <= 60) intervalos.push(d);
  }

  // Solo los seis últimos: un ciclo de hace dos años no dice nada de hoy.
  const recientes = intervalos.slice(-6);
  if (recientes.length === 0) {
    return { ciclo: CICLO_POR_DEFECTO, regla: reglaDeclarada, muestras: 0 };
  }

  const media = recientes.reduce((s, x) => s + x, 0) / recientes.length;
  return { ciclo: Math.round(media), regla: reglaDeclarada, muestras: recientes.length };
}

/** El comienzo de menstruación más reciente que no sea posterior a `fecha`. */
export function ultimoInicioHasta(inicios: string[], fecha: string): string | null {
  const previos = inicios.filter((i) => i <= fecha).sort();
  return previos.at(-1) ?? null;
}

// ── Fase de un día ──────────────────────────────────────────────────────────

export interface InfoDia {
  fase: Fase;
  /** Día del ciclo, 1 = primer día de menstruación. */
  diaDelCiclo: number | null;
  /** Estimación: la ovulación real se mueve. Nunca es una garantía. */
  fertil: boolean;
  /** true si el dato viene de un registro y no de una predicción. */
  confirmado: boolean;
}

/**
 * En qué fase cae un día.
 *
 * `menstruacionesRegistradas` son los días que ella marcó de verdad: esos
 * mandan sobre cualquier cálculo. Una predicción jamás debe pisar un hecho
 * anotado — si el calendario dice "te toca hoy" y ella marcó que llegó ayer,
 * lo que vale es ayer.
 */
export function faseDe(
  fecha: string,
  inicios: string[],
  promedios: Promedios,
  menstruacionesRegistradas: ReadonlySet<string> = new Set(),
): InfoDia {
  if (menstruacionesRegistradas.has(fecha)) {
    const inicio = ultimoInicioHasta(inicios, fecha);
    const dia = inicio ? (diasEntre(inicio, fecha) ?? 0) + 1 : null;
    return { fase: 'menstruacion', diaDelCiclo: dia, fertil: false, confirmado: true };
  }

  const inicio = ultimoInicioHasta(inicios, fecha);
  if (!inicio) return { fase: 'desconocida', diaDelCiclo: null, fertil: false, confirmado: false };

  const delta = diasEntre(inicio, fecha);
  if (delta === null || delta < 0) {
    return { fase: 'desconocida', diaDelCiclo: null, fertil: false, confirmado: false };
  }

  // Más de dos ciclos sin registrar: la predicción ya no vale nada.
  if (delta > promedios.ciclo * 2) {
    return { fase: 'desconocida', diaDelCiclo: null, fertil: false, confirmado: false };
  }

  const diaDelCiclo = (delta % promedios.ciclo) + 1;
  const diaOvulacion = Math.max(1, promedios.ciclo - DIAS_LUTEA);

  // Ventana fértil: los cinco días previos a la ovulación más el propio día.
  // Los espermatozoides sobreviven hasta cinco días; el óvulo, uno.
  const fertil = diaDelCiclo >= diaOvulacion - 5 && diaDelCiclo <= diaOvulacion + 1;

  let fase: Fase;
  if (diaDelCiclo <= promedios.regla) fase = 'menstruacion';
  else if (diaDelCiclo === diaOvulacion) fase = 'ovulacion';
  else if (diaDelCiclo < diaOvulacion) fase = 'folicular';
  else fase = 'lutea';

  return { fase, diaDelCiclo, fertil, confirmado: false };
}

/** Fecha estimada de la próxima menstruación. */
export function proximaMenstruacion(inicios: string[], promedios: Promedios): string | null {
  const ultimo = [...inicios].sort().at(-1);
  return ultimo ? sumarDias(ultimo, promedios.ciclo) : null;
}

// ── Rejilla del mes ─────────────────────────────────────────────────────────

export interface CeldaMes {
  fecha: string;
  dia: number;
  /** Hueco antes del día 1 para que la primera semana cuadre. */
  relleno: boolean;
}

/**
 * Construye la rejilla de un mes empezando en LUNES, que es como se lee un
 * calendario en Chile. `getUTCDay()` devuelve 0 para domingo, de ahí el ajuste.
 */
export function rejillaMes(anio: number, mes: number): CeldaMes[] {
  const primero = new Date(Date.UTC(anio, mes - 1, 1));
  const diaSemana = (primero.getUTCDay() + 6) % 7;
  const diasEnMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();

  const celdas: CeldaMes[] = [];
  for (let i = 0; i < diaSemana; i++) celdas.push({ fecha: '', dia: 0, relleno: true });

  const p = (n: number) => String(n).padStart(2, '0');
  for (let d = 1; d <= diasEnMes; d++) {
    celdas.push({ fecha: `${anio}-${p(mes)}-${p(d)}`, dia: d, relleno: false });
  }
  return celdas;
}

export const NOMBRES_MES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export const DIAS_SEMANA = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/**
 * Agrupa días sueltos marcados como menstruación en rachas, y devuelve el
 * primer día de cada una.
 *
 * Hace falta porque ella marca días, no ciclos: si anota el 3, 4, 5 y 6 de
 * septiembre, el inicio del ciclo es el 3, no cuatro inicios distintos. Un
 * hueco de un día se considera parte de la misma regla —es normal que un día
 * apenas manche— pero dos días seguidos sin marcar sí cortan la racha.
 */
export function iniciosDesdeDias(diasMarcados: string[]): string[] {
  const dias = [...new Set(diasMarcados)].sort();
  const inicios: string[] = [];

  for (let i = 0; i < dias.length; i++) {
    const actual = dias[i]!;
    if (i === 0) { inicios.push(actual); continue; }
    const hueco = diasEntre(dias[i - 1]!, actual);
    if (hueco === null || hueco > 2) inicios.push(actual);
  }
  return inicios;
}

// ── Explicación de las fases, en lenguaje llano ─────────────────────────────

/**
 * Qué es cada fase, contado como se lo contarías a alguien, no como lo cuenta
 * un prospecto.
 *
 * Vive aquí y no dentro del HTML del calendario por dos razones. La primera es
 * que un texto sobre salud debe poder revisarse en un solo sitio: si mañana hay
 * que matizar algo, se matiza una vez. La segunda es que los tests pueden
 * comprobar que ninguna fase se quedó sin explicar el día que se añada una.
 *
 * `sintomas` y `animo` son lo que SUELE pasar, no lo que tiene que pasar. Hay
 * quien no nota ninguna de estas cosas y está perfectamente sana, y hay quien
 * las nota todas. Por eso la pantalla lo dice con todas las letras en vez de
 * dejarlo implícito.
 */
export interface ExplicacionFase {
  fase: Exclude<Fase, 'desconocida'>;
  emoji: string;
  titulo: string;
  cuando: string;
  queEs: string;
  sintomas: string[];
  animo: string[];
  consejo: string;
}

export const EXPLICACION_FASES: ExplicacionFase[] = [
  {
    fase: 'menstruacion',
    emoji: '🩸',
    titulo: 'Menstruación',
    cuando: 'Del día 1 al 5 aproximadamente. El día 1 es el primer día de sangrado.',
    queEs:
      'El útero suelta el revestimiento que había preparado por si había embarazo. ' +
      'Como no lo hubo, lo desecha y empieza un ciclo nuevo. Las hormonas están en su ' +
      'punto más bajo de todo el mes, y eso se nota en el cuerpo y en el ánimo.',
    sintomas: ['Cólicos', 'Dolor de espalda o de cabeza', 'Cansancio', 'Hinchazón', 'Antojos'],
    animo: ['Con menos energía', 'Más sensible', 'Con ganas de que la dejen tranquila'],
    consejo:
      'Calor en la barriga, dormir lo que pida el cuerpo y cero culpa por bajar el ritmo. ' +
      'Si el dolor impide hacer vida normal, eso no es "normal": se consulta.',
  },
  {
    fase: 'folicular',
    emoji: '🌱',
    titulo: 'Fase folicular',
    cuando: 'Desde que termina la regla hasta la ovulación. Suele ser la mitad más larga.',
    queEs:
      'El cuerpo prepara el óvulo del mes y el estrógeno va subiendo poco a poco. ' +
      'Para mucha gente es la mejor parte del ciclo: la energía vuelve, la cabeza está ' +
      'despejada y el cuerpo responde mejor.',
    sintomas: ['Casi nada', 'Más energía física', 'Piel mejor'],
    animo: ['Optimista', 'Con ganas de hacer cosas', 'Sociable'],
    consejo:
      'Buen momento para lo que exija cabeza o cuerpo: entrenar fuerte, planes grandes, ' +
      'esa conversación que llevaba tiempo pendiente.',
  },
  {
    fase: 'ovulacion',
    emoji: '🥚',
    titulo: 'Ovulación',
    cuando: 'Unos 14 días ANTES de la próxima regla, no 14 días después de la última.',
    queEs:
      'El ovario suelta el óvulo. Dura muy poco —el óvulo vive alrededor de un día— pero ' +
      'la ventana fértil es más ancha, porque los espermatozoides aguantan hasta cinco ' +
      'días esperando. Por eso el calendario marca varios días y no uno.',
    sintomas: ['Flujo más elástico y transparente', 'Pinchazo leve en un costado', 'Pechos sensibles'],
    animo: ['Con más ganas', 'Más segura', 'Más habladora'],
    consejo:
      'Es el momento de mayor probabilidad de embarazo del ciclo. Si no lo buscan, ' +
      'protección; y recuerden que la fecha exacta se mueve, así que el calendario ' +
      'no sirve como anticonceptivo.',
  },
  {
    fase: 'lutea',
    emoji: '🌘',
    titulo: 'Fase lútea',
    cuando: 'Desde la ovulación hasta que llega la regla. Dura unos 14 días, bastante fijos.',
    queEs:
      'Sube la progesterona y el cuerpo prepara el terreno por si hubo embarazo. Si no lo ' +
      'hubo, en los últimos días cae en picado, y esa caída es la que provoca lo que ' +
      'todo el mundo llama síndrome premenstrual.',
    sintomas: ['Hinchazón', 'Pechos sensibles', 'Antojos de dulce o sal', 'Acné', 'Sueño raro'],
    animo: ['Más irritable', 'Ansiosa o triste sin motivo claro', 'Menos paciencia'],
    consejo:
      'Lo de "no es nada, son las hormonas" no ayuda: sí es algo, y es real. ' +
      'Sirve más bajar las exigencias de la semana y no dejar las discusiones ' +
      'importantes justo para estos días.',
  },
];
