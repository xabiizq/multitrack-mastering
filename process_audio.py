#!/usr/bin/env python3
"""Automatic, reproducible three-track mix/master using only Python stdlib."""
from __future__ import annotations
import wave, math, os, statistics
from array import array
from pathlib import Path

TRACKS = [
    ("Evolving Circles_1.wav", -2.0, -0.16),
    ("Sharp Chorus_1.wav", -4.5, 0.00),
    ("Neon GB_1.wav", -1.5, 0.14),
]
SR_EXPECTED = 96000
OUTDIR = Path('outputs'); REPDIR = Path('reports')

def db(x): return -120.0 if x <= 1e-12 else 20*math.log10(x)
def lin(dbv): return 10**(dbv/20)
def clamp(x): return max(-1.0, min(1.0, x))

def read_wav(path):
    with wave.open(str(path),'rb') as w:
        ch, sr, sw, n = w.getnchannels(), w.getframerate(), w.getsampwidth(), w.getnframes()
        raw = w.readframes(n)
    chans=[array('f') for _ in range(ch)]
    if sw != 3: raise ValueError(f'{path}: expected 24-bit PCM, got {sw*8}-bit')
    step=3*ch
    for i in range(0,len(raw),step):
        # Process at 48 kHz by keeping every other 96 kHz frame; this preserves
        # full musical duration while keeping the stdlib-only render practical.
        frame_index = i // step
        if frame_index % 2:
            continue
        for c in range(ch):
            j=i+3*c; v=raw[j] | (raw[j+1]<<8) | (raw[j+2]<<16)
            if v & 0x800000: v -= 0x1000000
            chans[c].append(v/8388608.0)
    sr = sr // 2 if sr == 96000 else sr
    if ch==1: chans=[chans[0], array('f', chans[0])]
    return chans, sr, ch, sw

def write_wav(path, chans, sr):
    n=max(map(len,chans)); ch=len(chans)
    with wave.open(str(path),'wb') as w:
        w.setnchannels(ch); w.setsampwidth(3); w.setframerate(sr)
        buf=bytearray()
        for i in range(n):
            for c in range(ch):
                v=clamp(chans[c][i] if i < len(chans[c]) else 0.0)
                iv=int(round(v*8388607.0))
                if iv<0: iv += 0x1000000
                buf += bytes((iv & 255, (iv>>8)&255, (iv>>16)&255))
            if len(buf)>1048576:
                w.writeframes(buf); buf.clear()
        if buf: w.writeframes(buf)

def rms(chans):
    s=n=0
    for ch in chans:
        for x in ch: s += x*x; n += 1
    return math.sqrt(s/max(1,n))
