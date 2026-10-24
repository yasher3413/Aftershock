"""Synthesizes the soundtrack for puckquake.html on the same 120 BPM grid.

Every sound is made here from sine waves and noise, so there is nothing to
license. The cue times match the timeline in puckquake.html, and each team's
ping lands when the shockwave reaches it on the map.

    python3 audio.py            writes out/puckquake.wav
"""

import json
import math
import re
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
SR = 48000
DUR = 35.0
BEAT = 0.5
N = int(SR * DUR)
rng = np.random.default_rng(7)

# Timeline, from puckquake.html.
GOAL, ONE_GOAL, MAP_IN, QUAKE = 3.0, 4.55, 5.4, 7.0
BARS, SIMS, TWICE, PLAYER = 12.0, 15.0, 17.0, 19.5
TEAM, NIGHTS, WHATIF, STATS, LOGO, LOOP = 22.5, 24.0, 25.5, 27.0, 31.0, 34.0

L = np.zeros(N)
R = np.zeros(N)


def add(sig, t0, gain=1.0, pan=0.0):
    """Mix a mono signal in at t0 seconds, panned -1 (left) to 1 (right)."""
    i0 = int(t0 * SR)
    if i0 >= N:
        return
    if i0 < 0:
        sig = sig[-i0:]
        i0 = 0
    sig = sig[: N - i0]
    a = (pan + 1) * math.pi / 4
    L[i0 : i0 + len(sig)] += sig * gain * math.cos(a)
    R[i0 : i0 + len(sig)] += sig * gain * math.sin(a)


def tvec(dur):
    return np.arange(int(dur * SR)) / SR


def lowpass(x, cutoff, slope=4):
    """Smooth spectral lowpass (whole-signal FFT, fine for one-shots)."""
    f = np.fft.rfftfreq(len(x), 1 / SR)
    h = 1 / np.sqrt(1 + (f / cutoff) ** (2 * slope))
    return np.fft.irfft(np.fft.rfft(x) * h, len(x))


def highpass(x, cutoff, slope=3):
    f = np.fft.rfftfreq(len(x), 1 / SR)
    h = 1 - 1 / np.sqrt(1 + (f / cutoff) ** (2 * slope))
    return np.fft.irfft(np.fft.rfft(x) * h, len(x))


def env(t, attack, decay):
    return np.minimum(1, t / max(attack, 1e-4)) * np.exp(-t / decay)


def kick(gain=1.0):
    t = tvec(0.6)
    f = 46 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    click = highpass(rng.standard_normal(len(t)), 2500) * np.exp(-t * 300) * 0.25
    return (np.sin(ph) * env(t, 0.002, 0.22) + click) * gain


def boom(dur=3.5):
    """Sub drop plus rumble: the tremor."""
    t = tvec(dur)
    f = 30 + 70 * np.exp(-t * 5)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(t, 0.004, 0.9)
    rum = lowpass(rng.standard_normal(len(t)), 140) * env(t, 0.03, 1.1) * 3.2
    crack = lowpass(highpass(rng.standard_normal(len(t)), 300), 4000) * env(t, 0.001, 0.12) * 0.5
    return sub + rum + crack


def hat(open_=False):
    t = tvec(0.25 if open_ else 0.08)
    return highpass(rng.standard_normal(len(t)), 7000) * env(t, 0.001, 0.07 if open_ else 0.018)


def tick():
    t = tvec(0.05)
    return np.sin(2 * np.pi * 2400 * t) * env(t, 0.0005, 0.006) + highpass(rng.standard_normal(len(t)), 5000) * env(t, 0.0005, 0.004) * 0.6


def ping(freq, dur=0.9):
    t = tvec(dur)
    s = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 2.01 * t) + 0.12 * np.sin(2 * np.pi * freq * 3.98 * t)
    return s * env(t, 0.002, 0.18)


def saw(freq, t, harmonics=10, tilt=1.4):
    return sum(np.sin(2 * np.pi * freq * k * t) / k**tilt for k in range(1, harmonics + 1))


