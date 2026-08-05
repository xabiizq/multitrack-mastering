#!/usr/bin/env python3
"""Reproducible 1967-1970 inspired mix/master for the RAW WAVs in audio/.

Only Python standard-library modules are used so the render is deterministic in a
minimal open-source environment.  The code intentionally favours broad, musical
moves over modern loudness processing.
"""
from __future__ import annotations

from array import array
from pathlib import Path
import math
import wave

INPUTS = {
    "evolving": Path("audio/Evolving_Circles_RAW.wav"),
    "sharp": Path("audio/Sharp_Chorus_RAW.wav"),
    "neon": Path("audio/Neon_GB_RAW.wav"),
}
OUT = Path("outputs")
REPORTS = Path("reports")


def db(x: float) -> float:
    return -120.0 if x <= 1e-12 else 20.0 * math.log10(x)


def lin(x: float) -> float:
    return 10.0 ** (x / 20.0)


def clamp(x: float) -> float:
    return -1.0 if x < -1.0 else 1.0 if x > 1.0 else x


def read_wav(path: Path):
    with wave.open(str(path), "rb") as wf:
        ch, sr, sw, frames = wf.getnchannels(), wf.getframerate(), wf.getsampwidth(), wf.getnframes()
        raw = wf.readframes(frames)
    if sw != 3:
        raise ValueError(f"{path} must be 24-bit PCM; found {sw * 8}-bit")
    chans = [array("f") for _ in range(ch)]
    step = ch * 3
    for i in range(0, len(raw), step):
        frame_index = i // step
        # Deterministic 4:1 decimation keeps the full musical duration while
        # making the stdlib-only DSP practical in this environment.
        if sr == 96000 and frame_index % 4:
            continue
        for c in range(ch):
            j = i + c * 3
            v = raw[j] | (raw[j + 1] << 8) | (raw[j + 2] << 16)
            if v & 0x800000:
                v -= 0x1000000
            chans[c].append(v / 8388608.0)
    if sr == 96000:
        sr = 24000
    if ch == 1:
        chans = [array("f", chans[0]), array("f", chans[0])]
    return chans, sr, ch, frames


def write_wav(path: Path, chans, sr: int):
    path.parent.mkdir(parents=True, exist_ok=True)
    n = max(len(c) for c in chans)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(3)
        wf.setframerate(sr)
        buf = bytearray()
        for i in range(n):
            for c in range(2):
                x = clamp(chans[c][i] if i < len(chans[c]) else 0.0)
                iv = int(round(x * 8388607.0))
                if iv < 0:
                    iv += 0x1000000
                buf.extend((iv & 255, (iv >> 8) & 255, (iv >> 16) & 255))
            if len(buf) > 1_000_000:
                wf.writeframes(buf)
                buf.clear()
        if buf:
            wf.writeframes(buf)


def peak(chans) -> float:
    return max((abs(x) for ch in chans for x in ch), default=0.0)


def rms(chans) -> float:
    s = 0.0; n = 0
    for ch in chans:
        for x in ch:
            s += x * x; n += 1
    return math.sqrt(s / max(1, n))


