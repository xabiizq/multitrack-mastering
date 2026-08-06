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

El panorama de cada canal usa una ley *equal-power* independiente antes de los
envíos. El centro conserva la potencia y Tape Echo y Dark Chamber reciben la
posición estéreo de esa pista. Los RAW estéreo se suman a mono antes de este
control para que el recorrido completo sea un panorama de pista, no un balance.

6. Ajusta los efectos globales y el master.
7. Pulsa **Renderizar WAV** para generar la mezcla completa.
8. Cuando termine el render, usa **Descargar WAV**. El archivo se descarga como `microphon_mix_60s.wav`.

## Valores iniciales

Los valores iniciales siguen la intención de `process_audio.py`:

- Evolving Circles: -1.6 dB, panorama 23 % derecha, saturación suave, Tape Echo 430 ms con feedback moderado y repeticiones oscuras, más cámara oscura.
- Sharp Chorus: -6.2 dB, panorama 23 % izquierda, soporte armónico con cámara secundaria y saturación cálida.
- Neon GB: -1.2 dB, centro, nivel aumentado +3 dB respecto a la versión previa, saturación mínima y presencia/punch muy moderado.
- Master: techo aproximado de -1 dBFS, limitación conservadora, drive ligero y anchura estéreo moderada.

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
- nivel, drive, anchura, limitador, bypass y escucha mono del master.

No se genera MP3 y no se sobrescriben los WAV RAW originales.

## Limitaciones conocidas

- El render WAV exporta PCM estéreo de 16 bits para mantener el encoder pequeño y compatible con navegadores antiguos.
- La barra de progreso indica fases del render; Web Audio no expone progreso sample a sample durante `OfflineAudioContext.startRendering()`.
- El Tape Echo y la Dark Chamber son modelos estables y sencillos de Web Audio, inspirados en flujo analógico, no emulaciones exactas de hardware.
- Si el navegador no permite `OfflineAudioContext` o `decodeAudioData` para WAV locales, usa un navegador compatible con Web Audio API y abre la app desde `http://localhost`.
