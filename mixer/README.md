# MICROPHON MIX 60s

Mezclador HTML local de `Evolving_Circles_RAW.wav`, `Sharp_Chorus_RAW.wav` y `Neon_GB_RAW.wav`. Mantiene un flujo inspirado en estudios analógicos de finales de los años 60: dinámica musical, transitorios naturales, saturación progresiva y escucha sin fatiga. No requiere paquetes, frameworks ni servicios externos.

## Abrir la aplicación

Desde la raíz del repositorio:

```bash
python3 -m http.server 8000
```

Abre `http://localhost:8000/mixer/`. Algunos navegadores bloquean los WAV desde `file://`; el servidor local evita esa restricción y el audio no sale del ordenador.

## Las tres rutas

### 1. MIX

`TRACKS → procesamiento de pistas → Tape Echo / Dark Chamber → suma → MIX BUS → MIX OUT`

Es la mezcla artística principal. Conserva volumen, panorama independiente, mute/solo, saturación de cinta, envíos y efectos, Presencia/Punch de Neon GB, nivel, drive, anchura y protección del bus existentes. MIX OUT existe antes de los dos masterings y puede escucharse y renderizarse solo.

La anchura usa una matriz Mid/Side equilibrada: `width = 1` conserva L/R, `width = 0` entrega mono centrado y hasta `1,5` aumenta moderadamente SIDE sin desplazar MID. Los cambios de controles actualizan los `AudioParam` del grafo activo con rampas cortas; no recrean las fuentes ni reinician el transporte.

Presencia/Punch de Neon GB mantiene dos bandas: cuerpo a **110 Hz** (hasta +4 dB) y ataque a **3,2 kHz** (hasta +6 dB). Cero es neutro. Está antes de volumen y panorama, y pertenece a la lógica compartida de escucha y render.

### 2. MASTER VINYL

`MIX BUS → control SIDE de graves → tonal shaping → cinta suave → glue → control de picos → VINYL OUT`

Esta ruta parte exactamente de MIX OUT sin modificar la mezcla original. Una matriz M/S conserva MID intacto y aplica al SIDE un *low shelf* progresivo de −9 dB alrededor de 130 Hz. No elimina graves ni convierte bruscamente la mezcla a mono. Después utiliza un pasa-altos suave a 24 Hz para subgrave técnico, una reducción de agudos de 1,2 dB desde 10,5 kHz, saturación de cinta mínima, compresión glue 1,6:1 con ataque de 35 ms y protección de picos moderada. No genera clicks, crackle, ruido de superficie, normalización ni maximización agresiva.

El WAV de vinilo **no lleva curva RIAA**. Esta preparación conservadora no sustituye las decisiones finales de la planta de corte; la ecualización RIAA corresponde al proceso de corte/reproducción y no debe imprimirse como EQ permanente en el master WAV entregado.

### 3. MASTER DIGITAL

`MIX BUS → tonal shaping → cinta suave → glue → control final de picos → DIGITAL OUT`

Es una alternativa para Spotify, Apple Music, YouTube y WAV digital que conserva la estética de los años 60. Aplica pasa-altos suave a 20 Hz, atenuación de solo 0,5 dB desde 12 kHz, saturación mínima, glue 1,8:1 con ataque de 25 ms y una protección final más precisa que Vinyl. No fija un objetivo LUFS, no normaliza y no busca volumen de *loudness war*.

## Escucha y comparación

**ESCUCHAR: MIX / MASTER VINYL / MASTER DIGITAL** selecciona una sola ruta. La conmutación cruza las ganancias durante unos 45 ms: no llama a `stop()`, `play()` o `seek()`, no recrea `BufferSourceNode` y no reconstruye el grafo. La escucha mono se aplica solo al monitor, después del selector.

No existe compensación automática de ganancia. Para una comparación crítica hay que tener en cuenta que una señal más alta puede percibirse como mejor aunque no lo sea.

## Medición

Cada pista muestra **VU + PEAK**. MIX tiene L/R antes de cualquier mastering; VINYL L/R y DIGITAL L/R están después de sus cadenas completas.

- **VU** calcula RMS de cada bloque de 1024 muestras y aplica balística distinta para subida y bajada. Representa energía media, no un pico ralentizado. **0 VU = −18 dBFS**, nivel nominal de trabajo de este mezclador; la lectura numérica se expresa respecto a 0 VU.
- **PEAK** busca la muestra de mayor valor absoluto del bloque, responde inmediatamente, la mantiene 700 ms y después cae. La lectura está en dBFS. Cuando alcanza `>= 0 dBFS`, el instrumento se ilumina claramente en rojo.

Los `AnalyserNode` son derivaciones de solo medición. La lectura y el dibujo ocurren con `requestAnimationFrame`, fuera del camino DSP, y no reconstruyen el grafo.

## Exportación

Los tres botones crean respectivamente:

- `microphon_mix.wav`: solamente MIX;
- `microphon_master_vinyl.wav`: MIX + MASTER VINYL;
- `microphon_master_digital.wav`: MIX + MASTER DIGITAL.

Todos usan el mismo constructor DSP que la escucha, los valores actuales, inicio cero, el mismo sample rate y exactamente el mismo número de frames. Conservan sincronización, panorama y efectos. No hay normalización posterior. Tras cada render la interfaz muestra duración, sample rate, peak L/R y RMS L/R; no etiqueta RMS como LUFS.

El encoder produce PCM estéreo de 16 bits. `OfflineAudioContext` no expone progreso muestra a muestra, por lo que la barra solo indica fases. Tape Echo y Dark Chamber son modelos sencillos y estables de Web Audio, no emulaciones exactas de hardware.

## Ajustes y diagnóstico

Guardar/Restaurar usa `localStorage`; Valores iniciales recupera los valores previos del mezclador. `microphonMixerDiagnostics()` permite comprobar en la consola la ruta de escucha, generación y número de fuentes, referencia VU, duración del peak hold, topología de salidas, matriz de anchura y bandas de Punch. Al mover un fader o cambiar escucha, `sourceGeneration` permanece constante.
