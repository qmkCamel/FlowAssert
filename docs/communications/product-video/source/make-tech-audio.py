from pathlib import Path
import json, math, subprocess, wave
import numpy as np

root = Path(__file__).resolve().parent.parent / '.build'
(root / 'assets').mkdir(parents=True, exist_ok=True)
sr = 48000
length = 46.0
n = int(sr * length)
rng = np.random.default_rng(28012026)
bus = np.zeros((n, 2), dtype=np.float64)
beat = .5  # 120 BPM; the eight-second chapters span four bars.

def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)

def add(signal, start, gain=1.0, pan=0.0, echo=False):
    pos = int(round(start * sr))
    if pos >= n or pos < 0:
        return
    count = min(len(signal), n - pos)
    theta = (pan + 1) * math.pi / 4
    stereo = np.asarray(signal[:count])[:, None] * np.array([math.cos(theta), math.sin(theta)])[None, :]
    bus[pos:pos + count] += stereo * gain
    if echo:
        add(signal, start + .375, gain * .25, -pan)
        add(signal, start + .75, gain * .10, pan)

def time_for(seconds):
    return np.arange(int(sr * seconds)) / sr

# E minor add9 -> C major9 -> G major9 -> D suspended/add9.
chords = [(52, 59, 62, 66), (48, 55, 59, 62), (43, 50, 57, 59), (50, 57, 64, 66)]
roots = [40, 36, 31, 38]

def section_at(t):
    if t < 6: return 0
    return int((t - 6) // 8) % 4

# Slow stereo harmonic bed with a restrained rhythmic pump.
for section, start in enumerate([0, 6, 14, 22, 30, 38]):
    duration = 7 if section == 0 else 9
    chord = chords[section_at(start)]
    t = time_for(duration)
    envelope = np.minimum(1, t / 1.0) * np.minimum(1, np.maximum(0, duration - t) / 1.5)
    pump = .75 + .25 * (1 - np.exp(-((t + start) % beat) * 11))
    for j, note in enumerate(chord):
        f = hz(note)
        detuned = .65 * np.sin(2 * np.pi * f * t + j * .41) + .35 * np.sin(2 * np.pi * f * 1.003 * t + j)
        harmonic = .16 * np.sin(2 * np.pi * 2 * f * t) + .06 * np.sin(2 * np.pi * 3 * f * t)
        add((detuned + harmonic) * envelope * pump, start, .034, (j - 1.5) / 2)

# Soft digital plucks: a small, repeating motif, delayed across the stereo field.
pattern = [0, 2, 1, 3, 2, 1, 3, 2]
for k in range(int(length / .25)):
    start = k * .25
    if start > 44.25: continue
    chord = chords[section_at(start)]
    note = chord[pattern[k % 8]] + 12
    t = time_for(.9)
    f = hz(note)
    envelope = (1 - np.exp(-t * 600)) * np.exp(-t * 8.8)
    pluck = (np.sin(2 * np.pi * f * t + .62 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 12)) + .12 * np.sin(2 * np.pi * 3 * f * t)) * envelope
    gain = .047 if k % 2 == 0 else .029
    if start < 2: gain *= .6
    if 22 <= start < 30: gain *= .65
    add(pluck, start, gain, .48 if k % 2 else -.48, echo=True)

# Warm eighth-note bass pulses, introduced with the first feature chapter.
for k in range(12, 89):
    start = k * beat
    root_note = roots[section_at(start)]
    for sync, gain in [(0, .115), (.375, .055)]:
        if start + sync > 44.3: continue
        t = time_for(.42)
        f = hz(root_note)
        env = (1 - np.exp(-t * 180)) * np.exp(-t * 8)
        bass = (np.sin(2 * np.pi * f * t) + .28 * np.sin(2 * np.pi * 2 * f * t) + .10 * np.sin(2 * np.pi * 3 * f * t)) * env
        add(bass, start + sync, gain, 0)

# Tight low kick, quiet rim-like snare, and sparse high-frequency ticks.
for k in range(12, 88):
    start = k * beat
    if 22 <= start < 30 and k % 2: continue
    t = time_for(.28)
    phase = 2 * np.pi * (49 * t + 60 * .026 * (1 - np.exp(-t / .026)))
    kick = np.sin(phase) * np.exp(-t * 22) * (1 - np.exp(-t * 1500))
    add(kick, start, .13)
    if k % 4 in [1, 3]:
        t = time_for(.14)
        noise = rng.standard_normal(len(t))
        high = noise - np.convolve(noise, np.ones(12) / 12, mode='same')
        snare = (.19 * high + .55 * np.sin(2 * np.pi * 185 * t) * np.exp(-t * 45)) * np.exp(-t * 35) * (1 - np.exp(-t * 900))
        add(snare, start, .035, .12)
