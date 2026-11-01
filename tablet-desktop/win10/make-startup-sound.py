"""Generates startup.oga: an original ~3 s startup chime (soft chord swell
with a rising bell arpeggio). Needs numpy and ffmpeg."""
import os, subprocess, wave
import numpy as np

SR = 44100
DUR = 3.4
t = np.arange(int(SR * DUR)) / SR
out = np.zeros_like(t)

def note(freq):
    return 440.0 * 2 ** ((freq - 69) / 12)   # MIDI note -> Hz

def bell(start, midi, gain):
    f = note(midi)
    tt = t - start
    on = tt >= 0
    env = np.where(on, np.exp(-tt * 2.2) * (1 - np.exp(-tt * 80)), 0)
    tone = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * 2 * f * tt)
            + 0.12 * np.sin(2 * np.pi * 3.01 * f * tt))
    return gain * env * tone

# soft pad: A-flat major-ish chord swelling in and fading out
pad_env = np.clip(t / 0.9, 0, 1) * np.clip((DUR - t) / 1.6, 0, 1)
for m, g in ((56, 0.20), (63, 0.16), (68, 0.14), (72, 0.10)):
    f = note(m)
    out += g * pad_env * (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 1.003 * t))

# rising bell arpeggio
for start, m, g in ((0.25, 68, 0.30), (0.55, 72, 0.28), (0.85, 75, 0.26), (1.15, 80, 0.30), (1.45, 84, 0.22)):
    out += bell(start, m, g)

# simple room echo
for delay, g in ((0.11, 0.30), (0.23, 0.18), (0.37, 0.10)):
    d = int(SR * delay)
    out[d:] += g * out[:-d]

out = out / np.max(np.abs(out)) * 0.7
fade = int(SR * 0.4)
out[-fade:] *= np.linspace(1, 0, fade)

here = os.path.dirname(os.path.abspath(__file__))
wav = os.path.join(here, "startup.wav")
with wave.open(wav, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((out * 32767).astype(np.int16).tobytes())
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", "4",
                os.path.join(here, "startup.oga")], check=True)
os.remove(wav)
