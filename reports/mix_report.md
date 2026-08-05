# Informe de mezcla y master automáticos

## Análisis previo

| Pista | Duración | Fs | Canales | Pico dBFS | RMS dBFS | LUFS aprox. | Corr. L/R | Balance espectral low/mid/high dB |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Evolving Circles_1.wav | 140.97s | 96000 | 2 | -1.23 | -20.24 | -20.94 | 0.89 | -24.5/-26.7/-98.0 |
| Sharp Chorus_1.wav | 140.97s | 96000 | 1 | -10.16 | -28.31 | -29.01 | 1.00 | -31.8/-34.9/-105.5 |
| Neon GB_1.wav | 130.05s | 96000 | 2 | -4.05 | -21.06 | -21.76 | 0.99 | -22.0/-31.9/-99.1 |

## Procesamiento aplicado

| Pista | Ganancia | Paneo | EQ correctiva | Compresión | Saturación |
|---|---:|---:|---|---|---|
| Evolving Circles_1.wav | -2.0 dB | 16% izquierda | Paso alto 28 Hz; recorte suave bajo 120 Hz para dejar aire al grave global | Ninguna | Curva tanh extremadamente sutil |
| Sharp Chorus_1.wav | -4.5 dB | Centro | Paso alto 28 Hz; recorte suave bajo 220 Hz para reducir enmascaramiento | Ninguna | Curva tanh extremadamente sutil |
| Neon GB_1.wav | -1.5 dB | 14% derecha | Paso alto 24 Hz; sin otros cambios | Ninguna | Curva tanh extremadamente sutil |

## Espacio, bus y master

- Reverb/delay: cámara oscura algorítmica de retardos cortos y medios, envío aproximado -29 dB, mezclada muy baja para profundidad setentera sin borrar transitorios.
- Limitación/maximización: no se usó maximizador. El master se normalizó con techo de pico de muestra equivalente a -1 dBFS como aproximación conservadora a -1 dBTP.
- Compresión de bus: ninguna. Se priorizó dinámica, transitorios y sensación orgánica.
- Saturación de master: curva transformador/cinta muy leve para cohesión y calidez.

## Mediciones posteriores

| Archivo | Duración | Pico dBFS | RMS dBFS | LUFS aprox. | Corr. L/R | Pico mono dBFS | Balance low/mid/high dB |
|---|---:|---:|---:|---:|---:|---:|---|
| outputs/mix.wav | 140.97s | -3.00 | -21.14 | -21.84 | 0.93 | n/a | -23.7/-29.0/-100.4 |
| outputs/master.wav | 140.97s | -1.00 | -17.91 | -18.61 | 0.93 | -1.06 | -20.5/-25.8/-97.1 |

## Decisiones artísticas

La mezcla conserva las pistas alineadas desde el inicio y extiende el archivo final hasta la duración completa de la pista más larga. La imagen estéreo es prudente: centro estable, desplazamientos laterales moderados y comprobación de correlación positiva para compatibilidad mono. El tratamiento evita estética pop/EDM moderna: no hay compresión audible, excitación agresiva ni limitación fuerte.

## Limitaciones del proceso automático

Las mediciones de LUFS y true peak son aproximaciones con herramientas de biblioteca estándar, no reemplazan un medidor ITU-R BS.1770 ni sobremuestreo dedicado. La detección espectral se basa en bandas amplias y no en escucha humana; por eso las decisiones se mantuvieron conservadoras. La fase se estimó con correlación L/R y pico mono, no con análisis vectorial completo.