def horn(dur=2.4):
    """A goal horn: a low brassy chord with a slow swell and a little wobble."""
    t = tvec(dur)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t)
    s = sum(saw(f, t * vib, 14, 1.15) for f in (98.0, 123.5, 147.0))
    e = np.minimum(1, t / 0.06) * np.clip((dur - t) / 0.5, 0, 1)
    return lowpass(s * e, 1500, 2) * 0.35


def whoosh(dur, peak):
    """Noise that swells into a cut at `peak` seconds."""
    t = tvec(dur)
    n = rng.standard_normal(len(t))
    shape = np.where(t < peak, (t / peak) ** 3, np.exp(-(t - peak) * 9))
    return (lowpass(highpass(n, 400), 5000) * 0.6 + lowpass(n, 900)) * shape * 0.35


def pad(freqs, dur, gain):
    t = tvec(dur)
    s = np.zeros(len(t))
    for f in freqs:
        for d in (-0.12, 0.0, 0.13):
            s += saw(f * 2 ** (d / 12), t, 8, 1.7)
    e = np.minimum(1, t / 1.2) * np.clip((dur - t) / 1.5, 0, 1)
    return lowpass(s * e, 1200, 2) * gain / len(freqs)


def note(name):
    names = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
    m = re.match(r"([A-G]#?)(\d)", name)
    return 440 * 2 ** ((names[m[1]] + 12 * (int(m[2]) + 1) - 69) / 12)


# ---------------------------------------------------------------- score

# Harmony: D minor, moving to B flat and F under the reveal, home for the logo.
CHORDS = [
    (0.0, 5.4, ["D3", "A3", "F4"], ["D2"]),
    (5.4, 12.0, ["A#2", "F3", "D4"], ["A#1"]),
    (12.0, 19.5, ["F3", "C4", "A4"], ["F2"]),
    (19.5, 27.0, ["G3", "A#3", "D4"], ["G1"]),
    (27.0, 31.0, ["A2", "E3", "C#4"], ["A1"]),
    (31.0, 35.0, ["D3", "A3", "F4", "A4"], ["D2"]),
]
for t0, t1, notes, bass in CHORDS:
    add(pad([note(n) for n in notes], t1 - t0 + 1.2, 0.16 if t0 < GOAL else 0.22), t0 - 0.3)

# Cold open: the clock ticks each second, and a heartbeat quickens toward the goal.
for s in (0.0, 1.0, 2.0):
    add(tick(), s, 0.5, 0.2)
for i, tb in enumerate(np.arange(0.5, GOAL, BEAT)):
    add(kick(0.35 + 0.1 * i), tb, 1.0)
add(whoosh(1.2, 1.0), GOAL - 1.0, 0.9)

# The goal: horn, boom, and a crash.
add(boom(), GOAL, 1.4)
add(horn(), GOAL + 0.02, 1.0, -0.15)
add(horn(), GOAL + 0.04, 0.8, 0.15)
crash_t = tvec(2.5)
add(highpass(rng.standard_normal(len(crash_t)), 3500) * env(crash_t, 0.002, 0.7) * 0.35, GOAL)

# The camera pulls back, then the quake leaves Montreal.
add(whoosh(1.6, 1.4), MAP_IN - 1.4, 1.0)
add(boom(), QUAKE, 1.2)
data = json.loads((HERE / "data.js").read_text().split("=", 1)[1].rstrip().rstrip(";"))
teams = data["teams"]
mtl = next(t for t in teams if t["abbrev"] == "MTL")
speed = math.hypot(1920, 1080) / 2.5
SCALE_UP = ["D5", "F5", "A5", "C6", "D6"]
SCALE_DOWN = ["A4", "F4", "D4", "C4", "A3"]
for team in teams:
    d = team["delta"]
    if abs(d) < 0.001:
        continue
    at = QUAKE + math.hypot(team["x"] - mtl["x"], team["y"] - mtl["y"]) / speed
    k = min(4, int(abs(d) * 100 / 0.15))
    f = note((SCALE_UP if d > 0 else SCALE_DOWN)[k])
    add(ping(f), at, 0.12 + min(0.25, abs(d) * 4), (team["x"] - 960) / 960 * 0.8)

