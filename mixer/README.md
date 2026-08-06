# Microphon Mix 60s

Interfaz web local para mezclar `Evolving_Circles_RAW.wav`, `Sharp_Chorus_RAW.wav` y `Neon_GB_RAW.wav` desde el navegador, sin servidor, paquetes, frameworks ni servicios externos.

## Abrir la aplicación

La forma más compatible con navegadores antiguos es servir el repositorio con el servidor simple de Python:

```bash
python3 -m http.server 8000
```

Después abre:

```text
http://localhost:8000/mixer/
```

> Nota: algunos navegadores bloquean la carga de audio con `file://`. Si al abrir `mixer/index.html` directamente no cargan los WAV, usa el servidor local anterior. El audio nunca sale de tu ordenador.

## Uso básico

1. Espera a que el indicador muestre **“Tres WAV cargados y listos”**.
2. Pulsa **Play** para reproducir las tres pistas sincronizadas.
3. Usa la barra de posición para mover el cursor de reproducción.
4. Pulsa **Stop** para detener la mezcla y volver al inicio.
5. Ajusta cada canal:
   - volumen;
   - panorama;
   - mute;
   - solo;
   - envíos disponibles a Tape Echo y/o Dark Chamber;
   - saturación de cinta;
   - presencia/punch moderado en Neon GB.
6. Ajusta los efectos globales y el master.
7. Pulsa **Renderizar WAV** para generar la mezcla completa.
8. Cuando termine el render, usa **Descargar WAV**. El archivo se descarga como `microphon_mix_60s.wav`.

## Valores iniciales

Los valores iniciales siguen la intención de `process_audio.py`:

- Evolving Circles: -1.6 dB, panorama 23 % derecha, saturación suave, Tape Echo 430 ms con feedback moderado y repeticiones oscuras, más cámara oscura.
- Sharp Chorus: -6.2 dB, panorama 23 % izquierda, soporte armónico con cámara secundaria y saturación cálida.
- Neon GB: -1.2 dB, centro, nivel aumentado +3 dB respecto a la versión previa, saturación mínima y presencia/punch muy moderado.
- Master: techo aproximado de -1 dBFS, limitación conservadora y drive ligero. La anchura estéreo está fijada temporalmente en 1,0.

## Persistencia

- **Guardar ajustes** almacena la configuración en `localStorage` del navegador.
- **Restaurar ajustes** recupera la configuración guardada.
- **Valores iniciales** vuelve a los parámetros base de la mezcla actual.

## Qué procesa el render

El render usa `OfflineAudioContext` y aplica los mismos controles audibles de la reproducción:

- niveles y panoramas por canal;
- mute y solo;
- Tape Echo con tiempo, feedback, filtro oscuro y wet global;
- Dark Chamber con cantidad, duración y tono oscuro;
- saturación por canal;
- presencia/punch moderado para Neon GB;
- nivel, drive, limitador, bypass y escucha mono del master.

No se genera MP3 y no se sobrescriben los WAV RAW originales.

### Corrección del panorama por pista

Cada canal dispone de un nodo de panorama estéreo propio con ley *equal-power*: `-1` envía la pista completamente a la izquierda, `0` la mantiene centrada y `+1` la envía completamente a la derecha. El panorama se aplica antes de alimentar Tape Echo y Dark Chamber y antes de sumar la pista al master, por lo que ambos buses conservan la posición estéreo de la señal de origen y ajustar un canal no modifica los demás.

El master ya no reconstruye los canales mediante Mid/Side: la ruta procesada conserva el panorama exactamente igual que la ruta de bypass. La anchura estéreo queda fijada en `1.0` y su control está temporalmente desactivado hasta disponer de una implementación fiable.

### Reproducción en tiempo real

El grafo de Web Audio permanece activo durante toda la reproducción. Los faders y conmutadores actualizan directamente los `AudioParam` de los nodos existentes, sin detener las fuentes, volver a crear `BufferSourceNode` ni mover el transporte. Volumen, panorama, mute/solo, envíos, efectos y master se aplican prácticamente al instante.

Los parámetros compatibles usan `cancelScheduledValues()` y `setTargetAtTime()` con una transición corta de 20 ms para evitar clics y *zipper noise*. Bypass master y escucha mono usan rutas permanentes con ganancias cruzadas suavemente; al volver a estéreo se recuperan los panoramas originales sin reconstruir la reproducción.

Para una comprobación durante el desarrollo, la consola del navegador expone `microphonMixerDiagnostics()`. Su resultado permite observar la posición, la generación de fuentes, el número de fuentes activas y la sincronización: al hacer movimientos rápidos de volumen, panorama, mute o solo, `sourceGeneration` debe permanecer constante, `activeSources` debe seguir en tres y `tracksSynchronized` debe ser `true`.

## Limitaciones conocidas

- El render WAV exporta PCM estéreo de 16 bits para mantener el encoder pequeño y compatible con navegadores antiguos.
- La barra de progreso indica fases del render; Web Audio no expone progreso sample a sample durante `OfflineAudioContext.startRendering()`.
- El Tape Echo y la Dark Chamber son modelos estables y sencillos de Web Audio, inspirados en flujo analógico, no emulaciones exactas de hardware.
- Si el navegador no permite `OfflineAudioContext` o `decodeAudioData` para WAV locales, usa un navegador compatible con Web Audio API y abre la app desde `http://localhost`.
