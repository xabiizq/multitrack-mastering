# Microphon Mix 60s — 4 Track

## Qué es

Es un mezclador de aspecto y sonido inspirado en un estudio de finales de los años 60. Funciona en el navegador, sin instalar programas, y permite mezclar **entre uno y cuatro archivos WAV**. No hace falta GitHub ni saber programación una vez que se recibe la carpeta distribuible.

## Preparar y cargar los WAV

Conserve siempre los originales. Exporte cada pista como WAV compatible (PCM es la opción más segura), preferiblemente con la misma frecuencia de muestreo. **Todos los WAV deben comenzar en el mismo punto temporal**: la aplicación los arranca juntos desde el segundo 0 y no intenta alinearlos.

1. Abra `index.html` en un navegador compatible. Si el navegador limita archivos locales, abra la carpeta mediante un servidor local sencillo.
2. Pulse **Cargar WAV** en PISTA 1, 2, 3 o 4 y elija el archivo.
3. Espere el mensaje de pista cargada antes de reproducir. Puede usar solo una pista; los demás canales permanecen apagados.

El nombre aparece bajo PISTA 1–4. Una pista nueva empieza neutral: volumen 0 dB, panorama centrado, Mute y Solo apagados, envíos a cero y saturación apenas perceptible. Si las duraciones difieren, el proyecto dura lo que el WAV más largo; los cortos terminan sin repetirse.

## Mezclar

- **Volumen** ajusta el nivel; **Panorama** coloca la pista entre izquierda y derecha.
- **Mute** silencia ese canal. **Solo** permite escuchar uno o varios canales seleccionados.
- **Presencia / Ataque** es bipolar: `0` es realmente neutro; los valores positivos aportan moderadamente articulación, presencia y definición al comienzo de las notas, y los negativos redondean el ataque para integrar la fuente con más suavidad. Combina un contorno ancho en medios-altos con tratamiento sutil del ataque y compensación de nivel, no un simple aumento de volumen.
- **Saturación cinta** añade progresivamente compresión y armónicos suaves.
- **Envío Tape Echo** manda cada pista al eco global. Sus mandos Wet, Tiempo, Feedback y Pérdida de agudos crean repeticiones oscuras, no un delay brillante.
- **Envío Dark Chamber** manda cada pista a una cámara oscura y orgánica. Wet, Duración y Tono controlan el efecto global.

Los cambios se aplican en tiempo real con transiciones cortas: no reinician las pistas.

Presencia / Ataque es una simplificación musical inspirada en decisiones históricas de micrófono, previo, ecualización, compresión y nivel de cinta. No pretende reproducir un mando concreto de una consola de 1967 ni comportarse como un diseñador de transitorios moderno.

## Medidores

**VU** indica el nivel medio aproximado con balística de instrumento; 0 VU corresponde a −18 dBFS. **Peak** reacciona a picos rápidos, los retiene brevemente y avisa en rojo al llegar a 0 dBFS. Los canales sin archivo mantienen ambos apagados. MIX L/R se mide antes del mastering.

## MIX, MASTER VINYL y MASTER DIGITAL

- **MIX** es la suma artística con canales, efectos y bus común.
- **MASTER VINYL** es la versión algo más redonda y cohesionada: reduce progresivamente solo el SIDE grave bajo unos 130 Hz, relaja suavemente el extremo alto desde 9 kHz, imprime más carácter de cinta y hace trabajar una compresión de ratio 1.65:1 con ganancia interna compensada. El control de picos conserva headroom y el WAV no lleva curva RIAA ni efectos de superficie.
- **MASTER DIGITAL** conserva el estéreo grave completo, mayor extensión espectral y algo más de ataque. Mantiene un shelf muy leve a 12 kHz, saturación menor, compresión 1.35:1 más lenta y protección de picos sin normalización ni maximización.

La diferencia no se obtiene subiendo el volumen digital: ambas cadenas compensan su ganancia de trabajo. Así, al igualar aproximadamente el RMS siguen distinguiéndose por transitorios, SIDE grave, extensión alta, saturación y cohesión.

Los botones de escucha cambian de ruta mediante un crossfade breve, sin detener el audio.

## Renderizar y guardar

Use **Renderizar MIX WAV**, **Renderizar MASTER VINYL WAV** o **Renderizar MASTER DIGITAL WAV**. Se crean respectivamente `microphon_mix.wav`, `microphon_master_vinyl.wav` y `microphon_master_digital.wav`, con la duración de la pista más larga y sin normalización automática. Después pulse el enlace de descarga. El diagnóstico de cada render muestra duración, sample rate, Peak y RMS L/R, además de Mid, Side y la relación Side/Mid.

**Guardar ajustes** conserva controles en `localStorage`; **Restaurar ajustes** los recupera y **Valores iniciales** vuelve al estado neutral. Por privacidad y por límites del navegador, los WAV completos no se guardan: tras recargar la página hay que seleccionarlos otra vez.

Los ajustes antiguos siguen siendo compatibles: si no contienen Presencia / Ataque, se restaura automáticamente a `0`.

## Distribución de la consola

En monitores grandes la mesa usa prácticamente todo el viewport: las cuatro pistas forman un banco equilibrado y MIX / MASTER ocupa una sección propia a la derecha. Los faders crecen con la altura disponible y los VU/Peak conservan prioridad visual. En pantallas medianas se reducen espacios y controles secundarios; cuando ya no cabe una consola manejable se conserva un ancho mínimo y se permite desplazamiento horizontal en vez de aplastar los canales.

## Privacidad

Todo —lectura, reproducción, mezcla y render— ocurre localmente en el navegador. No hay subidas, analytics, servicios web ni APIs externas; el audio no sale del ordenador.

## Compatibilidad y límites

Usa HTML, CSS, JavaScript clásico y Web Audio API. Necesita un navegador que implemente `AudioContext`, `OfflineAudioContext`, `StereoPannerNode`, `FileReader` y decodificación del WAV elegido. El encoder exporta PCM estéreo de 16 bits. Tape Echo y Dark Chamber son modelos sencillos y estables, no emulaciones exactas de hardware. La barra de render muestra fases, no progreso muestra a muestra.