# The groove, from the map through the proof.
for tb in np.arange(QUAKE + 2 * BEAT * 2, LOGO, BEAT):
    quiet = TWICE - 0.01 < tb < PLAYER  # a breath while the runs split
    add(kick(0.75 if not quiet else 0.3), tb)
    add(hat(), tb + BEAT / 2, 0.22, 0.3)
    if int(round(tb / BEAT)) % 4 == 2:
        add(hat(True), tb, 0.12, -0.3)
# Bass in eighths, following the chord roots.
for t0, t1, _, bass in CHORDS:
    f = note(bass[0])
    for tb in np.arange(max(t0, QUAKE + 2), min(t1, LOGO), BEAT / 2):
        t = tvec(BEAT / 2)
        add(lowpass(saw(f, t, 6, 1.2) * env(t, 0.004, 0.16), 400) * 0.5, tb)

# Transitions.
for cut in (BARS, SIMS, PLAYER, TEAM, NIGHTS, WHATIF, STATS):
    add(whoosh(0.9, 0.7), cut - 0.7, 0.55)
# The ranking: one note per bar as it grows.
for i in range(32):
    add(ping(note("D5") * 2 ** ((i % 8) * 2 / 12) / (1 if i < 16 else 2), 0.3), BARS + 0.45 + i * 0.02, 0.05, -0.8 + i / 20)
# The counter runs up to 20,000.
for i in range(40):
    add(tick(), SIMS + 0.15 + (i / 40) ** 1.6 * 1.3, 0.25, 0.4)
# Caufield's goals land as they draw.
for g in data["player"]["goals"]:
    from_date = (np.datetime64(g["date"]) - np.datetime64("2025-10-01")).astype(int) / 257
    add(ping(note("A5") * (1 + g["magnitude"] / 14), 0.25), PLAYER + 0.3 + from_date * 1.3, 0.04 + g["magnitude"] / 160, from_date * 1.4 - 0.7)
# What-If clicks.
for i in range(3):
    add(tick(), WHATIF + 0.12 + 0.35 + i * BEAT * 0.9, 0.6, 0.3)
# Each stat lands on a hit.
for i in range(4):
    add(kick(1.0), STATS + i, 0.8)
    add(boom(1.2), STATS + i, 0.25)
    add(ping(note(["D6", "F6", "A6", "D7"][i]), 0.8), STATS + i, 0.12)

# The logo: the biggest hit, the horn once more, then the room empties.
add(whoosh(1.2, 1.0), LOGO - 1.0, 1.0)
add(boom(4.0), LOGO, 1.6)
add(kick(1.2), LOGO)
add(horn(1.6), LOGO + 0.02, 0.55)
add(tick(), LOOP + 0.97, 0.4, 0.2)

# ---------------------------------------------------------------- master

def reverb(x, seconds=2.2, mix=0.22):
    t = tvec(seconds)
    ir = rng.standard_normal(len(t)) * np.exp(-t * 3.2)
    ir = lowpass(ir, 6000)
    ir /= np.sqrt((ir**2).sum())
    n = len(x) + len(ir)
    y = np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(ir, n), n)[: len(x)]
    return x + y * mix * 6


L2, R2 = reverb(L), reverb(R)
mixed = np.stack([L2, R2], 1)
mixed /= np.abs(mixed).max() / 1.6
mixed = np.tanh(mixed) * 0.89
fade = np.clip((DUR - tvec(DUR)) / 0.6, 0, 1)[:, None]
mixed *= fade[: len(mixed)]

out = HERE / "out" / "puckquake.wav"
out.parent.mkdir(exist_ok=True)
with wave.open(str(out), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mixed * 32767).astype("<i2").tobytes())
print(f"{out.relative_to(HERE)}: {DUR:.0f} s, peak {np.abs(mixed).max():.2f}")