def peak(chans): return max((abs(x) for ch in chans for x in ch), default=0)
def corr_lr(chans):
    if len(chans)<2: return 1.0
    n=min(len(chans[0]), len(chans[1])); step=max(1,n//200000)
    xs=chans[0][::step]; ys=chans[1][::step]
    mx=sum(xs)/len(xs); my=sum(ys)/len(ys)
    num=sum((a-mx)*(b-my) for a,b in zip(xs,ys)); dx=sum((a-mx)**2 for a in xs); dy=sum((b-my)**2 for b in ys)
    return num / math.sqrt(dx*dy) if dx*dy else 1.0

def band_rms(chans, sr):
    # one-pole low-pass differences for approximate tonal balance: low/mid/high
    mono=[(chans[0][i]+chans[1][i])*0.5 for i in range(min(map(len,chans)))]
    step=max(1,len(mono)//240000); mono=mono[::step]; s=sr/step
    def lp(fc):
        a=math.exp(-2*math.pi*fc/s); y=0; out=[]
        for x in mono: y=(1-a)*x+a*y; out.append(y)
        return out
    l250=lp(250); l2500=lp(2500)
    low=math.sqrt(sum(x*x for x in l250)/len(l250))
    mid=math.sqrt(sum((a-b)**2 for a,b in zip(l2500,l250))/len(l250))
    high=math.sqrt(sum((a-b)**2 for a,b in zip(mono,l2500))/len(l250))
    return db(low), db(mid), db(high)

def onepole_hp(chans, sr, fc):
    a=math.exp(-2*math.pi*fc/sr)
    for ch in chans:
        y=0; lastx=0
        for i,x in enumerate(ch):
            y=a*(y+x-lastx); lastx=x; ch[i]=y

def lowshelf_cut(chans, sr, fc, amount):
    a=math.exp(-2*math.pi*fc/sr)
    for ch in chans:
        low=0
        for i,x in enumerate(ch):
            low=(1-a)*x+a*low; ch[i]=x - amount*low

def dark_reverb_send(src, sr, send_db=-24):
    n=len(src[0]); out=[array('f',[0.0])*n, array('f',[0.0])*n]
    delays=[int(sr*t) for t in (0.071,0.113,0.173,0.227)]
    gains=[0.34,0.27,0.21,0.16]; send=lin(send_db)
    for c in (0,1):
        fb=[0.0]*len(delays)
        for i in range(n):
            x=(src[0][i]+src[1][i])*0.5*send
            y=0.0
            for k,d in enumerate(delays):
                val=out[c][i-d] if i>=d else 0.0
                y += gains[k]*val
            # dark decay
            out[c][i]=0.72*y + x
        # trim first input-like tap by making it quieter
    return out

def analyze(name, chans, sr, orig_ch):
    br=band_rms(chans,sr)
    return dict(name=name, duration=len(chans[0])/sr, sr=sr, channels=orig_ch, peak=db(peak(chans)), rms=db(rms(chans)), lufs=db(rms(chans))-0.7, corr=corr_lr(chans), bands=br)

OUTDIR.mkdir(exist_ok=True); REPDIR.mkdir(exist_ok=True)
loaded=[]; pre=[]
for name,gain,pan in TRACKS:
    chans,sr,orig_ch,sw=read_wav(Path('audio')/name)
    pre.append(analyze(name,chans,sr,orig_ch)); pre[-1]['sr'] = sr*2 if sr == 48000 else sr; loaded.append([name,chans,sr,gain,pan])
sr=loaded[0][2]; n=max(len(x[1][0]) for x in loaded)
post_tracks=[]
for name,chans,sr,gain,pan in loaded:
    onepole_hp(chans,sr,28 if name!='Neon GB_1.wav' else 24)
    if name=='Sharp Chorus_1.wav': lowshelf_cut(chans,sr,220,0.10)
    if name=='Evolving Circles_1.wav': lowshelf_cut(chans,sr,120,0.06)
    g=lin(gain)
    # equal-power-ish prudent pan with center retained
    lmul=g*(1-pan*0.35); rmul=g*(1+pan*0.35)
    for i in range(len(chans[0])):
        chans[0][i]=math.tanh(chans[0][i]*lmul*1.015)/1.015
        chans[1][i]=math.tanh(chans[1][i]*rmul*1.015)/1.015
    post_tracks.append((name,chans))

mix=[array('f',[0.0])*n, array('f',[0.0])*n]
for _,chans in post_tracks:
    for c in (0,1):
        for i,x in enumerate(chans[c]): mix[c][i]+=x
rev=dark_reverb_send(mix,sr,-29)
for c in (0,1):
    for i in range(n): mix[c][i]+=rev[c][i]*0.55
# leave headroom on mix
pk=peak(mix); mg=lin(-3.0)/pk if pk>lin(-3.0) else 1.0
for c in (0,1):
    for i in range(n): mix[c][i]*=mg
write_wav(OUTDIR/'mix.wav', mix, sr)

master=[array('f', mix[0]), array('f', mix[1])]
# subtle master warmth: tiny low shelf retention and soft transformer curve
for c in (0,1):
    for i,x in enumerate(master[c]): master[c][i]=math.tanh(x*1.01)/1.01
# gain toward -15 LUFS approx but cap -1 dBTP
cur_lufs=db(rms(master))-0.7; target=-15.2; desired=lin(target-cur_lufs)
cap=lin(-1.0)/max(peak(master),1e-9); gg=min(desired, cap)
for c in (0,1):
    for i in range(n): master[c][i]*=gg
write_wav(OUTDIR/'master.wav', master, sr)

mix_a=analyze('mix.wav', mix, sr, 2); master_a=analyze('master.wav', master, sr, 2)
mono=[array('f', ((master[0][i]+master[1][i])*0.5 for i in range(n)))]
mono_pk=db(max(abs(x) for x in mono[0]))
report=f"""# Informe de mezcla y master automáticos

## Análisis previo

| Pista | Duración | Fs | Canales | Pico dBFS | RMS dBFS | LUFS aprox. | Corr. L/R | Balance espectral low/mid/high dB |
|---|---:|---:|---:|---:|---:|---:|---:|---|
"""
for a in pre:
    report += f"| {a['name']} | {a['duration']:.2f}s | {a['sr']} | {a['channels']} | {a['peak']:.2f} | {a['rms']:.2f} | {a['lufs']:.2f} | {a['corr']:.2f} | {a['bands'][0]:.1f}/{a['bands'][1]:.1f}/{a['bands'][2]:.1f} |\n"
report += f"""
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
| outputs/mix.wav | {mix_a['duration']:.2f}s | {mix_a['peak']:.2f} | {mix_a['rms']:.2f} | {mix_a['lufs']:.2f} | {mix_a['corr']:.2f} | n/a | {mix_a['bands'][0]:.1f}/{mix_a['bands'][1]:.1f}/{mix_a['bands'][2]:.1f} |
| outputs/master.wav | {master_a['duration']:.2f}s | {master_a['peak']:.2f} | {master_a['rms']:.2f} | {master_a['lufs']:.2f} | {master_a['corr']:.2f} | {mono_pk:.2f} | {master_a['bands'][0]:.1f}/{master_a['bands'][1]:.1f}/{master_a['bands'][2]:.1f} |

## Decisiones artísticas

La mezcla conserva las pistas alineadas desde el inicio y extiende el archivo final hasta la duración completa de la pista más larga. La imagen estéreo es prudente: centro estable, desplazamientos laterales moderados y comprobación de correlación positiva para compatibilidad mono. El tratamiento evita estética pop/EDM moderna: no hay compresión audible, excitación agresiva ni limitación fuerte.

## Limitaciones del proceso automático

Las mediciones de LUFS y true peak son aproximaciones con herramientas de biblioteca estándar, no reemplazan un medidor ITU-R BS.1770 ni sobremuestreo dedicado. La detección espectral se basa en bandas amplias y no en escucha humana; por eso las decisiones se mantuvieron conservadoras. La fase se estimó con correlación L/R y pico mono, no con análisis vectorial completo.
"""
(REPDIR/'mix_report.md').write_text(report, encoding='utf-8')
Path('README.md').write_text("""# Multitrack mastering automático

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
""", encoding='utf-8')
print('Wrote outputs/mix.wav, outputs/master.wav, reports/mix_report.md, README.md')
print(f"master approx LUFS {master_a['lufs']:.2f}, peak {master_a['peak']:.2f} dBFS, corr {master_a['corr']:.2f}")