def stereo_corr(chans) -> float:
    n = min(len(chans[0]), len(chans[1])); hop = max(1, n // 180000)
    l = chans[0][::hop]; r = chans[1][::hop]
    ml = sum(l) / len(l); mr = sum(r) / len(r)
    num = sum((a - ml) * (b - mr) for a, b in zip(l, r))
    dl = sum((a - ml) ** 2 for a in l); dr = sum((b - mr) ** 2 for b in r)
    return num / math.sqrt(dl * dr) if dl and dr else 1.0


def analyse(name: str, chans, sr: int, original_channels: int):
    n = min(len(chans[0]), len(chans[1])); hop = max(1, n // 240000)
    mono = array("f", (((chans[0][i] + chans[1][i]) * 0.5) for i in range(0, n, hop)))
    eff_sr = sr / hop
    def lp(fc: float):
        a = math.exp(-2 * math.pi * fc / eff_sr); y = 0.0; out = array("f")
        for x in mono:
            y = (1 - a) * x + a * y; out.append(y)
        return out
    l120, l500, l2500 = lp(120), lp(500), lp(2500)
    def br(vals):
        count = 0; total = 0.0
        for v in vals:
            total += v * v; count += 1
        return math.sqrt(total / max(1, count))
    low = br(l120)
    lowmid = br(a - b for a, b in zip(l500, l120))
    mid = br(a - b for a, b in zip(l2500, l500))
    high = br(a - b for a, b in zip(mono, l2500))
    # simple crest and transient indicator on the downsampled mono stream
    rm = br(mono); pk = max(abs(x) for x in mono) if mono else 0.0
    dif = br((mono[i] - mono[i - 1]) for i in range(1, len(mono))) if len(mono) > 1 else 0.0
    # noise estimate: RMS of first/last half-second if low enough to be useful
    edge = int(min(len(mono) // 4, eff_sr * 0.5)) or 1
    noise = br(list(mono[:edge]) + list(mono[-edge:]))
    return {
        "name": name, "duration": n / sr, "sr": sr, "channels": original_channels,
        "peak": db(peak(chans)), "rms": db(rms(chans)), "lufs": db(rms(chans)) - 0.7,
        "crest": db(pk / max(rm, 1e-12)), "corr": stereo_corr(chans),
        "bands": (db(low), db(lowmid), db(mid), db(high)),
        "transients": db(dif), "noise": db(noise),
    }


def highpass(chans, sr, fc):
    a = math.exp(-2 * math.pi * fc / sr)
    for ch in chans:
        y = 0.0; last = 0.0
        for i, x in enumerate(ch):
            y = a * (y + x - last); last = x; ch[i] = y


def lowpass_inplace(chans, sr, fc):
    a = math.exp(-2 * math.pi * fc / sr)
    for ch in chans:
        y = 0.0
        for i, x in enumerate(ch):
            y = (1 - a) * x + a * y; ch[i] = y


def shelf_cut(chans, sr, fc, amount):
    a = math.exp(-2 * math.pi * fc / sr)
    for ch in chans:
        y = 0.0
        for i, x in enumerate(ch):
            y = (1 - a) * x + a * y; ch[i] = x - amount * y


def soft_saturate(chans, drive=1.02):
    for ch in chans:
        for i, x in enumerate(ch):
            ch[i] = math.tanh(x * drive) / drive


def gain_pan(chans, gain_db: float, pan: float):
    g = lin(gain_db)
    # modest constant-power pan; pan remains conservative for a period-correct stage
    lg = g * math.cos((pan + 1) * math.pi / 4)
    rg = g * math.sin((pan + 1) * math.pi / 4)
    for i in range(len(chans[0])):
        l, r = chans[0][i], chans[1][i]
        mid = (l + r) * 0.5; side = (l - r) * 0.5 * 0.82
        chans[0][i] = (mid + side) * lg * 1.38
        chans[1][i] = (mid - side) * rg * 1.38


def automate_neon(chans, sr):
    # Gentle manual-style fader riding: louder rhythmic passages are eased back,
    # but not flattened by a compressor.
    win = int(sr * 0.25); n = len(chans[0]); env = array("f", [1.0]) * n
    vals = []
    for start in range(0, n, win):
        end = min(n, start + win)
        block = math.sqrt(sum(((chans[0][i] + chans[1][i]) * 0.5) ** 2 for i in range(start, end)) / max(1, end - start))
        vals.append(block)
    avg = sum(vals) / len(vals)
    for b, val in enumerate(vals):
        over = max(0.0, db(val / max(avg, 1e-9)) - 1.5)
        g = lin(-min(2.2, over * 0.45))
        start = b * win; end = min(n, start + win)
        for i in range(start, end):
            env[i] = g
    # smooth the fader movement
    a = math.exp(-1 / (sr * 0.18)); y = 1.0
    for i in range(n):
        y = (1 - a) * env[i] + a * y
        chans[0][i] *= y; chans[1][i] *= y


def tape_echo(src, sr, delay_s=0.43, feedback=0.34, send_db=-12.8):
    n = len(src[0]); delay = int(sr * delay_s); wow = int(sr * 0.006)
    out = [array("f", [0.0]) * n, array("f", [0.0]) * n]
    lp_l = lp_r = 0.0; a = math.exp(-2 * math.pi * 2750 / sr); send = lin(send_db)
    for i in range(n):
        wob = int(math.sin(2 * math.pi * 0.23 * i / sr) * wow)
        j = i - delay - wob
        fl = out[0][j] if 0 <= j < i else 0.0
        fr = out[1][j] if 0 <= j < i else 0.0
        inp = (src[0][i] + src[1][i]) * 0.5 * send
        # progressive brightness loss and slight left/right offset like tape returns
        lp_l = (1 - a) * (inp + fl * feedback) + a * lp_l
        lp_r = (1 - a) * (inp + fr * feedback * 0.96) + a * lp_r
        out[0][i] = math.tanh(lp_l * 1.04) / 1.04
        out[1][i] = math.tanh(lp_r * 1.04) / 1.04
    return out


def chamber(src, sr, send_db=-23.5):
    n = len(src[0]); out = [array("f", [0.0]) * n, array("f", [0.0]) * n]
    delays = [int(sr * t) for t in (0.031, 0.047, 0.083, 0.127, 0.181)]
    gains = [0.30, 0.25, 0.20, 0.16, 0.12]; send = lin(send_db)
    filt = [0.0, 0.0]; a = math.exp(-2 * math.pi * 3600 / sr)
    for i in range(n):
        m = (src[0][i] + src[1][i]) * 0.5 * send
        for c in (0, 1):
            y = m
            for d, g in zip(delays, gains):
                if i >= d:
                    y += out[1 - c][i - d] * g
            filt[c] = (1 - a) * y + a * filt[c]
            out[c][i] = filt[c]
    return out


def add_into(dst, src, gain=1.0):
    for c in (0, 1):
        for i, x in enumerate(src[c]):
            dst[c][i] += x * gain


def remove_previous_renders():
    for path in (OUT / "mix.wav", OUT / "master.wav"):
        if path.exists():
            path.unlink()


def apply_final_fade(chans, sr, seconds=2.0):
    n = max(len(ch) for ch in chans)
    fade = min(n, int(sr * seconds))
    if fade <= 0:
        return
    start = n - fade
    for c in (0, 1):
        for i in range(start, n):
            g = (n - 1 - i) / max(1, fade - 1)
            chans[c][i] *= g


def main():
    OUT.mkdir(exist_ok=True); REPORTS.mkdir(exist_ok=True)
    remove_previous_renders()
    loaded = {}; pre = []
    for key, path in INPUTS.items():
        chans, sr, orig_ch, _ = read_wav(path)
        pre.append(analyse(path.name, chans, sr, orig_ch))
        loaded[key] = chans, sr
    sr = next(iter(loaded.values()))[1]
    n = max(len(v[0][0]) for v in loaded.values())

    evolving, _ = loaded["evolving"]
    sharp, _ = loaded["sharp"]
    neon, _ = loaded["neon"]

    # Evolving Circles: primary atmosphere with audible tape echo + dark chamber.
    highpass(evolving, sr, 32); shelf_cut(evolving, sr, 145, 0.07); lowpass_inplace(evolving, sr, 11800)
    evo_echo = tape_echo(evolving, sr); highpass(evo_echo, sr, 95); evo_chamber = chamber(evolving, sr, -25.0); highpass(evo_chamber, sr, 120)
    soft_saturate(evolving, 1.035); gain_pan(evolving, -1.6, 0.23)

    # Sharp Chorus: harmonic support, slightly behind and warmer, no competition with echo lead.
    highpass(sharp, sr, 42); shelf_cut(sharp, sr, 260, 0.18); lowpass_inplace(sharp, sr, 7600)
    soft_saturate(sharp, 1.055); gain_pan(sharp, -6.2, -0.23)

    # Neon GB: rhythmic bed.  Fader automation controls active drum passages before tone/level.
    automate_neon(neon, sr); highpass(neon, sr, 27); shelf_cut(neon, sr, 92, 0.05); lowpass_inplace(neon, sr, 9800)
    soft_saturate(neon, 1.025); gain_pan(neon, -1.2, 0.00)

    mix = [array("f", [0.0]) * n, array("f", [0.0]) * n]
    for tr in (evolving, sharp, neon):
        add_into(mix, tr)
    add_into(mix, evo_echo, 0.42)
    add_into(mix, evo_chamber, 0.38)
    sharp_chamber = chamber(sharp, sr, -29.0); highpass(sharp_chamber, sr, 150)
    add_into(mix, sharp_chamber, 0.35)
    highpass(mix, sr, 32)

    # Mix bus: console/tape colour and headroom, not loudness.
    soft_saturate(mix, 1.018)
    apply_final_fade(mix, sr, 2.0)
    pk = peak(mix); g = min(1.0, lin(-3.2) / max(pk, 1e-9))
    for c in (0, 1):
        for i in range(n):
            mix[c][i] *= g
    write_wav(OUT / "mix.wav", mix, sr)

    master = [array("f", mix[0]), array("f", mix[1])]
    lowpass_inplace(master, sr, 15500); soft_saturate(master, 1.012)
    current = db(rms(master)) - 0.7
    target_gain = lin(-16.4 - current)
    ceiling_gain = lin(-1.0) / max(peak(master), 1e-9)
    mg = min(target_gain, ceiling_gain)
    for c in (0, 1):
        for i in range(n):
            master[c][i] *= mg
    write_wav(OUT / "master.wav", master, sr)

    mix_a = analyse("outputs/mix.wav", mix, sr, 2); master_a = analyse("outputs/master.wav", master, sr, 2)
    mono_peak = db(max(abs((master[0][i] + master[1][i]) * 0.5) for i in range(n)))
    report = render_report(pre, mix_a, master_a, mono_peak)
    (REPORTS / "mix_report.md").write_text(report, encoding="utf-8")
    Path("README.md").write_text(render_readme(), encoding="utf-8")


def render_report(pre, mix_a, master_a, mono_peak):
    rows = ""
    for a in pre:
        rows += f"| {a['name']} | {a['duration']:.2f}s | {a['sr']} | {a['channels']} | {a['peak']:.2f} | {a['rms']:.2f} | {a['lufs']:.2f} | {a['crest']:.2f} | {a['corr']:.2f} | {a['bands'][0]:.1f}/{a['bands'][1]:.1f}/{a['bands'][2]:.1f}/{a['bands'][3]:.1f} | {a['transients']:.1f} | {a['noise']:.1f} |\n"
    return f"""# Informe de mezcla y mastering

## Análisis previo desde cero

| Pista | Duración | Fs | Canales | Peak dBFS | RMS dBFS | LUFS aprox. | Crest dB | Corr. L/R | Graves/medios bajos/medios/agudos dB | Transitorios | Ruido borde |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
{rows}

## Función musical y problemas detectados

- `Evolving_Circles_RAW.wav`: elemento atmosférico principal. La pista contiene energía sostenida, estéreo moderado y pocos transitorios bruscos; pedía profundidad y un eco de cinta audible. Se recortó subgrave no musical, se suavizó el extremo superior y se convirtió en la fuente principal de tape echo más cámara oscura.
- `Sharp_Chorus_RAW.wav`: soporte armónico. Es más débil en nivel y necesita reconocimiento sin ocupar el primer plano. Se adelgazó la zona baja/media-baja para no enmascarar a Evolving Circles ni a la base.
- `Neon_GB_RAW.wav`: base rítmica. Presenta mayor actividad transitoria y podía dominar la mezcla si se subía en exceso. Se aplicó automatización de fader por bloques para controlar pasajes fuertes antes de cualquier saturación.

## Balance, panorama y automatización

1. Primero se fijó una mezcla de niveles: Evolving como plano principal, Sharp Chorus detrás como colchón armónico y Neon GB como base integrada.
2. Se eliminó cualquier comportamiento que pudiera percibirse como fade out a mitad del tema: no hay automatización global dependiente de RMS ni reducción de nivel por secciones tranquilas. El único fade programado es el fade final de 2 segundos al final real del archivo.
3. `Neon_GB_RAW.wav` se subió exactamente +3 dB respecto a la revisión anterior, de -4.2 dB a -1.2 dB, conservando transitorios y sin compensarlo con limitación adicional.
4. El panorama separa ligeramente las dos guitarras: Sharp Chorus queda 23% izquierda, Evolving Circles 23% derecha y Neon GB permanece centrado para liberar el centro rítmico. La compatibilidad mono se comprobó mediante correlación y pico mono.

## Procesamiento por pista

| Pista | Nivel/pan | EQ | Dinámica | Saturación/color | Espacio |
|---|---|---|---|---|---|
| Evolving Circles | -1.6 dB, 23% derecha | HP 32 Hz, recorte suave bajo 145 Hz, LP 11.8 kHz | Sin compresor | `tanh` leve tipo cinta/consola | Tape echo 430 ms con wow/flutter, feedback 0.34, filtrado a 2.75 kHz y cámara oscura |
| Sharp Chorus | -6.2 dB, 23% izquierda | HP 42 Hz, recorte bajo 260 Hz, LP 7.6 kHz | Sin compresor | Saturación un poco más cálida | Cámara secundaria muy baja |
| Neon GB | -1.2 dB, centro | HP 27 Hz, recorte bajo 92 Hz, LP 9.8 kHz | Automatización de ganancia, no compresión | Saturación mínima | Sin reverb dedicada para mantener base firme |

## Bus master y mastering

- Bus de mezcla: saturación de consola/cinta muy ligera, fade final único de 2 segundos y normalización conservadora a -3.2 dBFS de pico de muestra.
- Master: filtrado superior suave a 15.5 kHz, saturación mínima y ganancia final con techo de -1.0 dBFS como aproximación conservadora a -1 dBTP.
- No se usó limitación moderna ni compresión glue evidente porque el objetivo era dinámica, textura y profundidad de finales de los 60.

## Mediciones posteriores

| Archivo | Duración | Peak dBFS | RMS dBFS | LUFS aprox. | Crest dB | Corr. L/R | Pico mono dBFS | Graves/medios bajos/medios/agudos dB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| outputs/mix.wav | {mix_a['duration']:.2f}s | {mix_a['peak']:.2f} | {mix_a['rms']:.2f} | {mix_a['lufs']:.2f} | {mix_a['crest']:.2f} | {mix_a['corr']:.2f} | n/a | {mix_a['bands'][0]:.1f}/{mix_a['bands'][1]:.1f}/{mix_a['bands'][2]:.1f}/{mix_a['bands'][3]:.1f} |
| outputs/master.wav | {master_a['duration']:.2f}s | {master_a['peak']:.2f} | {master_a['rms']:.2f} | {master_a['lufs']:.2f} | {master_a['crest']:.2f} | {master_a['corr']:.2f} | {mono_peak:.2f} | {master_a['bands'][0]:.1f}/{master_a['bands'][1]:.1f}/{master_a['bands'][2]:.1f}/{master_a['bands'][3]:.1f} |

## Notas de reproducibilidad

El proceso no modifica ningún WAV de entrada. Para que el DSP basado solo en biblioteca estándar sea práctico, las fuentes de 96 kHz se renderizan determinísticamente a 24 kHz conservando la duración completa. Las mediciones de LUFS y true peak son aproximadas porque se calculan sin librerías externas ni sobremuestreo dedicado; por eso se dejó margen conservador y se priorizó la intención musical sobre la maximización.
"""


def render_readme():
    return """# Multitrack Mastering

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

El script construye primero un balance de niveles y después aplica tratamiento específico por pista. `Evolving_Circles_RAW.wav` recibe el rol atmosférico principal con tape echo largo, oscuro y degradado; `Sharp_Chorus_RAW.wav` queda como soporte armónico reconocible ligeramente a la izquierda; `Neon_GB_RAW.wav` actúa como base rítmica centrada con +3 dB de presencia frente a la revisión anterior y sin fades globales no deseados.
"""


if __name__ == "__main__":
    main()
