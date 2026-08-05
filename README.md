# Multitrack mastering automático

Este repositorio contiene un proceso reproducible para mezclar y masterizar tres WAV de `audio/` con una estética abierta, cálida, orgánica y dinámica inspirada en krautrock, ambient primitivo, electrónica analógica, música cósmica y producciones electroacústicas de finales de los 60 y los 70.

## Entradas

- `audio/Evolving Circles_1.wav`
- `audio/Sharp Chorus_1.wav`
- `audio/Neon GB_1.wav`

Los archivos originales no se sobrescriben.

## Ejecución

```bash
python3 process_audio.py
```

## Salidas

- `outputs/mix.wav`: mezcla estéreo con margen dinámico y headroom.
- `outputs/master.wav`: master estéreo con pico máximo aproximado de -1 dBFS/-1 dBTP y sonoridad aproximada entre -16 y -14 LUFS si no perjudica la dinámica.
- `reports/mix_report.md`: análisis, procesamiento, mediciones y limitaciones.

## Enfoque

El script usa solo bibliotecas estándar de Python para mantener la reproducción simple en este entorno. Aplica análisis previo, balance musical, paneo moderado, EQ correctiva mínima, saturación muy sutil, una cámara oscura de retardos discretos y masterización sin maximización agresiva.
