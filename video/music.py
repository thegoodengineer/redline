"""A procedural ambient bed, so the film needs no downloaded music.

    python video/music.py <seconds> <out.wav> [swell_at_seconds]

Slow, detuned sine pads on a D major add-nine chord with a gentle pulse. No melody.
"""
import sys
import wave

import numpy as np

RATE = 48000


def bed(seconds: float, swell_at: float | None = None) -> np.ndarray:
    t = np.arange(int(seconds * RATE)) / RATE
    # D2, A2, D3, F#3, A3, E4: root, fifth, octave, third, fifth, ninth
    notes = [(73.42, 0.9), (110.0, 0.7), (146.83, 0.8), (185.0, 0.45), (220.0, 0.4), (329.63, 0.22)]
    left = np.zeros_like(t)
    right = np.zeros_like(t)
    for i, (freq, level) in enumerate(notes):
        # each voice breathes at its own slow rate and is detuned a little between the ears
        breath = 0.6 + 0.4 * np.sin(2 * np.pi * (0.05 + 0.017 * i) * t + i * 1.3)
        left += level * breath * np.sin(2 * np.pi * freq * 0.9985 * t + i)
        right += level * breath * np.sin(2 * np.pi * freq * 1.0015 * t + i * 1.7)
    pulse = 0.88 + 0.12 * np.sin(2 * np.pi * 0.5 * t)  # one soft pulse every two seconds
    env = np.minimum(1.0, t / 2.0) * np.minimum(1.0, (seconds - t) / 3.0)
    if swell_at is not None:
        env = env * (1.0 + 0.55 * np.exp(-((t - swell_at) ** 2) / (2 * 1.6**2)))
    stereo = np.stack([left, right], axis=1) * (pulse * env)[:, None]
    return stereo / np.max(np.abs(stereo)) * 0.5


def main():
    seconds = float(sys.argv[1])
    out = sys.argv[2]
    swell = float(sys.argv[3]) if len(sys.argv) > 3 else None
    samples = (bed(seconds, swell) * 32767).astype(np.int16)
    with wave.open(out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(samples.tobytes())
    print(f"music: {seconds:.1f} s -> {out}")


if __name__ == "__main__":
    main()
