"""Synthesizes the soundtrack for film.html on the same 120 BPM grid.

Every sound is made here from sine waves and noise, so there is nothing to
license. The cue times match src/timeline.js, and each team's ping lands
when the shockwave reaches it on the map.

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
DUR = 45.0
BEAT = 0.5
N = int(SR * DUR)
rng = np.random.default_rng(7)

# Timeline, from src/timeline.js.
GOAL, CRANE, LIGHTS, QUAKE, WIDE = 2.0, 3.5, 3.75, 5.5, 9.0
RANK, HOME, PRODUCT = 11.0, 14.0, 15.0
CARD, PLAYER, TEAMP, WHATIF, NIGHTS = 20.6, 24.6, 28.6, 32.1, 36.1
FINALE, ENGRAVE, TAGLINE, URL = 39.1, 39.9, 41.7, 42.4
CLICKS = [WHATIF + 0.95 + i * BEAT * 1.4 for i in range(3)]
NIGHT_T0, NIGHT_T1, TAU0, TAU1 = 15.4, 19.4, 7900, 9000
SPEED = 3.6  # shockwave, world units per second

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



def crowd(dur=4.0):
    """An arena erupting: band-limited noise that swells and breathes."""
    t = tvec(dur)
    n = rng.standard_normal(len(t))
    body = highpass(lowpass(n, 2600, 2), 280, 2)
    mod = 1 + 0.25 * np.sin(2 * np.pi * 3.1 * t) * np.sin(2 * np.pi * 0.7 * t)
    e = np.minimum(1, t / 0.12) * np.exp(-t / 1.6)
    return body * mod * e * 0.9


def glass(freq, dur=0.6):
    t = tvec(dur)
    s = np.sin(2 * np.pi * freq * t) + 0.5 * np.sin(2 * np.pi * freq * 2.76 * t) * np.exp(-t * 18)
    return s * env(t, 0.001, 0.12)

# ---------------------------------------------------------------- score

data = json.loads((HERE / "data.js").read_text().split("=", 1)[1].rstrip().rstrip(";"))
teams = data["teams"]
W = lambda tm: ((tm["x"] - 960) / 100, (tm["y"] - 540) / 100)
by = {tm["abbrev"]: tm for tm in teams}
mtl = W(by["MTL"])
pan_of = lambda tm: max(-0.85, min(0.85, (tm["x"] - 960) / 960))

# Harmony: D minor under the open, B flat for the reveal, F for the ranking,
# G minor under the product, a climb through the pages to A, and home to D.
CHORDS = [
    (0.0, GOAL, ["D3", "A3", "F4"]),
    (GOAL, QUAKE, ["D3", "A3", "F4", "A4"]),
    (QUAKE, RANK, ["A#2", "F3", "D4"]),
    (RANK, HOME, ["F3", "C4", "A4"]),
    (HOME, CARD, ["G3", "A#3", "D4"]),
    (CARD, PLAYER, ["A#2", "F3", "D4"]),
    (PLAYER, TEAMP, ["F3", "C4", "A4"]),
    (TEAMP, WHATIF, ["G3", "A#3", "D4"]),
    (WHATIF, NIGHTS, ["A2", "E3", "C#4"]),
    (NIGHTS, FINALE, ["A#2", "F3", "D4"]),
    (ENGRAVE - 0.1, DUR, ["D3", "A3", "E4", "F4"]),
]
for t0, t1, notes in CHORDS:
    add(pad([note(n) for n in notes], t1 - t0 + 1.4, 0.13 if t0 < GOAL else 0.2), t0 - 0.2)

# Cold open: the clock ticks over, a heartbeat quickens under the last seconds.
for s in (1.0, 1.5):
    add(tick(), s, 0.55, 0.15)
for i, tb in enumerate([0.5, 1.0, 1.375, 1.75]):
    add(kick(0.3 + 0.12 * i), tb)
add(whoosh(0.9, 0.85), GOAL - 0.85, 0.7)

# The goal: horn, boom, and the building on its feet.
add(boom(3.0), GOAL, 1.3)
add(horn(2.6), GOAL + 0.02, 0.95, -0.2)
add(horn(2.6), GOAL + 0.05, 0.75, 0.2)
add(crowd(4.5), GOAL + 0.04, 0.55, -0.3)
add(crowd(4.5), GOAL + 0.06, 0.55, 0.3)

# The crane: the arenas light one by one, nearest to Montreal first.
add(whoosh(1.4, 1.3), CRANE - 0.2, 0.5)
LIGHT_NOTES = ["D5", "F5", "A5", "C6", "D6", "F6"]
for tm in teams:
    x, z = W(tm)
    at = LIGHTS + math.hypot(x - mtl[0], z - mtl[1]) * 0.07
    add(glass(note(LIGHT_NOTES[(ord(tm["abbrev"][0]) + ord(tm["abbrev"][2])) % 6]), 0.5), at, 0.05, pan_of(tm))

# The quake: a rumble out of Montreal, and a ping as it reaches each team.
add(whoosh(0.8, 0.75), QUAKE - 0.75, 0.6)
add(boom(4.0), QUAKE, 1.5)
add(kick(1.2), QUAKE)
UP = ["D5", "F5", "A5", "C6", "D6"]
DOWN = ["A4", "F4", "D4", "C4", "A3"]
for tm in teams:
    d = tm["delta"]
    if abs(d) < 0.001:
        continue
    x, z = W(tm)
    at = QUAKE + math.hypot(x - mtl[0], z - mtl[1]) / SPEED
    k = min(4, int(abs(d) * 100 / 0.15))
    add(ping(note((UP if d > 0 else DOWN)[k])), at, 0.1 + min(0.25, abs(d) * 4), pan_of(tm))

# A restrained pulse from the quake to the dive, resting for the wide shot
# and the camera's climb, and lighter under the product pages.
for tb in np.arange(QUAKE + 4 * BEAT, FINALE - 0.9, BEAT):
    if WIDE <= tb < RANK - 0.01 or HOME <= tb < PRODUCT:
        continue
    soft = 0.7 if tb >= CARD else 1.0
    add(kick(0.45 * soft), tb)
    add(hat(), tb + BEAT / 2, 0.14 * soft, 0.25)
for t0, t1, notes in CHORDS[2:10]:
    root = note(notes[0]) / 2
    for tb in np.arange(max(t0, QUAKE + 2), min(t1, FINALE - 0.9), BEAT / 2):
        if WIDE <= tb < RANK:
            continue
        t = tvec(BEAT / 2)
        add(lowpass(saw(root, t, 6, 1.2) * env(t, 0.004, 0.15), 380) * 0.4, tb)

# The ranking: a pluck as each bar rises, pitched by its change.
ranked = sorted(teams, key=lambda tm: tm["delta"])
for i, tm in enumerate(ranked):
    d = tm["delta"]
    f = note("D5") * 2 ** (max(-12, min(12, d * 100 * 2)) / 12)
    add(ping(f, 0.35), RANK + 0.45 + i * 0.018, 0.06 + min(0.2, abs(d) * 3), -0.8 + i / 20)
add(whoosh(0.9, 0.8), RANK - 0.8, 0.45)
add(whoosh(1.0, 0.9), HOME - 0.2, 0.45)

# The product assembles: soft clicks as the header, title, rail and strip land.
for k, dt in enumerate([0.0, 0.1, 0.18, 0.25]):
    add(tick(), PRODUCT + dt + 0.12, 0.3, 0.3 - k * 0.2)
# The night's tremors, each with its own small quake.
for tr in data["night"]["tremors"]:
    if not (TAU0 <= tr["t"] <= TAU1) or tr["magnitude"] < 3.3:
        continue
    at = NIGHT_T0 + (tr["t"] - TAU0) / (TAU1 - TAU0) * (NIGHT_T1 - NIGHT_T0)
    g = (tr["magnitude"] / 6.8) ** 2
    add(boom(2.0), at, 0.75 * g)
    add(ping(note("A5") * (1 + tr["magnitude"] / 20), 0.6), at, 0.12 * g, pan_of(by[tr["home"]]))

# The product pages.
card_t = tvec(0.12)
add(highpass(rng.standard_normal(len(card_t)), 2500) * env(card_t, 0.001, 0.02) * 0.6, CARD + 0.05, 0.6)
add(ping(note("D6"), 0.8), CARD + 0.2, 0.12)
for i, g in enumerate(data["player"]["goals"]):
    frac = (np.datetime64(g["date"]) - np.datetime64("2025-10-01")).astype(int) / 257
    add(ping(note("A5") * (1 + g["magnitude"] / 14), 0.2), PLAYER + 0.7 + frac * 1.1, 0.025 + g["magnitude"] / 260, frac * 1.2 - 0.6)
ring_t = tvec(1.6)
add(np.sin(2 * np.pi * np.cumsum(note("D5") * (1 + 0.5 * np.minimum(1, ring_t / 1.2))) / SR) * env(ring_t, 0.3, 0.6) * 0.06, TEAMP + 0.45)
for i, c in enumerate(CLICKS):
    add(tick(), c, 0.55, 0.35)
    add(ping(note(["D5", "F5", "A5"][i]), 0.6), c + 0.4, 0.16)
add(whoosh(1.0, 0.9), NIGHTS - 0.8, 0.4)
add(highpass(lowpass(rng.standard_normal(int(1.2 * SR)), 9000), 3000) * env(tvec(1.2), 0.5, 0.3) * 0.05, NIGHTS + 0.35)
# The dive into October 16, and the ice.
add(whoosh(1.2, 1.1), FINALE - 1.1, 0.9)
add(boom(2.5), FINALE, 0.6)

# The finale: the last wave crosses the ice and each letter rings as it is cut.
add(boom(4.0), ENGRAVE, 1.1)
add(kick(0.9), ENGRAVE)
for i in range(9):
    x = -4.5 + i * 9 / 8
    at = ENGRAVE + (x + 6.9) / SPEED
    add(glass(note(["D5", "E5", "F5", "A5", "D6", "E6", "F6", "A6", "D7"][i]), 0.9), at, 0.07, x / 6)
# The tagline lands on one resolved chord; puckquake.com on a last tick.
for n_, g in (("D2", 0.5), ("A3", 0.35), ("D4", 0.3), ("E4", 0.22), ("F4", 0.25)):
    t = tvec(DUR - TAGLINE)
    add(lowpass(saw(note(n_), t, 8, 1.6), 1800, 2) * env(t, 0.05, 2.8) * g * 0.5, TAGLINE)
add(tick(), URL, 0.5)
add(ping(note("D6"), 1.2), URL, 0.1)

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
fade = np.clip((DUR - tvec(DUR)) / 1.2, 0, 1)[:, None]
mixed *= fade[: len(mixed)]

out = HERE / "out" / "puckquake.wav"
out.parent.mkdir(exist_ok=True)
with wave.open(str(out), "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mixed * 32767).astype("<i2").tobytes())
print(f"{out.relative_to(HERE)}: {DUR:.0f} s, peak {np.abs(mixed).max():.2f}")
