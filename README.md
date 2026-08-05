# Multitrack Mastering

Mezcla y masterización reproducible de los tres WAV RAW ubicados en `audio/`, con una estética inspirada en estudios analógicos de 1967-1970: cinta, consola, cámara/plate oscura, tape echo, medios musicales y dinámica amplia.

## Entradas

- `audio/Evolving_Circles_RAW.wav`
- `audio/Sharp_Chorus_RAW.wav`
- `audio/Neon_GB_RAW.wav`

Los archivos originales no se sobrescriben ni se modifican.

## Requisitos

Solo se utiliza Python 3 y su biblioteca estándar. No hacen falta plugins propietarios, DAW, NumPy, SciPy ni ffmpeg. Las fuentes de 96 kHz se procesan y exportan a 24 kHz para mantener un render reproducible y práctico sin dependencias externas.

## Render

```bash
python3 process_audio.py
```

## Salidas

- `outputs/mix.wav`: mezcla estéreo con headroom.
- `outputs/master.wav`: master dinámico con techo conservador de -1 dBFS/-1 dBTP aproximado y sonoridad orientativa en el rango pedido, priorizando dinámica cuando ambas metas entran en conflicto.
- `reports/mix_report.md`: análisis previo, decisiones de mezcla, procesamiento por pista, mediciones posteriores y limitaciones.

## Enfoque sonoro

El script construye primero un balance de niveles y después aplica tratamiento específico por pista. `Evolving_Circles_RAW.wav` recibe el rol atmosférico principal con tape echo largo, oscuro y degradado; `Sharp_Chorus_RAW.wav` queda como soporte armónico reconocible; `Neon_GB_RAW.wav` actúa como base rítmica controlada mediante automatización de volumen suave para que la batería no domine.
