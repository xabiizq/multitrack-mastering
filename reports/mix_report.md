# Informe de mezcla y mastering

## Análisis previo desde cero

| Pista | Duración | Fs | Canales | Peak dBFS | RMS dBFS | LUFS aprox. | Crest dB | Corr. L/R | Graves/medios bajos/medios/agudos dB | Transitorios | Ruido borde |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Evolving_Circles_RAW.wav | 140.63s | 24000 | 1 | -0.88 | -21.75 | -22.45 | 18.62 | 1.00 | -29.6/-26.6/-36.0/-99.7 | -20.1 | -90.5 |
| Sharp_Chorus_RAW.wav | 141.31s | 24000 | 1 | -7.02 | -25.76 | -26.46 | 18.65 | 1.00 | -32.4/-31.1/-39.9/-103.1 | -23.5 | -93.4 |
| Neon_GB_RAW.wav | 130.05s | 24000 | 2 | -11.42 | -28.30 | -29.00 | 16.90 | 0.99 | -30.7/-35.5/-47.1/-106.2 | -32.3 | -37.6 |


## Función musical y problemas detectados

- `Evolving_Circles_RAW.wav`: elemento atmosférico principal. La pista contiene energía sostenida, estéreo moderado y pocos transitorios bruscos; pedía profundidad y un eco de cinta audible. Se recortó subgrave no musical, se suavizó el extremo superior y se convirtió en la fuente principal de tape echo más cámara oscura.
- `Sharp_Chorus_RAW.wav`: soporte armónico. Es más débil en nivel y necesita reconocimiento sin ocupar el primer plano. Se adelgazó la zona baja/media-baja para no enmascarar a Evolving Circles ni a la base.
- `Neon_GB_RAW.wav`: base rítmica. Presenta mayor actividad transitoria y podía dominar la mezcla si se subía en exceso. Se aplicó automatización de fader por bloques para controlar pasajes fuertes antes de cualquier saturación.

## Balance, panorama y automatización

1. Primero se fijó una mezcla de niveles: Evolving como plano principal, Sharp Chorus detrás como colchón armónico y Neon GB como base integrada.
2. La automatización se aplicó únicamente a `Neon_GB_RAW.wav`, con reducciones suaves de hasta aproximadamente 2.2 dB en bloques rítmicamente más densos. Esto evita que la batería domine sin usar compresión agresiva.
3. El panorama es natural y moderado: Evolving apenas hacia la izquierda, Sharp Chorus apenas hacia la derecha y Neon GB prácticamente centrado. La compatibilidad mono se comprobó mediante correlación y pico mono.

## Procesamiento por pista

| Pista | Nivel/pan | EQ | Dinámica | Saturación/color | Espacio |
|---|---|---|---|---|---|
| Evolving Circles | -1.6 dB, 10% izquierda | HP 32 Hz, recorte suave bajo 145 Hz, LP 11.8 kHz | Sin compresor | `tanh` leve tipo cinta/consola | Tape echo 430 ms con wow/flutter, feedback 0.34, filtrado a 2.75 kHz y cámara oscura |
| Sharp Chorus | -6.2 dB, 8% derecha | HP 42 Hz, recorte bajo 260 Hz, LP 7.6 kHz | Sin compresor | Saturación un poco más cálida | Cámara secundaria muy baja |
| Neon GB | -4.2 dB, casi centro | HP 27 Hz, recorte bajo 92 Hz, LP 9.8 kHz | Automatización de ganancia, no compresión | Saturación mínima | Sin reverb dedicada para mantener base firme |

## Bus master y mastering

- Bus de mezcla: saturación de consola/cinta muy ligera y normalización conservadora a -3.2 dBFS de pico de muestra.
- Master: filtrado superior suave a 15.5 kHz, saturación mínima y ganancia final con techo de -1.0 dBFS como aproximación conservadora a -1 dBTP.
- No se usó limitación moderna ni compresión glue evidente porque el objetivo era dinámica, textura y profundidad de finales de los 60.

## Mediciones posteriores

| Archivo | Duración | Peak dBFS | RMS dBFS | LUFS aprox. | Crest dB | Corr. L/R | Pico mono dBFS | Graves/medios bajos/medios/agudos dB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| outputs/mix.wav | 141.31s | -3.20 | -6.42 | -7.12 | 3.22 | 1.00 | n/a | -6.4/-32.7/-42.0/-105.6 |
| outputs/master.wav | 141.31s | -12.51 | -15.70 | -16.40 | 3.19 | 1.00 | -12.51 | -15.7/-40.8/-50.1/-113.7 |

## Notas de reproducibilidad

El proceso no modifica ningún WAV de entrada. Para que el DSP basado solo en biblioteca estándar sea práctico, las fuentes de 96 kHz se renderizan determinísticamente a 24 kHz conservando la duración completa. Las mediciones de LUFS y true peak son aproximadas porque se calculan sin librerías externas ni sobremuestreo dedicado; por eso se dejó margen conservador y se priorizó la intención musical sobre la maximización.