for k in range(24, 177):
    start = k * .25
    t = time_for(.055 if k % 2 else .08)
    noise = rng.standard_normal(len(t))
    high = np.diff(noise, prepend=noise[0]) * .35
    env = np.minimum(1, t / .0015) * np.exp(-t * (90 if k % 2 else 65))
    add(high * env, start, .025 if k % 2 else .017, -.28 if k % 2 else .28)

# Short electronic swells land on the scene changes, kept behind the narration.
for boundary in [6, 14, 22, 30, 38]:
    t = time_for(.8)
    phase = 2 * np.pi * (350 * t + 1200 * t * t)
    texture = .75 * np.sin(phase) + .25 * np.sin(phase * 1.497)
    env = (t / .8) ** 2 * np.minimum(1, (.8 - t) / .05)
    add(texture * env, boundary - .8, .016, -.3)
    t = time_for(1.2)
    note = hz(chords[section_at(boundary)][2] + 24)
    bell = (np.sin(2 * np.pi * note * t) + .18 * np.sin(2 * np.pi * note * 2.01 * t)) * np.exp(-t * 5) * np.minimum(1, t / .005)
    add(bell, boundary, .035, .3, echo=True)

# Resolve the final chord and fade out cleanly.
t = time_for(3.0)
for i, note in enumerate((52, 59, 64, 66)):
    env = (1 - np.exp(-t * 10)) * np.exp(-t * 1.4)
    add(np.sin(2 * np.pi * hz(note + 12) * t) * env, 43.0, .03, (i - 1.5) / 2)
time = np.arange(n) / sr
fade = np.minimum(1, time / 1.0) * np.clip((length - time) / 1.8, 0, 1)
bus *= fade[:, None]
assert np.isfinite(bus).all()
peak = float(np.max(np.abs(bus)))
bus *= min(1, .86 / max(peak, 1e-9))
with wave.open(str(root / 'assets/music-tech-raw.wav'), 'wb') as wav:
    wav.setnchannels(2); wav.setsampwidth(2); wav.setframerate(sr)
    wav.writeframes((np.clip(bus, -.999, .999) * 32767).astype('<i2').tobytes())
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(root / 'assets/music-tech-raw.wav'), '-af', 'highpass=f=32,lowpass=f=12500,loudnorm=I=-24:TP=-3:LRA=8', '-ar', str(sr), str(root / 'assets/music-tech.wav')], check=True)

segments = json.loads((root / 'voice-metadata.json').read_text())['segments']
args = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(root / 'assets/music-tech.wav')]
filters = []
labels = []
for i, segment in enumerate(segments):
    args += ['-i', str(root / f'assets/voice-{i}.wav')]
    label = f'v{i}'
    filters.append(f'[{i+1}:a]adelay={round(segment["start"]*1000)}:all=1[{label}]')
    labels.append(f'[{label}]')
filters.append(''.join(labels) + f'amix=inputs={len(labels)}:normalize=0,apad,atrim=duration=46,asplit=2[voice][detector]')
filters.append('[0:a][detector]sidechaincompress=threshold=0.035:ratio=4:attack=15:release=280:knee=2.5:mix=0.75[ducked]')
filters.append('[voice][ducked]amix=inputs=2:normalize=0,alimiter=limit=0.89:level=false:latency=true,atrim=duration=46[a]')
args += ['-filter_complex', ';'.join(filters), '-map', '[a]', '-ar', str(sr), '-ac', '2', str(root / 'soundtrack.wav')]
subprocess.run(args, check=True)
(root / 'music-metadata.json').write_text(json.dumps({'title': 'FlowAssert / Circuit Motion', 'origin': 'Original local procedural composition; no external samples', 'bpm': 120, 'durationSeconds': 46, 'sampleRate': sr, 'channels': 2, 'parts': ['stereo minor/add9 synth pads', 'FM-style eighth-note plucks with stereo delay', 'warm syncopated bass pulse', 'soft electronic kick and rim', 'high-frequency ticks', 'scene-aligned electronic swells'], 'musicLufsTarget': -24, 'speechDucking': {'threshold': .035, 'ratio': 4, 'attackMs': 15, 'releaseMs': 280, 'mix': .75}, 'rawPeak': peak}, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'music': 'Original 120 BPM electronic pulse', 'duration': length, 'channels': 2, 'narrationSeconds': sum(x['duration'] for x in segments), 'rawMusicPeak': peak}))
